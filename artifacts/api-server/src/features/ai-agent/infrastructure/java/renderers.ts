import { deriveUrlName } from "../urlNaming";
import { collectJavaConstants, collectJavaPageMethods } from "./collectors";
import {
  camel,
  escapeJ,
  firstGotoUrl,
  inferFieldName,
  javaConfigGetterName,
  javaHeader,
  javaPropertyKey,
  upperSnake,
} from "./helpers";
import type { JavaMethod, JavaTestArgs } from "./types";

export function renderJavaPage(
  pkg: string,
  pascalName: string,
  methods: JavaMethod[],
  isAdditions: boolean,
): string {
  const className = isAdditions ? `${pascalName}PageAiAdditions` : `${pascalName}Page`;
  const extendsClause = isAdditions ? ` extends ${pascalName}Page` : "";
  const ctor = isAdditions
    ? [
        `    public ${className}(com.microsoft.playwright.Page page) {`,
        `        super(page);`,
        `    }`,
        "",
      ].join("\n")
    : [
        `    protected final com.microsoft.playwright.Page page;`,
        `    public ${className}(com.microsoft.playwright.Page page) {`,
        `        this.page = page;`,
        `    }`,
        "",
      ].join("\n");
  const body = methods
    .map((m) => {
      const sig = m.param
        ? `    public void ${m.name}(${m.param}) {`
        : `    public void ${m.name}() {`;
      return [sig, ...m.body, `    }`, ""].join("\n");
    })
    .join("\n");
  return `package ${pkg}.pages;\n\npublic class ${className}${extendsClause} {\n${ctor}${body}}\n`;
}

export function renderJavaConstants(
  pkg: string,
  pascalName: string,
  consts: Map<string, string>,
): string {
  const lines: string[] = [];
  for (const [k, v] of consts.entries()) {
    lines.push(`    public static final String ${k} = "${escapeJ(v)}";`);
  }
  return `package ${pkg}.constants;\n\npublic final class ${pascalName}Constants {\n    private ${pascalName}Constants() {}\n${lines.join("\n")}\n}\n`;
}

export function renderJavaTest(args: JavaTestArgs): string {
  const header = javaHeader(args.runId);
  if (args.kind === "api") return renderJavaApi(args, header);
  if (args.kind === "unit") return renderJavaUnit(args, header);
  return renderJavaPlaywright(args, header);
}

/**
 * Resolve the test/hook method name. For `[Test]` we honor methodName
 * (camelCased); for hook targets JUnit 5 ignores the method name so we
 * use a conventional `setUp` / `setUpAll`.
 */
function javaMethodIdentifier(args: JavaTestArgs): string {
  if (args.targetMethod === "beforeEach") return "setUp";
  if (args.targetMethod === "oneTimeSetUp") return "setUpAll";
  const id = (args.methodName ?? "").replace(/[^A-Za-z0-9_]+/g, "");
  if (!id) return "runAiAuthored";
  // Preserve the PascalCase Given_When_Then identifier as authored;
  // Java accepts upper-case method names and the dialog contract is
  // strict about the shape.
  return id;
}

function javaTestAnnotations(args: JavaTestArgs): {
  annotations: string;
  modifiers: string;
  extraImports: string[];
} {
  if (args.targetMethod === "beforeEach") {
    return {
      annotations: "    @BeforeEach",
      modifiers: "public void",
      extraImports: ["import org.junit.jupiter.api.BeforeEach;"],
    };
  }
  if (args.targetMethod === "oneTimeSetUp") {
    return {
      annotations: "    @BeforeAll",
      modifiers: "public static void",
      extraImports: ["import org.junit.jupiter.api.BeforeAll;"],
    };
  }
  if (args.ignore) {
    const reason = (args.ignoreReason ?? "").trim() || "Ignored by AI Agent";
    return {
      annotations: `    @Test\n    @Disabled(${JSON.stringify(reason)})`,
      modifiers: "public void",
      extraImports: ["import org.junit.jupiter.api.Disabled;"],
    };
  }
  return { annotations: "    @Test", modifiers: "public void", extraImports: [] };
}

function renderJavaPlaywright(args: JavaTestArgs, header: string): string {
  const stmts: string[] = [];
  const methods = collectJavaPageMethods(args.steps);
  const consts = collectJavaConstants(args.steps);
  const hasPage = methods.length > 0;
  const goto = firstGotoUrl(args.steps);
  const propertyKey = goto
    ? javaPropertyKey(
        args.report.urlNames?.find((u) => u.url === goto)?.name ??
          deriveUrlName(goto),
      )
    : null;
  let pageVar: string | null = null;
  if (hasPage) {
    pageVar = "po";
    stmts.push(`        ${args.suitePascal}Page ${pageVar} = new ${args.suitePascal}Page(page);`);
  }
  const getterName = goto
    ? javaConfigGetterName(
        args.report.urlNames?.find((u) => u.url === goto)?.name ??
          deriveUrlName(goto),
      )
    : null;
  if (goto && getterName) {
    stmts.push(`        page.navigate(new ${args.pkg}.config.Config().${getterName}());`);
  } else if (goto && propertyKey) {
    stmts.push(`        page.navigate(java.util.ResourceBundle.getBundle("application").getString("${propertyKey}"));`);
  }
  for (const step of args.steps) {
    stmts.push(`        // ${step.input}`);
    let emitted = false;
    for (const c of step.playwrightCalls ?? []) {
      if (c.method === "page.goto") {
        emitted = true;
        continue;
      }
      const verb = camel(step.method?.name ?? "");
      if (!verb || !pageVar) continue;
      if (c.method === "page.click" || c.method === "expect.toBeVisible") {
        stmts.push(`        ${pageVar}.${verb}();`);
        emitted = true;
      } else if (c.method === "page.fill") {
        const constName = upperSnake(inferFieldName(step) ?? "value") || "VALUE";
        stmts.push(`        ${pageVar}.${verb}(${args.suitePascal}Constants.${constName});`);
        emitted = true;
      }
    }
    if (!emitted) stmts.push(`        // (unrecognised — review manually)`);
  }
  const ann = javaTestAnnotations(args);
  const fn = javaMethodIdentifier(args);
  const imports: string[] = [
    "import com.microsoft.playwright.*;",
    ...(args.targetMethod === "test" ? ["import org.junit.jupiter.api.Test;"] : []),
    ...ann.extraImports,
  ];
  if (hasPage) imports.push(`import ${args.pkg}.pages.${args.suitePascal}Page;`);
  if (consts.size > 0) imports.push(`import ${args.pkg}.constants.${args.suitePascal}Constants;`);
  return `${header}\npackage ${args.pkg}.tests;\n\n${imports.join("\n")}\n\npublic class ${args.className} {\n${ann.annotations}\n    ${ann.modifiers} ${fn}() {\n        try (Playwright pw = Playwright.create();\n             Browser browser = pw.chromium().launch();\n             Page page = browser.newPage()) {\n${stmts.join("\n")}\n        }\n    }\n}\n`;
}

function renderJavaApi(args: JavaTestArgs, header: string): string {
  const stmts: string[] = [];
  for (const step of args.steps) {
    stmts.push(`        // ${step.input}`);
    for (const c of step.httpCalls ?? []) {
      const m = (c.method || "GET").toUpperCase();
      if (m === "ASSERT") {
        if (c.status) {
          stmts.push(`        org.junit.jupiter.api.Assertions.assertEquals(${c.status}, response.statusCode());`);
        }
        continue;
      }
      stmts.push(`        request = java.net.http.HttpRequest.newBuilder(java.net.URI.create("${escapeJ(c.url)}")).method("${m}", java.net.http.HttpRequest.BodyPublishers.noBody()).build();`);
      stmts.push(`        response = client.send(request, java.net.http.HttpResponse.BodyHandlers.ofString());`);
      if (c.status) {
        stmts.push(`        org.junit.jupiter.api.Assertions.assertEquals(${c.status}, response.statusCode());`);
      }
    }
  }
  const ann = javaTestAnnotations(args);
  const fn = javaMethodIdentifier(args);
  const imports: string[] = [
    ...(args.targetMethod === "test" ? ["import org.junit.jupiter.api.Test;"] : []),
    ...ann.extraImports,
  ];
  const importBlock = imports.length ? `${imports.join("\n")}\n\n` : "";
  return `${header}\npackage ${args.pkg}.tests;\n\n${importBlock}public class ${args.className} {\n${ann.annotations}\n    ${ann.modifiers} ${fn}() throws Exception {\n        java.net.http.HttpClient client = java.net.http.HttpClient.newHttpClient();\n        java.net.http.HttpRequest request = null;\n        java.net.http.HttpResponse<String> response = null;\n${stmts.join("\n")}\n    }\n}\n`;
}

function renderJavaUnit(args: JavaTestArgs, header: string): string {
  const stmts: string[] = [];
  for (const step of args.steps) {
    stmts.push(`        // ${step.input}`);
    for (const c of step.unitCalls ?? []) {
      const fn = camel(c.function);
      const a = c.args.map((x) => JSON.stringify(x)).join(", ");
      stmts.push(`        org.junit.jupiter.api.Assertions.assertEquals(${JSON.stringify(c.expected)}, ${fn}(${a}));`);
    }
  }
  const ann = javaTestAnnotations(args);
  const fn = javaMethodIdentifier(args);
  const imports: string[] = [
    ...(args.targetMethod === "test" ? ["import org.junit.jupiter.api.Test;"] : []),
    ...ann.extraImports,
  ];
  const importBlock = imports.length ? `${imports.join("\n")}\n\n` : "";
  return `${header}\npackage ${args.pkg}.tests;\n\n${importBlock}public class ${args.className} {\n${ann.annotations}\n    ${ann.modifiers} ${fn}() {\n${stmts.join("\n")}\n    }\n}\n`;
}
