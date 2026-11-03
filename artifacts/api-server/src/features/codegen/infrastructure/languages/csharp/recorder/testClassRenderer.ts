import type { AiRunReport, AiRunStep } from "@/features/ai-agent/domain/types";
import {
  escapeCs,
  lowerFirst,
  pascal,
  safeIdentifier,
} from "./identifiers";
import { HEADER, inferFieldName } from "./appsettingsIO";

export interface RenderTestArgs {
  /**
   * The project's ROOT namespace (e.g. `Demo`). Used by `using`
   * directives and to qualify page-object sub-namespaces like
   * `${ns}.Tests.PageObjects.Actions`. Always the discovered project
   * namespace — never the full per-file namespace.
   */
  ns: string;
  /**
   * The FULL namespace the generated test class is declared in
   * (e.g. `Demo.Tests` for new_suite, `Demo.Tests.Subarea` for an
   * add_method companion). Kept separate from `ns` so the renderer
   * can keep usings rooted at the project namespace while letting
   * add_method's partial companion share the EXACT namespace of the
   * user's hand-written suite (otherwise C# would not merge the
   * partials at build time).
   */
  classNamespace: string;
  className: string;
  pageName: string;
  interfaceName: string;
  hasPageMethods: boolean;
  hasConstants: boolean;
  suiteStem: string;
  runId: string;
  kind: AiRunReport["kind"];
  steps: AiRunStep[];
  baseUrl: string | null;
  baseUrlName: string | null;
  report: AiRunReport;
  methodName: string;
  targetMethod: "test" | "beforeEach" | "oneTimeSetUp";
  ignore: boolean;
  ignoreReason: string | null;
  /**
   * When true the renderer emits `public partial class {Name}` with
   * no base class and no `[TestFixture]` attribute — the canonical
   * file (the user's hand-written suite the user picked in the "Add
   * method to existing suite" dropdown) already declares the base
   * and the attribute, so the companion must not duplicate them.
   */
  partial: boolean;
}

/**
 * Map the language-agnostic targetMethod onto the C# attribute that
 * NUnit will discover. The runner has already rejected the
 * `ignore=true` + non-test combination upstream, so we don't have
 * to defend that here.
 */
function csharpAttributeFor(target: RenderTestArgs["targetMethod"]): string {
  if (target === "beforeEach") return "[SetUp]";
  if (target === "oneTimeSetUp") return "[OneTimeSetUp]";
  return "[Test]";
}

function csharpMethodNameFor(
  target: RenderTestArgs["targetMethod"],
  methodName: string,
): string {
  // NUnit attribute → method name. The renderer appends "Async" to
  // whatever we return here, so we return the un-suffixed stem.
  //   [SetUp]        → Setup       → SetupAsync()
  //   [OneTimeSetUp] → OneTimeSetup → OneTimeSetupAsync()
  if (target === "beforeEach") return "Setup";
  if (target === "oneTimeSetUp") return "OneTimeSetup";
  return safeIdentifier(methodName, "Run_AiAuthored");
}

function csharpIgnoreLine(ignore: boolean, reason: string | null): string {
  if (!ignore) return "";
  const safe = (reason ?? "").trim() || "Ignored by AI Agent";
  return `        [Ignore("${escapeCs(safe)}")]\n`;
}

export function renderTestClass(args: RenderTestArgs): string {
  if (args.kind === "api") return renderApiTestClass(args);
  if (args.kind === "unit") return renderUnitTestClass(args);
  return renderPlaywrightTestClass(args);
}

function renderPlaywrightTestClass(args: RenderTestArgs): string {
  const stmts: string[] = [];
  const localVar = lowerFirst(args.pageName);
  if (args.hasPageMethods) {
    stmts.push(
      `            ${args.interfaceName} ${localVar} = new ${args.pageName}(Page);`,
    );
  }
  if (args.baseUrl) {
    const propName = args.baseUrlName ?? "BaseUrl";
    stmts.push(`            await Page.GotoAsync(TestConfig.${propName});`);
  }
  for (const step of args.steps) {
    stmts.push(`            // ${step.input}`);
    let emitted = false;
    for (const c of step.playwrightCalls ?? []) {
      if (c.method === "page.goto") {
        emitted = true;
        continue;
      }
      const verb = safeIdentifier(pascal(step.method?.name ?? ""), "");
      if (!verb) continue;
      if (c.method === "page.click") {
        stmts.push(`            await ${localVar}.${verb}Async();`);
        emitted = true;
      } else if (c.method === "page.fill") {
        const fieldName = inferFieldName(step) ?? "Value";
        const constName = safeIdentifier(pascal(fieldName), "Value");
        stmts.push(
          `            await ${localVar}.${verb}Async(${args.suiteStem}Constants.${constName});`,
        );
        emitted = true;
      } else if (c.method === "expect.toBeVisible") {
        stmts.push(`            await ${localVar}.${verb}Async();`);
        emitted = true;
      } else if (c.method === "expect.toHaveURL") {
        const needle = String(c.args?.[0] ?? "");
        stmts.push(
          `            await Expect(Page).ToHaveURLAsync(new System.Text.RegularExpressions.Regex("${escapeCs(needle)}"));`,
        );
        emitted = true;
      }
    }
    if (!emitted) {
      stmts.push(`            // (unrecognised — review manually)`);
    }
  }

  const usings = [
    "using System.Threading.Tasks;",
    "using Microsoft.Playwright;",
    "using NUnit.Framework;",
    `using ${args.ns}.Infrastructure.Fixtures;`,
    `using ${args.ns}.Shared.Configuration;`,
    `using ${args.ns}.Tests.PageObjects.Actions;`,
    `using ${args.ns}.Tests.PageObjects.Interfaces;`,
    args.hasConstants ? `using ${args.ns}.Tests.Constants;` : null,
    `using static Microsoft.Playwright.Assertions;`,
  ]
    .filter(Boolean)
    .join("\n");

  const attr = csharpAttributeFor(args.targetMethod);
  const methodName = csharpMethodNameFor(args.targetMethod, args.methodName);
  const ignoreLine = csharpIgnoreLine(args.ignore, args.ignoreReason);
  const classDecl = args.partial
    ? `    public partial class ${args.className}`
    : `    [TestFixture]\n    public class ${args.className} : TestFixture`;
  return `${HEADER(args.runId)}
${usings}

namespace ${args.classNamespace}
{
${classDecl}
    {
${ignoreLine}        ${attr}
        public async Task ${methodName}Async()
        {
${stmts.join("\n")}
        }
    }
}
`;
}

function renderApiTestClass(args: RenderTestArgs): string {
  const stmts: string[] = [];
  for (const step of args.steps) {
    stmts.push(`            // ${step.input}`);
    for (const c of step.httpCalls ?? []) {
      const m = (c.method || "GET").toUpperCase();
      if (m === "ASSERT") {
        if (c.status) {
          stmts.push(
            `            Assert.That((int)response.StatusCode, Is.EqualTo(${c.status}));`,
          );
        }
        continue;
      }
      const httpMethod = pascal(m.toLowerCase());
      stmts.push(
        `            response = await client.SendAsync(new HttpRequestMessage(HttpMethod.${httpMethod}, "${escapeCs(c.url)}"));`,
      );
      if (c.status) {
        stmts.push(
          `            Assert.That((int)response.StatusCode, Is.EqualTo(${c.status}));`,
        );
      }
    }
  }
  const usings = [
    "using System.Net.Http;",
    "using System.Threading.Tasks;",
    "using NUnit.Framework;",
  ].join("\n");
  const attr = csharpAttributeFor(args.targetMethod);
  const methodName = csharpMethodNameFor(args.targetMethod, args.methodName);
  const ignoreLine = csharpIgnoreLine(args.ignore, args.ignoreReason);
  const classDecl = args.partial
    ? `    public partial class ${args.className}\n    {`
    : `    [TestFixture]\n    public class ${args.className}\n    {\n        private static readonly HttpClient client = new HttpClient();\n`;
  return `${HEADER(args.runId)}
${usings}

namespace ${args.classNamespace}
{
${classDecl}
${ignoreLine}        ${attr}
        public async Task ${methodName}Async()
        {
            HttpResponseMessage response = null!;
${stmts.join("\n")}
            await Task.CompletedTask;
        }
    }
}
`;
}

function renderUnitTestClass(args: RenderTestArgs): string {
  const stmts: string[] = [];
  for (const step of args.steps) {
    stmts.push(`            // ${step.input}`);
    for (const c of step.unitCalls ?? []) {
      const fn = safeIdentifier(pascal(c.function), "Fn");
      const a = c.args.map((x) => JSON.stringify(x)).join(", ");
      stmts.push(
        `            Assert.That(${fn}(${a}), Is.EqualTo(${JSON.stringify(c.expected)}));`,
      );
    }
  }
  const usings = ["using NUnit.Framework;"].join("\n");
  const attr = csharpAttributeFor(args.targetMethod);
  const methodName = csharpMethodNameFor(args.targetMethod, args.methodName);
  const ignoreLine = csharpIgnoreLine(args.ignore, args.ignoreReason);
  const classDecl = args.partial
    ? `    public partial class ${args.className}`
    : `    [TestFixture]\n    public class ${args.className}`;
  return `${HEADER(args.runId)}
${usings}

namespace ${args.classNamespace}
{
${classDecl}
    {
${ignoreLine}        ${attr}
        public void ${methodName}()
        {
${stmts.join("\n")}
        }
    }
}
`;
}
