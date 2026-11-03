// Test-class rendering (new) and method insertion (existing) for the API codegen.
import type { BuildApiTestSpec } from "@/features/codegen/infrastructure/apiCsharpCodegen";
import {
  apiSuiteTestCategoriesClassName,
  assistantClassNameForJava,
  ensureImports,
  findMatchingBrace,
  ident,
} from "./apiShared";
import { renderTestMethodBodyJava } from "./apiTestCategories";

/** Render a brand-new test class file. */
export function renderNewTestClassJava(
  spec: BuildApiTestSpec,
  basePkg: string,
): string {
  if (spec.testClass.mode !== "new") {
    throw new Error("renderNewTestClassJava requires mode=new");
  }
  ident(spec.testClass.className, "Test class name");
  ident(spec.testMethodName, "Test method name");

  const className = spec.testClass.className;
  const assistantClass = assistantClassNameForJava(className);
  const callArgs = spec.parameters
    .map((p) => `(${p.type}) defaultValue(${JSON.stringify(p.type)})`)
    .join(", ");

  const oneTime =
    spec.buildInto === "oneTimeSetup"
      ? `    private java.net.http.HttpResponse<String> response;

    @org.junit.jupiter.api.BeforeAll
    void setUpAll() throws java.io.IOException, InterruptedException {
        this.response = assistant.${spec.helperMethodName}(${callArgs});
    }

`
      : "";

  const perTest =
    spec.buildInto === "perTestSetup"
      ? `    private java.net.http.HttpResponse<String> response;

    @org.junit.jupiter.api.BeforeEach
    void setUp() throws java.io.IOException, InterruptedException {
        this.response = assistant.${spec.helperMethodName}(${callArgs});
    }

`
      : "";

  // `defaultValue` helper produces zero-values for primitive types and
  // null for everything else — only used when params are present.
  const defaultHelper =
    spec.parameters.length > 0
      ? `    @SuppressWarnings("unchecked")
    private static <T> T defaultValue(String type) {
        return switch (type) {
            case "int", "Integer" -> (T) Integer.valueOf(0);
            case "long", "Long" -> (T) Long.valueOf(0L);
            case "double", "Double" -> (T) Double.valueOf(0.0);
            case "boolean", "Boolean" -> (T) Boolean.FALSE;
            default -> null;
        };
    }
`
      : "";

  const extraImports: string[] = [];
  const newClassMeta = spec.metadata ?? undefined;
  if (newClassMeta?.ignoreReason) {
    extraImports.push("import org.junit.jupiter.api.Disabled;");
  }
  if (newClassMeta?.categoryConstantName && newClassMeta.categoryValue) {
    const cls = apiSuiteTestCategoriesClassName(className);
    extraImports.push(`import ${basePkg}.tests.testcategories.${cls};`);
  }
  const extraImportBlock =
    extraImports.length > 0 ? extraImports.join("\n") + "\n" : "";

  return `package ${basePkg}.tests.tests;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
${extraImportBlock}import ${basePkg}.constants.TestCollections;
import ${basePkg}.infrastructure.ApiTestFixture;
import ${basePkg}.tests.apitestingassistants.${assistantClass};

@Tag(TestCollections.API)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
public class ${className} {
    private final ${assistantClass} assistant;

${oneTime}${perTest}    public ${className}() {
        this.assistant = new ${assistantClass}(ApiTestFixture.getInstance());
    }

${renderTestMethodBodyJava(spec, className)}
${defaultHelper ? "\n" + defaultHelper : ""}}
`;
}

/**
 * Insert a new `@Test` method into an existing test class file. Throws
 * if a method with the same name already exists.
 */
export function insertTestIntoExistingClassJava(
  source: string,
  spec: BuildApiTestSpec,
): string {
  ident(spec.testMethodName, "Test method name");
  if (spec.buildInto !== "testMethod") {
    throw new Error(
      "Adding to an existing test class is only supported when buildInto = testMethod (oneTimeSetup/perTestSetup require constructor wiring that this insert path cannot synthesize safely).",
    );
  }
  const classHeader =
    /\bpublic\s+(?:final\s+)?class\s+(\w+)\s*\{/m.exec(source);
  if (!classHeader) {
    throw new Error(
      "Target test class file does not contain a recognizable class declaration",
    );
  }
  const bodyStart = classHeader.index + classHeader[0].length;
  const bodyEnd = findMatchingBrace(source, bodyStart);
  if (bodyEnd === -1) {
    throw new Error("Target test class file has unbalanced braces");
  }
  const region = source.slice(bodyStart, bodyEnd);
  const dup = new RegExp(`\\bvoid\\s+${spec.testMethodName}\\s*\\(`);
  if (dup.test(region)) {
    throw new Error(
      `Test method ${spec.testMethodName} already exists in target class`,
    );
  }
  const targetClassName = classHeader[1]!;
  // Make sure the imports for any annotations we're about to emit exist
  // before injecting the method block — otherwise the resulting class
  // wouldn't compile.
  const extraImports: string[] = [];
  const insertMeta = spec.metadata ?? undefined;
  if (insertMeta?.ignoreReason) {
    extraImports.push("org.junit.jupiter.api.Disabled");
  }
  if (insertMeta?.categoryConstantName && insertMeta.categoryValue) {
    // Reach back through the test class file's `package` line to derive
    // the basePkg so the testcategories import resolves correctly even
    // when the class lives in a non-default package.
    const pkgMatch = /^package\s+([^;]+);/m.exec(source);
    const pkg = pkgMatch ? pkgMatch[1]!.trim() : "";
    // Strip the trailing `.tests.tests` segment to recover basePkg.
    const basePkg = pkg.replace(/\.tests\.tests$/, "");
    const cls = apiSuiteTestCategoriesClassName(targetClassName);
    extraImports.push(`${basePkg}.tests.testcategories.${cls}`);
  }
  if (extraImports.length > 0) {
    source = ensureImports(source, extraImports);
    // Re-derive bodyStart/bodyEnd after import injection.
    const reHeader = /\bpublic\s+(?:final\s+)?class\s+(\w+)\s*\{/m.exec(source);
    if (!reHeader) {
      throw new Error(
        "Target test class file class declaration disappeared after import insertion (this should never happen)",
      );
    }
    const newBodyStart = reHeader.index + reHeader[0].length;
    const newBodyEnd = findMatchingBrace(source, newBodyStart);
    if (newBodyEnd === -1) {
      throw new Error("Target test class file has unbalanced braces");
    }
    const body = `\n\n${renderTestMethodBodyJava(spec, targetClassName)}\n`;
    return source.slice(0, newBodyEnd) + body + source.slice(newBodyEnd);
  }
  const body = `\n\n${renderTestMethodBodyJava(spec, targetClassName)}\n`;
  return source.slice(0, bodyEnd) + body + source.slice(bodyEnd);
}
