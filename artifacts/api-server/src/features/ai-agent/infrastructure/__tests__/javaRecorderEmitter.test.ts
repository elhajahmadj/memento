import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emitJava } from "../javaRecorderEmitter";
import type { AiRunReport } from "@/features/ai-agent/domain/types";

let tmp: string;
let projectRoot: string;
const PROJECT_NAME = "Demo";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-emit-java-"));
  projectRoot = path.join(tmp, PROJECT_NAME);
  // Mimic Maven multi-module layout from scaffoldJavaFromArchitecture
  // — write the marker so the emitter discovers package + tests module.
  await fs.mkdir(path.join(projectRoot, "Demo-tests"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".testbuilder.json"),
    JSON.stringify({
      architectureId: "x",
      testProjectName: "Demo-tests",
      namespace: "demo",
      solutionName: "Demo",
      language: "java",
    }),
  );
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function playwrightReport(): AiRunReport {
  return {
    runId: "run-jvabcdef",
    suiteName: "LoginTest",
    kind: "playwright",
    status: "succeeded",
    categories: [],
    startedAt: new Date().toISOString(),
    catalogDeltas: { newMethods: [], newSelectors: [], newCategories: [] },
    steps: [
      {
        index: 0,
        input: "navigate",
        method: { name: "NavigateTo", source: "existing", matchType: "exact" },
        playwrightCalls: [{ method: "page.goto", args: ["https://x.test/login"] }],
        result: "passed",
      },
      {
        index: 1,
        input: "fill Username with alice",
        method: { name: "FillUsername", source: "ai-created", matchType: "semantic" },
        inputs: [{ field: "Username", value: "alice" }],
        playwrightCalls: [
          { method: "page.fill", selector: '[name="username"]', value: "alice" },
        ],
        result: "passed",
      },
      {
        index: 2,
        input: "click Sign-in",
        method: { name: "ClickSignIn", source: "ai-created", matchType: "semantic" },
        playwrightCalls: [{ method: "page.click", selector: "text=Sign-in" }],
        result: "passed",
      },
    ],
  };
}

describe("emitJava", () => {
  it("writes recorder-style files for Playwright kind", async () => {
    const written = await emitJava({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-jvabcdef",
      report: playwrightReport(),
      targetMode: "new_suite",
    });
    expect(written).toContain(
      "Demo-tests/src/test/resources/application.properties",
    );
    expect(written).toContain("Demo-tests/src/test/java/demo/pages/LoginPage.java");
    expect(written).toContain(
      "Demo-tests/src/test/java/demo/constants/LoginConstants.java",
    );
    expect(written).toContain("Demo-tests/src/test/java/demo/tests/LoginTests.java");
    const test = await fs.readFile(
      path.join(projectRoot, "Demo-tests/src/test/java/demo/tests/LoginTests.java"),
      "utf8",
    );
    expect(test).toMatch(/package demo\.tests;/);
    expect(test).toMatch(/import demo\.pages\.LoginPage;/);
    expect(test).toMatch(/po\.fillUsername\(LoginConstants\.USERNAME\)/);
    expect(test).toMatch(/po\.clickSignIn\(\)/);
    const page = await fs.readFile(
      path.join(projectRoot, "Demo-tests/src/test/java/demo/pages/LoginPage.java"),
      "utf8",
    );
    expect(page).toMatch(/public class LoginPage \{/);
    expect(page).toMatch(/public void fillUsername\(String value\)/);
  });

  it("writes sibling subclass when page object exists, and unique class for test on collision", async () => {
    const pageDir = path.join(
      projectRoot,
      "Demo-tests/src/test/java/demo/pages",
    );
    const testDir = path.join(
      projectRoot,
      "Demo-tests/src/test/java/demo/tests",
    );
    await fs.mkdir(pageDir, { recursive: true });
    await fs.mkdir(testDir, { recursive: true });
    const origPage =
      "package demo.pages;\npublic class LoginPage {\n    protected final com.microsoft.playwright.Page page;\n    public LoginPage(com.microsoft.playwright.Page page) { this.page = page; }\n}\n";
    await fs.writeFile(path.join(pageDir, "LoginPage.java"), origPage);
    const origTest =
      "package demo.tests;\npublic class LoginTests {}\n";
    await fs.writeFile(path.join(testDir, "LoginTests.java"), origTest);

    const written = await emitJava({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-jvabcdef",
      report: playwrightReport(),
      targetMode: "new_suite",
    });
    expect(written).toContain(
      "Demo-tests/src/test/java/demo/pages/LoginPageAiAdditions.java",
    );
    const sib = await fs.readFile(
      path.join(pageDir, "LoginPageAiAdditions.java"),
      "utf8",
    );
    expect(sib).toMatch(/class LoginPageAiAdditions extends LoginPage/);
    // original page untouched
    expect(await fs.readFile(path.join(pageDir, "LoginPage.java"), "utf8")).toBe(
      origPage,
    );
    // test file collision -> unique class name with run-id suffix
    const uniqueTest = written.find((p) =>
      p.includes("LoginTests_AiMethod_"),
    );
    expect(uniqueTest).toBeDefined();
    expect(await fs.readFile(path.join(testDir, "LoginTests.java"), "utf8")).toBe(
      origTest,
    );
  });

  it("emits api kind using java.net.http.HttpClient", async () => {
    const report: AiRunReport = {
      runId: "run-jvabcdef",
      suiteName: "HealthCheck",
      kind: "api",
      status: "succeeded",
      categories: [],
      startedAt: new Date().toISOString(),
      catalogDeltas: { newMethods: [], newSelectors: [], newCategories: [] },
      steps: [
        {
          index: 0,
          input: "GET /health expect 200",
          method: { name: "GetHealth", source: "ai-created", matchType: "semantic" },
          httpCalls: [{ method: "GET", url: "https://x.test/health", status: 200 }],
          result: "passed",
        },
      ],
    };
    const written = await emitJava({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-jvabcdef",
      report,
      targetMode: "new_suite",
    });
    expect(written).toContain(
      "Demo-tests/src/test/java/demo/tests/HealthCheckApiTests.java",
    );
    const t = await fs.readFile(
      path.join(
        projectRoot,
        "Demo-tests/src/test/java/demo/tests/HealthCheckApiTests.java",
      ),
      "utf8",
    );
    expect(t).toMatch(/HttpClient\.newHttpClient\(\)/);
    expect(t).toMatch(/assertEquals\(200, response\.statusCode\(\)\)/);
  });

  it("emits unit kind", async () => {
    const report: AiRunReport = {
      runId: "run-jvabcdef",
      suiteName: "MathHelpers",
      kind: "unit",
      status: "succeeded",
      categories: [],
      startedAt: new Date().toISOString(),
      catalogDeltas: { newMethods: [], newSelectors: [], newCategories: [] },
      steps: [
        {
          index: 0,
          input: "add 2+3 = 5",
          method: { name: "Add", source: "ai-created", matchType: "semantic" },
          unitCalls: [{ function: "add", args: [2, 3], expected: 5 }],
          result: "passed",
        },
      ],
    };
    const written = await emitJava({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-jvabcdef",
      report,
      targetMode: "new_suite",
    });
    expect(written).toContain(
      "Demo-tests/src/test/java/demo/tests/MathHelpersUnitTests.java",
    );
    const t = await fs.readFile(
      path.join(
        projectRoot,
        "Demo-tests/src/test/java/demo/tests/MathHelpersUnitTests.java",
      ),
      "utf8",
    );
    expect(t).toMatch(/assertEquals\(5, add\(2, 3\)\)/);
  });

  it("honors methodName + ignore + named URL key from the dialog", async () => {
    const report = playwrightReport();
    report.urlNames = [{ url: "https://x.test/login", name: "GoogleBaseUrl" }];
    report.methodName = "GivenLoginPage_WhenSignIn_ThenSucceeds";
    report.ignore = true;
    report.ignoreReason = "flaky on CI";
    report.targetMethod = "test";
    await emitJava({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-jvabcdef",
      report,
      targetMode: "new_suite",
    });
    const props = await fs.readFile(
      path.join(
        projectRoot,
        "Demo-tests/src/test/resources/application.properties",
      ),
      "utf8",
    );
    expect(props).toMatch(/^google\.base\.url=/m);
    expect(props).not.toMatch(/^base\.url=/m);
    const cfg = await fs.readFile(
      path.join(
        projectRoot,
        "Demo-tests/src/test/java/demo/config/Config.java",
      ),
      "utf8",
    );
    expect(cfg).toMatch(/public String getGoogleBaseUrl\(\)/);
    const test = await fs.readFile(
      path.join(
        projectRoot,
        "Demo-tests/src/test/java/demo/tests/LoginTests.java",
      ),
      "utf8",
    );
    expect(test).toMatch(/new demo\.config\.Config\(\)\.getGoogleBaseUrl\(\)/);
    expect(test).toMatch(/@Disabled\("flaky on CI"\)/);
    expect(test).toMatch(/void GivenLoginPage_WhenSignIn_ThenSucceeds\(/);
  });

  it("add_method appends @Test into the picked existing class, no sibling file", async () => {
    const existRel =
      "Demo-tests/src/test/java/demo/tests/LoginTests.java";
    const existAbs = path.join(projectRoot, existRel);
    await fs.mkdir(path.dirname(existAbs), { recursive: true });
    const orig = `package demo.tests;

import org.junit.jupiter.api.Test;

public class LoginTests {
    @Test
    public void existingHappyPath() {
        // pre-existing
    }
}
`;
    await fs.writeFile(existAbs, orig);

    const report = playwrightReport();
    report.methodName = "GivenLogin_WhenSignIn_ThenSucceeds";
    const written = await emitJava({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-jvabcdef",
      report,
      targetMode: "add_method",
      existingSuiteFile: existRel,
    });

    // The existing file is the (only) test-class write — no sibling.
    expect(written).toContain(existRel);
    expect(
      written.find((p) => p.includes("LoginTests_AiMethod_")),
    ).toBeUndefined();
    const after = await fs.readFile(existAbs, "utf8");
    expect(after).toContain("existingHappyPath"); // preserved
    expect(after).toContain("GivenLogin_WhenSignIn_ThenSucceeds(");
    // Imports for the new chunk should have been deduped + injected.
    expect(after).toMatch(/import com\.microsoft\.playwright\.\*;/);
    // Single declared class — we never duplicated the class block.
    const classMatches = after.match(/\bclass\s+LoginTests\b/g) ?? [];
    expect(classMatches.length).toBe(1);
  });

  it("add_method rejects a missing or unparseable existing suite file", async () => {
    await expect(
      emitJava({
        projectRoot,
        projectName: PROJECT_NAME,
        runId: "run-jvabcdef",
        report: playwrightReport(),
        targetMode: "add_method",
        existingSuiteFile: null,
      }),
    ).rejects.toThrow(/no existing suite file/i);

    const badRel = "Demo-tests/src/test/java/demo/tests/Nope.java";
    await expect(
      emitJava({
        projectRoot,
        projectName: PROJECT_NAME,
        runId: "run-jvabcdef",
        report: playwrightReport(),
        targetMode: "add_method",
        existingSuiteFile: badRel,
      }),
    ).rejects.toThrow(/cannot attach to/i);
  });

  it("persists hook plan into a hidden {Pascal}Tests.setup sidecar", async () => {
    const planText = "1. sign in as alice\n2. wait for dashboard";
    const report = playwrightReport();
    (report as { targetMethod?: string }).targetMethod = "beforeEach";
    report.suiteName = "SmokeFlow";
    const written = await emitJava({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-jvabcdef",
      report,
      targetMode: "new_suite",
      planText,
    });
    const sidecarRel =
      "Demo-tests/src/test/java/demo/tests/SmokeFlowTests.setup";
    expect(written).toContain(sidecarRel);
    const txt = await fs.readFile(
      path.join(projectRoot, sidecarRel),
      "utf8",
    );
    expect(txt.trim()).toBe(planText);
  });

  it("routes targetMethod=beforeEach into a @BeforeEach hook", async () => {
    const report = playwrightReport();
    report.targetMethod = "beforeEach";
    report.methodName = "primeLogin";
    await emitJava({
      projectRoot,
      projectName: PROJECT_NAME,
      runId: "run-jvabcdef",
      report,
      targetMode: "new_suite",
    });
    const test = await fs.readFile(
      path.join(
        projectRoot,
        "Demo-tests/src/test/java/demo/tests/LoginTests.java",
      ),
      "utf8",
    );
    expect(test).toMatch(/@BeforeEach/);
  });
});
