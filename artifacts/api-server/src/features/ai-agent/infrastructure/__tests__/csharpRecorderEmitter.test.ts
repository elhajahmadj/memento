import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emitCsharp } from "../csharpRecorderEmitter";
import type { AiRunReport } from "@/features/ai-agent/domain/types";

let tmp: string;
let projectRoot: string;
const PROJECT_NAME = "Demo";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-emit-cs-"));
  projectRoot = path.join(tmp, PROJECT_NAME);
  // Mimic a freshly-scaffolded test project layout so the discovery
  // step has the {Project}.Tests folder and an existing namespace
  // declaration to read.
  await fs.mkdir(path.join(projectRoot, `${PROJECT_NAME}.Tests`), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(projectRoot, `${PROJECT_NAME}.Tests`, "Marker.cs"),
    "namespace Demo.Tests {}\n",
  );
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function makeReport(): AiRunReport {
  return {
    runId: "run-12345678",
    suiteName: "LoginTest",
    kind: "playwright",
    status: "succeeded",
    categories: [],
    startedAt: new Date().toISOString(),
    catalogDeltas: { newMethods: [], newSelectors: [], newCategories: [] },
    steps: [
      {
        index: 0,
        input: "navigate to https://example.com/login",
        method: { name: "NavigateTo", source: "existing", matchType: "exact" },
        playwrightCalls: [
          { method: "page.goto", args: ["https://example.com/login"] },
        ],
        result: "passed",
      },
      {
        index: 1,
        input: "fill the Username field with alice",
        method: {
          name: "FillUsername",
          source: "ai-created",
          matchType: "semantic",
        },
        inputs: [{ field: "Username", value: "alice" }],
        playwrightCalls: [
          {
            method: "page.fill",
            selector: '[name="username"]',
            rawSelector: '[name="username"]',
            value: "alice",
          },
        ],
        result: "passed",
      },
      {
        index: 2,
        input: "click the Sign-in button",
        method: {
          name: "ClickSignIn",
          source: "ai-created",
          matchType: "semantic",
        },
        playwrightCalls: [
          {
            method: "page.click",
            selector: "text=Sign-in",
            rawSelector: "text=Sign-in",
          },
        ],
        result: "passed",
      },
    ],
  };
}

describe("emitCsharp", () => {
  it("writes recorder-style files into the existing test project", async () => {
    const written = await emitCsharp({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-12345678",
      report: makeReport(),
      targetMode: "new_suite",
      existingSuiteFile: null,
    });

    // Test class lives under Tests/, NOT AI/. The class file uses
    // the `{Stem}TestSuite.cs` naming convention so AI-authored
    // suites are visibly distinct from hand-written `*Tests.cs`
    // fixtures and pair with the hidden `{Stem}TestSuiteSetup`
    // sidecar (extensionless, dropped beside the suite when the
    // user records a [SetUp] step).
    expect(written).toContain("Demo.Tests/Tests/LoginTestSuite.cs");
    expect(written).toContain(
      "Demo.Tests/PageObjects/Selectors/LoginPageSelectors.cs",
    );
    expect(written).toContain("Demo.Tests/PageObjects/Actions/LoginPage.cs");
    expect(written).toContain(
      "Demo.Tests/PageObjects/Interfaces/ILoginPage.cs",
    );
    expect(written).toContain("Demo.Tests/Constants/LoginConstants.cs");
    expect(written).toContain("Demo.Tests/appsettings.json");

    const testCs = await fs.readFile(
      path.join(projectRoot, "Demo.Tests/Tests/LoginTestSuite.cs"),
      "utf8",
    );
    expect(testCs).toContain("namespace Demo.Tests");
    expect(testCs).toContain("class LoginTestSuite : TestFixture");
    // The dialog now derives a PascalCase name from the URL host
    // (`example.com/login` → `ExampleBaseUrl`) and threads it through the
    // generated TestConfig surface, so tests reference the typed property
    // instead of the stringly-typed `Urls["BaseUrl"]` lookup.
    expect(testCs).toContain("await Page.GotoAsync(TestConfig.ExampleBaseUrl)");
    expect(testCs).toContain(
      "await loginPage.FillUsernameAsync(LoginConstants.Username)",
    );
    expect(testCs).toContain("await loginPage.ClickSignInAsync()");
    expect(testCs).not.toContain("namespace AI");

    const appJson = JSON.parse(
      await fs.readFile(
        path.join(projectRoot, "Demo.Tests/appsettings.json"),
        "utf8",
      ),
    );
    expect(appJson.Urls.ExampleBaseUrl).toBe("https://example.com/login");

    const consts = await fs.readFile(
      path.join(projectRoot, "Demo.Tests/Constants/LoginConstants.cs"),
      "utf8",
    );
    expect(consts).toContain('public const string Username = "alice"');

    const selectors = await fs.readFile(
      path.join(
        projectRoot,
        "Demo.Tests/PageObjects/Selectors/LoginPageSelectors.cs",
      ),
      "utf8",
    );
    expect(selectors).toContain("ClickSignInSelector");
    expect(selectors).toContain("FillUsernameSelector");
  });

  it("preserves an existing named URL in appsettings.json (idempotent)", async () => {
    const settingsPath = path.join(projectRoot, "Demo.Tests/appsettings.json");
    // Seed under the same derived name (`ExampleBaseUrl`) the emitter
    // would otherwise compute from `https://example.com/login`, so we
    // can prove a pre-existing value is left untouched.
    await fs.writeFile(
      settingsPath,
      JSON.stringify({ Urls: { ExampleBaseUrl: "https://kept.example/" } }),
    );

    await emitCsharp({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-12345678",
      report: makeReport(),
      targetMode: "new_suite",
      existingSuiteFile: null,
    });

    const appJson = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    expect(appJson.Urls.ExampleBaseUrl).toBe("https://kept.example/");
  });

  it("writes the navigate URL into appsettings.json under the derived named key", async () => {
    await emitCsharp({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-12345678",
      report: makeReport(),
      targetMode: "new_suite",
      existingSuiteFile: null,
    });
    const appJson = JSON.parse(
      await fs.readFile(
        path.join(projectRoot, "Demo.Tests/appsettings.json"),
        "utf8",
      ),
    );
    expect(appJson.Urls.ExampleBaseUrl).toBe("https://example.com/login");
  });

  it("writes a partial-class sidecar instead of clobbering an existing selectors file", async () => {
    const selPath = path.join(
      projectRoot,
      "Demo.Tests/PageObjects/Selectors/LoginPageSelectors.cs",
    );
    const original = `namespace Demo.Tests.PageObjects.Selectors
{
    public static partial class LoginPageSelectors
    {
        public static readonly string ExistingSelector = "[data-test=\\"keep-me\\"]";
    }
}
`;
    await fs.mkdir(path.dirname(selPath), { recursive: true });
    await fs.writeFile(selPath, original);

    const written = await emitCsharp({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-12345678",
      report: makeReport(),
      targetMode: "new_suite",
      existingSuiteFile: null,
    });

    // Original file is preserved byte-for-byte.
    expect(await fs.readFile(selPath, "utf8")).toBe(original);
    // Sidecar partial class carries the AI-added selectors.
    expect(written).toContain(
      "Demo.Tests/PageObjects/Selectors/LoginPageSelectors.AiGenerated.cs",
    );
    const sidecar = await fs.readFile(
      path.join(
        projectRoot,
        "Demo.Tests/PageObjects/Selectors/LoginPageSelectors.AiGenerated.cs",
      ),
      "utf8",
    );
    expect(sidecar).toContain("public static partial class LoginPageSelectors");
    expect(sidecar).toContain("ClickSignInSelector");
    expect(sidecar).toContain("FillUsernameSelector");
    expect(sidecar).not.toContain("ExistingSelector");
  });

  it("writes a partial-class companion in add_method mode (reuses existing class name)", async () => {
    // Seed an existing hand-written suite. The add_method emitter
    // reads the declared class name out of this file so the companion
    // can attach as a `partial class` of the same name.
    const existingRel = "Demo.Tests/Tests/MyLoginTestSuite.cs";
    await fs.mkdir(path.dirname(path.join(projectRoot, existingRel)), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectRoot, existingRel),
      `namespace Demo.Tests.Subarea
{
    [TestFixture]
    public partial class MyLoginTestSuite : TestFixture
    {
        [Test]
        public async Task ExistingTestAsync() {}
    }
}
`,
    );

    const written = await emitCsharp({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-12345678",
      report: makeReport(),
      targetMode: "add_method",
      existingSuiteFile: existingRel,
    });

    const companion = written.find((p) =>
      p.endsWith("MyLoginTestSuite.AiMethod.run-1234.cs"),
    );
    expect(
      companion,
      `expected an AiMethod companion file, saw: ${written.join(", ")}`,
    ).toBeTruthy();
    // Companion lives in the SAME folder as the picked existing suite.
    expect(companion!.startsWith("Demo.Tests/Tests/")).toBe(true);
    const txt = await fs.readFile(path.join(projectRoot, companion!), "utf8");
    // Partial of the SAME class — no `: TestFixture` base, no
    // duplicate `[TestFixture]` attribute (the canonical file owns
    // both). C# merges the partials at build time.
    expect(txt).toContain("public partial class MyLoginTestSuite");
    expect(txt).not.toContain(": TestFixture");
    expect(txt).not.toContain("[TestFixture]");
    // Namespace parity: the companion MUST live in the EXACT same
    // namespace as the user-selected suite, otherwise C# would NOT
    // merge the partials at build time. The suite declares
    // `Demo.Tests.Subarea`; assert the literal `namespace
    // Demo.Tests.Subarea\n{` line and explicitly reject the bug
    // shape where the renderer would tack a `.Tests` segment onto
    // the already-qualified namespace (yielding
    // `Demo.Tests.Subarea.Tests`).
    expect(txt).toMatch(/namespace Demo\.Tests\.Subarea\s*\n\s*\{/);
    expect(txt).not.toContain("namespace Demo.Tests.Subarea.Tests");
    // `using` directives MUST stay rooted at the project namespace
    // (`Demo`), NOT at the parsed test-class namespace
    // (`Demo.Tests.Subarea`) — otherwise the generated file would
    // import nonsensical paths like `Demo.Tests.Subarea.Infrastructure
    // .Fixtures` or `Demo.Tests.Subarea.Tests.PageObjects.Actions`
    // and fail to compile. This locks down the root-vs-class
    // namespace separation.
    expect(txt).toContain("using Demo.Infrastructure.Fixtures;");
    expect(txt).toContain("using Demo.Tests.PageObjects.Actions;");
    expect(txt).toContain("using Demo.Tests.PageObjects.Interfaces;");
    expect(txt).not.toContain("using Demo.Tests.Subarea.");
    expect(txt).not.toContain("using Demo.Tests.Tests.");
  });

  it("rejects add_method when the selected file cannot be parsed instead of falling back to new-suite path", async () => {
    // No file seeded at this path — readExistingClassName returns null.
    await expect(
      emitCsharp({
        projectRoot,
        projectName: PROJECT_NAME,
        runId: "run-12345678",
        report: makeReport(),
        targetMode: "add_method",
        existingSuiteFile: "Demo.Tests/Tests/Missing.cs",
      }),
    ).rejects.toThrow(/cannot attach to/i);

    // And: empty string at the path also rejects (no class decl).
    const noClassRel = "Demo.Tests/Tests/NoClass.cs";
    await fs.mkdir(path.dirname(path.join(projectRoot, noClassRel)), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectRoot, noClassRel),
      "// just a comment, nothing useful here\n",
    );
    await expect(
      emitCsharp({
        projectRoot,
        projectName: PROJECT_NAME,
        runId: "run-12345678",
        report: makeReport(),
        targetMode: "add_method",
        existingSuiteFile: noClassRel,
      }),
    ).rejects.toThrow(/cannot attach to/i);

    // And: missing `existingSuiteFile` also rejects.
    await expect(
      emitCsharp({
        projectRoot,
        projectName: PROJECT_NAME,
        runId: "run-12345678",
        report: makeReport(),
        targetMode: "add_method",
        existingSuiteFile: null,
      }),
    ).rejects.toThrow(/no existing suite file/i);
  });

  it("persists the user plan into a hidden {ClassName}Setup sidecar on hook runs", async () => {
    const planText =
      "1. Sign in as alice\n2. Wait for dashboard to load";
    const hookReport = makeReport();
    (hookReport as unknown as { targetMethod: string }).targetMethod =
      "beforeEach";
    hookReport.suiteName = "SmokeFlow";

    const written = await emitCsharp({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-12345678",
      report: hookReport,
      targetMode: "new_suite",
      existingSuiteFile: null,
      planText,
    });

    const sidecarRel = "Demo.Tests/Tests/SmokeFlowTestSuiteSetup";
    expect(written).toContain(sidecarRel);
    const sidecar = await fs.readFile(
      path.join(projectRoot, sidecarRel),
      "utf8",
    );
    expect(sidecar.trim()).toBe(planText);
    // Sidecar is intentionally extensionless so the test-discovery
    // walker (which dispatches by extension) ignores it.
    expect(path.posix.extname(sidecarRel)).toBe("");
  });

  it("renders SetupAsync()/OneTimeSetupAsync() when targetMethod is a hook", async () => {
    for (const [target, expectedAttr, expectedMethod] of [
      ["beforeEach", "[SetUp]", "SetupAsync"],
      ["oneTimeSetUp", "[OneTimeSetUp]", "OneTimeSetupAsync"],
    ] as const) {
      const report = makeReport();
      (report as unknown as { targetMethod: string }).targetMethod = target;
      report.suiteName = `Hook_${target}`;
      await emitCsharp({
        projectRoot,
        projectName: PROJECT_NAME,
        runId: "run-12345678",
        report,
        targetMode: "new_suite",
        existingSuiteFile: null,
      });
      const testsDir = path.join(projectRoot, "Demo.Tests/Tests");
      const entries = await fs.readdir(testsDir);
      const file = entries.find(
        (e) => e.toLowerCase().includes(target.toLowerCase()) && e.endsWith(".cs"),
      );
      expect(file, `expected a test file for ${target}, saw ${entries.join(",")}`).toBeTruthy();
      const testCs = await fs.readFile(path.join(testsDir, file!), "utf8");
      expect(testCs).toContain(expectedAttr);
      expect(testCs).toContain(`public async Task ${expectedMethod}()`);
      await fs.rm(testsDir, { recursive: true, force: true });
    }
  });

  it("rejects path-traversal attempts in suiteName", async () => {
    const evil = makeReport();
    evil.suiteName = "../../etc/passwd";
    // Sanitization downgrades to a safe identifier, so the call must
    // succeed and write inside the project root only.
    const written = await emitCsharp({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-12345678",
      report: evil,
      targetMode: "new_suite",
      existingSuiteFile: null,
    });
    for (const rel of written) {
      expect(rel.startsWith("..")).toBe(false);
      expect(rel).not.toContain("/etc/");
    }
  });
});
