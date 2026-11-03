import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emitNode } from "../nodejsRecorderEmitter";
import type { AiRunReport } from "@/features/ai-agent/domain/types";

let tmp: string;
let projectRoot: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-emit-node-"));
  projectRoot = path.join(tmp, "demo");
  await fs.mkdir(projectRoot, { recursive: true });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function playwrightReport(): AiRunReport {
  return {
    runId: "run-nd123456",
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

describe("emitNode", () => {
  it("writes recorder-style files for Playwright kind", async () => {
    const written = await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report: playwrightReport(),
      targetMode: "new_suite",
    });
    expect(written).toContain("tests/config.ts");
    expect(written).toContain("pages/LoginPage.ts");
    expect(written).toContain("tests/constants/login-constants.ts");
    expect(written).toContain("tests/login.spec.ts");
    const spec = await fs.readFile(
      path.join(projectRoot, "tests/login.spec.ts"),
      "utf8",
    );
    expect(spec).toMatch(/import { LoginPage } from "..\/pages\/LoginPage"/);
    expect(spec).toMatch(/await po\.fillUsername\(USERNAME\)/);
    expect(spec).toMatch(/await po\.clickSignIn\(\)/);
    const page = await fs.readFile(
      path.join(projectRoot, "pages/LoginPage.ts"),
      "utf8",
    );
    expect(page).toMatch(/export class LoginPage \{/);
    expect(page).toMatch(/async fillUsername\(value: string\)/);
  });

  it("writes a sibling additions class when page object exists", async () => {
    await fs.mkdir(path.join(projectRoot, "pages"), { recursive: true });
    const original = `export class LoginPage {\n  constructor(public page: any) {}\n}\n`;
    await fs.writeFile(path.join(projectRoot, "pages/LoginPage.ts"), original);
    const written = await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report: playwrightReport(),
      targetMode: "new_suite",
    });
    expect(written).toContain("pages/LoginPage.AiGenerated.ts");
    const stillThere = await fs.readFile(
      path.join(projectRoot, "pages/LoginPage.ts"),
      "utf8",
    );
    expect(stillThere).toBe(original);
    const sib = await fs.readFile(
      path.join(projectRoot, "pages/LoginPage.AiGenerated.ts"),
      "utf8",
    );
    expect(sib).toMatch(/export class LoginPageAiAdditions extends LoginPage/);
  });

  it("emits api kind using the request fixture", async () => {
    const report: AiRunReport = {
      runId: "run-nd123456",
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
    const written = await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report,
      targetMode: "new_suite",
    });
    expect(written).toContain("tests/health-check.api.spec.ts");
    expect(written.find((p) => p.startsWith("pages/"))).toBeUndefined();
    const t = await fs.readFile(
      path.join(projectRoot, "tests/health-check.api.spec.ts"),
      "utf8",
    );
    expect(t).toMatch(/async \(\{ request \}\)/);
    expect(t).toMatch(/await request\.get\("https:\/\/x\.test\/health"\)/);
    expect(t).toMatch(/expect\(response\.status\(\)\)\.toBe\(200\)/);
  });

  it("emits unit kind", async () => {
    const report: AiRunReport = {
      runId: "run-nd123456",
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
    const written = await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report,
      targetMode: "new_suite",
    });
    expect(written).toContain("tests/math-helpers.unit.spec.ts");
    const t = await fs.readFile(
      path.join(projectRoot, "tests/math-helpers.unit.spec.ts"),
      "utf8",
    );
    expect(t).toMatch(/expect\(add\(2, 3\)\)\.toEqual\(5\)/);
  });

  it("honors methodName + ignore + named URL key from the dialog", async () => {
    const report = playwrightReport();
    report.urlNames = [{ url: "https://x.test/login", name: "GoogleBaseUrl" }];
    report.methodName = "GivenLoginPage_WhenSignIn_ThenSucceeds";
    report.ignore = true;
    report.ignoreReason = "flaky on CI";
    report.targetMethod = "test";
    await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report,
      targetMode: "new_suite",
    });
    const cfg = await fs.readFile(
      path.join(projectRoot, "tests/config.ts"),
      "utf8",
    );
    expect(cfg).toMatch(/export const GOOGLE_BASE_URL =/);
    expect(cfg).not.toMatch(/export const BASE_URL =/);
    const spec = await fs.readFile(
      path.join(projectRoot, "tests/login.spec.ts"),
      "utf8",
    );
    expect(spec).toMatch(/import \* as config from "\.\/config"/);
    expect(spec).toMatch(/await page\.goto\(config\.GOOGLE_BASE_URL\)/);
    expect(spec).toMatch(
      /test\.skip\(\s*"GivenLoginPage_WhenSignIn_ThenSucceeds"/,
    );
    expect(spec).toMatch(/test\.skip\(true, "flaky on CI"\)/);
  });

  it("appends into the user-selected existing spec in add_method mode", async () => {
    // Seed an existing spec the user picked in the dialog.
    await fs.mkdir(path.join(projectRoot, "tests"), { recursive: true });
    const existingPath = path.join(projectRoot, "tests/checkout.spec.ts");
    const existing = [
      `// existing suite — DO NOT REGENERATE`,
      ``,
      `import { test } from "@playwright/test";`,
      ``,
      `test.describe("Checkout", () => {`,
      `  test("buys one item", async ({ page }) => {`,
      `    await page.goto("/");`,
      `  });`,
      `});`,
      ``,
    ].join("\n");
    await fs.writeFile(existingPath, existing);

    const report = playwrightReport();
    report.targetMethod = "test";
    report.methodName = "GivenLoginPage_WhenSignIn_ThenSucceeds";
    const written = await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report,
      targetMode: "add_method",
      existingSuiteFile: "tests/checkout.spec.ts",
    });

    // NO sibling spec was created.
    expect(written).toContain("tests/checkout.spec.ts");
    expect(
      written.find((p) => p.startsWith("tests/login")),
    ).toBeUndefined();
    expect(
      written.find((p) => /\.ai-[a-f0-9]+\.spec\.ts$/.test(p)),
    ).toBeUndefined();

    const merged = await fs.readFile(existingPath, "utf8");
    // Original content survives.
    expect(merged).toMatch(/test\("buys one item"/);
    // Run marker is present.
    expect(merged).toMatch(
      /generated by Memento AI Agent — run run-nd123456/,
    );
    // The new test is appended.
    expect(merged).toMatch(
      /test\(\s*"GivenLoginPage_WhenSignIn_ThenSucceeds"/,
    );
    // Imports were deduped — only one `@playwright/test` import.
    const playwrightImports = merged
      .split("\n")
      .filter((l) => l.trim().startsWith("import") && l.includes("@playwright/test"));
    expect(playwrightImports.length).toBe(1);
  });

  it("throws when add_method is requested without an existing suite file", async () => {
    await expect(
      emitNode({
        projectRoot,
        runId: "run-nd123456",
        report: playwrightReport(),
        targetMode: "add_method",
      }),
    ).rejects.toThrow(/no existing suite file was selected/);
  });

  it("throws when add_method points at a non-existent file", async () => {
    await expect(
      emitNode({
        projectRoot,
        runId: "run-nd123456",
        report: playwrightReport(),
        targetMode: "add_method",
        existingSuiteFile: "tests/does-not-exist.spec.ts",
      }),
    ).rejects.toThrow(/cannot attach to/);
  });

  it("writes a .setup sidecar next to a new spec for beforeEach hooks", async () => {
    const report = playwrightReport();
    report.targetMethod = "beforeEach";
    report.methodName = "PrimeLogin";
    const written = await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report,
      targetMode: "new_suite",
      planText: "Sign the user in and stash the session cookie.",
    });
    expect(written).toContain("tests/login.spec.setup");
    const sidecar = await fs.readFile(
      path.join(projectRoot, "tests/login.spec.setup"),
      "utf8",
    );
    expect(sidecar.trim()).toBe("Sign the user in and stash the session cookie.");
  });

  it("writes a .setup sidecar next to an existing spec when appending a hook", async () => {
    await fs.mkdir(path.join(projectRoot, "tests"), { recursive: true });
    const existingPath = path.join(projectRoot, "tests/checkout.spec.ts");
    await fs.writeFile(
      existingPath,
      `import { test } from "@playwright/test";\n\ntest("smoke", async () => {});\n`,
    );
    const report = playwrightReport();
    report.targetMethod = "beforeEach";
    report.methodName = "PrimeLogin";
    const written = await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report,
      targetMode: "add_method",
      existingSuiteFile: "tests/checkout.spec.ts",
      planText: "Prime an authenticated session before each test.",
    });
    expect(written).toContain("tests/checkout.spec.setup");
    const sidecar = await fs.readFile(
      path.join(projectRoot, "tests/checkout.spec.setup"),
      "utf8",
    );
    expect(sidecar.trim()).toBe("Prime an authenticated session before each test.");
  });

  it("does NOT write a sidecar for plain test() runs", async () => {
    const written = await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report: playwrightReport(),
      targetMode: "new_suite",
      planText: "irrelevant — this is a normal test run",
    });
    expect(
      written.find((p) => p.endsWith(".setup")),
    ).toBeUndefined();
  });

  it("routes targetMethod=beforeEach into a beforeEach hook", async () => {
    const report = playwrightReport();
    report.targetMethod = "beforeEach";
    report.methodName = "PrimeLogin";
    await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report,
      targetMode: "new_suite",
    });
    const spec = await fs.readFile(
      path.join(projectRoot, "tests/login.spec.ts"),
      "utf8",
    );
    expect(spec).toMatch(/test\.beforeEach\(/);
  });

  it("appends a new test() into the user-selected existing spec in add_method mode (no sibling .ai-{run}.spec.ts)", async () => {
    // Seed an existing hand-written Playwright spec the user will pick.
    const existingRel = "tests/login.spec.ts";
    await fs.mkdir(path.join(projectRoot, "tests"), { recursive: true });
    const original = `import { test } from "@playwright/test";

test("existing scenario", async ({ page }) => {
  await page.goto("https://x.test/login");
});
`;
    await fs.writeFile(path.join(projectRoot, existingRel), original);

    const report = playwrightReport();
    report.methodName = "GivenLoginPage_WhenSignIn_ThenSucceeds";
    const written = await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report,
      targetMode: "add_method",
      existingSuiteFile: existingRel,
    });

    // The emitter MUST attach to the user-selected spec, not create a sibling.
    expect(written).toContain(existingRel);
    expect(
      written.find((p) => /login\.ai-[a-z0-9]+\.spec\.ts$/i.test(p)),
      `expected NO sibling .ai-{run}.spec.ts, saw: ${written.join(", ")}`,
    ).toBeUndefined();

    const updated = await fs.readFile(
      path.join(projectRoot, existingRel),
      "utf8",
    );
    // Original test is still present, and the new test was appended.
    expect(updated).toContain(`test("existing scenario"`);
    expect(updated).toMatch(
      /test\(\s*"GivenLoginPage_WhenSignIn_ThenSucceeds"/,
    );
    // The page-object import was added (it was not in the original).
    expect(updated).toContain(
      `import { LoginPage } from "../pages/LoginPage";`,
    );
    // `test` is only imported once — the appender de-dupes by module path.
    expect(updated.match(/from "@playwright\/test"/g)?.length).toBe(1);
  });

  it("rejects add_method when no existing suite file is selected", async () => {
    await expect(
      emitNode({
        projectRoot,
        runId: "run-nd123456",
        report: playwrightReport(),
        targetMode: "add_method",
        existingSuiteFile: null,
      }),
    ).rejects.toThrow(/no existing suite file was selected/i);

    await expect(
      emitNode({
        projectRoot,
        runId: "run-nd123456",
        report: playwrightReport(),
        targetMode: "add_method",
        existingSuiteFile: "tests/does-not-exist.spec.ts",
      }),
    ).rejects.toThrow(/cannot attach to/i);
  });

  it("persists the user plan into a hidden tests/{kebab}.spec.setup sidecar on hook runs", async () => {
    const planText = "1. Sign in as alice\n2. Wait for dashboard to load";
    const report = playwrightReport();
    report.targetMethod = "beforeEach";
    report.methodName = "PrimeLogin";

    const written = await emitNode({
      projectRoot,
      runId: "run-nd123456",
      report,
      targetMode: "new_suite",
      planText,
    });

    const sidecarRel = "tests/login.spec.setup";
    expect(written).toContain(sidecarRel);
    const sidecar = await fs.readFile(
      path.join(projectRoot, sidecarRel),
      "utf8",
    );
    expect(sidecar.trim()).toBe(planText);
    // Sidecar uses a `.spec.setup` extension (not `.spec.ts`) so the
    // test-discovery walker — which dispatches by extension — skips it.
    expect(path.posix.extname(sidecarRel)).toBe(".setup");
  });
});
