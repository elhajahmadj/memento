import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emitPython } from "../pythonRecorderEmitter";
import type { AiRunReport } from "@/features/ai-agent/domain/types";

let tmp: string;
let projectRoot: string;
const PROJECT_NAME = "demo";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-emit-py-"));
  projectRoot = path.join(tmp, PROJECT_NAME);
  await fs.mkdir(projectRoot, { recursive: true });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function playwrightReport(): AiRunReport {
  return {
    runId: "run-pyabcdef",
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

describe("emitPython", () => {
  it("writes recorder-style files for Playwright kind", async () => {
    const written = await emitPython({
      projectRoot,
      runId: "run-pyabcdef",
      report: playwrightReport(),
      targetMode: "new_suite",
    });
    expect(written).toContain("config.py");
    expect(written).toContain("pages/login_page.py");
    expect(written).toContain("tests/constants/login_constants.py");
    expect(written).toContain("tests/test_login.py");
    const test = await fs.readFile(
      path.join(projectRoot, "tests/test_login.py"),
      "utf8",
    );
    expect(test).toMatch(/from pages\.login_page import LoginPage/);
    expect(test).toMatch(/login_page\.fill_username\(login_constants\.USERNAME\)/);
    expect(test).toMatch(/login_page\.click_sign_in\(\)/);
    const page = await fs.readFile(
      path.join(projectRoot, "pages/login_page.py"),
      "utf8",
    );
    expect(page).toMatch(/class LoginPage:/);
    expect(page).toMatch(/def fill_username\(self, value: str\)/);
  });

  it("writes a sibling additions class when page object exists", async () => {
    await fs.mkdir(path.join(projectRoot, "pages"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "pages/login_page.py"),
      "class LoginPage:\n    def __init__(self, page):\n        self.page = page\n",
    );
    const written = await emitPython({
      projectRoot,
      runId: "run-pyabcdef",
      report: playwrightReport(),
      targetMode: "new_suite",
    });
    expect(written).toContain("pages/login_page_ai_generated.py");
    const original = await fs.readFile(
      path.join(projectRoot, "pages/login_page.py"),
      "utf8",
    );
    expect(original).toBe(
      "class LoginPage:\n    def __init__(self, page):\n        self.page = page\n",
    );
    const sibling = await fs.readFile(
      path.join(projectRoot, "pages/login_page_ai_generated.py"),
      "utf8",
    );
    expect(sibling).toMatch(/class LoginPageAiAdditions\(LoginPage\):/);
  });

  it("emits api kind without page objects", async () => {
    const report: AiRunReport = {
      runId: "run-pyabcdef",
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
    const written = await emitPython({
      projectRoot,
      runId: "run-pyabcdef",
      report,
      targetMode: "new_suite",
    });
    expect(written).toContain("tests/test_health_check.py");
    expect(written.find((p) => p.startsWith("pages/"))).toBeUndefined();
    const t = await fs.readFile(
      path.join(projectRoot, "tests/test_health_check.py"),
      "utf8",
    );
    expect(t).toMatch(/import httpx/);
    expect(t).toMatch(/httpx\.get\("https:\/\/x\.test\/health"\)/);
    expect(t).toMatch(/assert response\.status_code == 200/);
  });

  it("emits unit kind", async () => {
    const report: AiRunReport = {
      runId: "run-pyabcdef",
      suiteName: "MathHelpers",
      kind: "unit",
      status: "succeeded",
      categories: [],
      startedAt: new Date().toISOString(),
      catalogDeltas: { newMethods: [], newSelectors: [], newCategories: [] },
      steps: [
        {
          index: 0,
          input: "add 2 and 3 equals 5",
          method: { name: "Add", source: "ai-created", matchType: "semantic" },
          unitCalls: [{ function: "add", args: [2, 3], expected: 5 }],
          result: "passed",
        },
      ],
    };
    const written = await emitPython({
      projectRoot,
      runId: "run-pyabcdef",
      report,
      targetMode: "new_suite",
    });
    expect(written).toContain("tests/test_math_helpers.py");
    const t = await fs.readFile(
      path.join(projectRoot, "tests/test_math_helpers.py"),
      "utf8",
    );
    expect(t).toMatch(/assert add\(2, 3\) == 5/);
  });

  it("honors methodName + ignore + named URL key from the dialog", async () => {
    const report = playwrightReport();
    report.urlNames = [{ url: "https://x.test/login", name: "GoogleBaseUrl" }];
    report.methodName = "GivenLoginPage_WhenSignIn_ThenSucceeds";
    report.ignore = true;
    report.ignoreReason = "flaky on CI";
    report.targetMethod = "test";
    await emitPython({
      projectRoot,
      runId: "run-pyabcdef",
      report,
      targetMode: "new_suite",
    });
    const cfg = await fs.readFile(
      path.join(projectRoot, "config.py"),
      "utf8",
    );
    expect(cfg).toMatch(/^GOOGLE_BASE_URL = /m);
    expect(cfg).not.toMatch(/^BASE_URL = /m);
    const test = await fs.readFile(
      path.join(projectRoot, "tests/test_login.py"),
      "utf8",
    );
    expect(test).toMatch(/import config/);
    expect(test).toMatch(/page\.goto\(config\.GOOGLE_BASE_URL\)/);
    expect(test).toMatch(/@pytest\.mark\.skip\(reason="flaky on CI"\)/);
    expect(test).toMatch(
      /def test_given_login_page_when_sign_in_then_succeeds\(/,
    );
  });

  it("add_method appends the new def test_* into the selected existing suite", async () => {
    // Seed an existing suite file the dialog might present in its
    // "Add to existing suite" dropdown. Body has one prior test plus
    // a `page.goto(config.GOOGLE_BASE_URL)` import that should be
    // de-duplicated when the new test's imports are merged in.
    const existingRel = "tests/test_login.py";
    const existingAbs = path.join(projectRoot, existingRel);
    await fs.mkdir(path.dirname(existingAbs), { recursive: true });
    await fs.writeFile(
      existingAbs,
      [
        "import pytest",
        "import config",
        "",
        "",
        "def test_existing_smoke(page):",
        "    page.goto(config.BASE_URL)",
        "    assert page.title()",
        "",
      ].join("\n"),
    );

    const report = playwrightReport();
    report.methodName = "GivenLoginPage_WhenSignIn_ThenSucceeds";
    const written = await emitPython({
      projectRoot,
      runId: "run-pyabcdef",
      report,
      targetMode: "add_method",
      existingSuiteFile: existingRel,
    });

    // No sibling test file may be created in add_method mode.
    const siblingExists = await fs
      .stat(path.join(projectRoot, "tests/test_login_ai_run-pyab.py"))
      .then(() => true)
      .catch(() => false);
    expect(siblingExists).toBe(false);
    expect(written).toContain(existingRel);
    expect(
      written.some((p) => /tests\/test_login_ai_/.test(p)),
    ).toBe(false);

    const merged = await fs.readFile(existingAbs, "utf8");
    // Existing test is preserved …
    expect(merged).toMatch(/def test_existing_smoke\(page\):/);
    // … and the new def is appended.
    expect(merged).toMatch(
      /def test_given_login_page_when_sign_in_then_succeeds\(/,
    );
    // Imports were merged (no duplicate `import pytest`).
    expect(merged.match(/^import pytest$/gm)?.length ?? 0).toBe(1);
    // Run-id marker comment is present so reviewers can trace the addition.
    expect(merged).toMatch(/# generated by Memento AI Agent — run run-pyabcdef/);
  });

  it("add_method fails fast when no existing suite is selected", async () => {
    const report = playwrightReport();
    await expect(
      emitPython({
        projectRoot,
        runId: "run-pyabcdef",
        report,
        targetMode: "add_method",
      }),
    ).rejects.toThrow(/no existing suite file was selected/);
  });

  it("writes a .setup sidecar when recording a pytest setup primitive with plan text", async () => {
    const report = playwrightReport();
    report.targetMethod = "beforeEach";
    const written = await emitPython({
      projectRoot,
      runId: "run-pyabcdef",
      report,
      targetMode: "new_suite",
      planText: "open the login page and dismiss the cookie banner",
    });
    expect(written).toContain("tests/test_login.setup");
    const sidecar = await fs.readFile(
      path.join(projectRoot, "tests/test_login.setup"),
      "utf8",
    );
    expect(sidecar.trim()).toBe(
      "open the login page and dismiss the cookie banner",
    );
  });

  it("does NOT write a .setup sidecar for plain test runs", async () => {
    const report = playwrightReport();
    report.targetMethod = "test";
    const written = await emitPython({
      projectRoot,
      runId: "run-pyabcdef",
      report,
      targetMode: "new_suite",
      planText: "this should be ignored for non-setup runs",
    });
    expect(written.some((p) => p.endsWith(".setup"))).toBe(false);
  });

  it("routes targetMethod=beforeEach into an autouse fixture with page injection", async () => {
    const report = playwrightReport();
    report.targetMethod = "beforeEach";
    await emitPython({
      projectRoot,
      runId: "run-pyabcdef",
      report,
      targetMode: "new_suite",
    });
    const test = await fs.readFile(
      path.join(projectRoot, "tests/test_login.py"),
      "utf8",
    );
    expect(test).toMatch(/class TestLogin:/);
    expect(test).toMatch(/@pytest\.fixture\(autouse=True\)/);
    expect(test).toMatch(/def _ai_capture_page\(self, page\)/);
    expect(test).toMatch(/self\.page = page/);
    expect(test).toMatch(/def setup_method\(self, method\)/);
    expect(test).toMatch(/self\.login_page\.click_sign_in\(\)/);
  });
});
