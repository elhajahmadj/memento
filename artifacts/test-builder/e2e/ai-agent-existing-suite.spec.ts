import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { seedAdminSession } from "./_helpers/admin-session";

/**
 * End-to-end coverage for task #100 — Build with AI suite naming,
 * optional method name, add-to-existing-suite mode, the
 * existing-suite dropdown filter, and the hidden `{ClassName}Setup`
 * sidecar that feeds prior `[SetUp]` / `[OneTimeSetUp]` plans back
 * into the LLM context on follow-up `add_method` runs.
 *
 * Each test scaffolds its own throwaway C# Playwright project so the
 * spec is hermetic and parallel-safe (sequenced by Playwright's
 * `workers: 1`). When a test needs a pre-existing suite or sidecar
 * we write it directly to disk under `<workspaceDir>/<project>/...`
 * — the same path the runner reads from.
 *
 * Gated on `E2E_API_BASE_URL` (e.g. `http://localhost:80`) and
 * requires the api-server to run with `APP_ENVIRONMENT=development`
 * so `/api/auth/dev-login` is enabled.
 */
const BASE = process.env.E2E_API_BASE_URL;
const WORKSPACE_DIR =
  process.env.WORKSPACE_DIR ?? "/home/runner/workspace/workspace";

const RULE_PARSER_PLAN = [
  "Navigate to https://example.com",
  "Click the Sign In button",
  "Fill the username field with alice",
].join("\n");

type ProjectFixture = {
  solutionName: string;
  testProjectName: string;
  namespace: string;
  slnPath: string;
  projectRoot: string;
};

async function seedAdminCookie(
  ctx: Page | { request: APIRequestContext },
  base: string,
): Promise<void> {
  await seedAdminSession(ctx, base);
}

async function ensureAiAgentReady(
  request: APIRequestContext,
  base: string,
  projectName: string,
): Promise<void> {
  // Org-enable flag still lives on the legacy `ai_agent_org_configs`
  // row, so the orgEnabled gate flips correctly.
  const cfg = await request.put(`${base}/api/ai-agent/org-config`, {
    data: { enabled: true, provider: "anthropic" },
  });
  if (!cfg.ok()) {
    throw new Error(
      `ai-agent/org-config failed: ${cfg.status()} ${await cfg.text()}`,
    );
  }
  // Runner resolves the active key from `ai_agent_keys` (new library),
  // not the legacy column. Create a default fake key if none exists.
  const listRes = await request.get(`${base}/api/ai-agent/keys`);
  if (!listRes.ok()) {
    throw new Error(
      `ai-agent/keys list failed: ${listRes.status()} ${await listRes.text()}`,
    );
  }
  const list = (await listRes.json()) as {
    keys: Array<{ id: string; isDefault: boolean }>;
  };
  const hasDefault = list.keys.some((k) => k.isDefault);
  if (!hasDefault) {
    const create = await request.post(`${base}/api/ai-agent/keys`, {
      data: {
        name: `e2e-fake-${Date.now().toString(36)}`,
        provider: "anthropic",
        apiKey: "sk-ant-e2e-fake-key-for-tests-not-used",
        isDefault: true,
      },
    });
    if (!create.ok()) {
      throw new Error(
        `ai-agent/keys create failed: ${create.status()} ${await create.text()}`,
      );
    }
  }
  const projCfg = await request.put(
    `${base}/api/ai-agent/projects/${encodeURIComponent(projectName)}/config`,
    { data: { enabled: true } },
  );
  if (!projCfg.ok()) {
    throw new Error(
      `ai-agent/projects/.../config failed: ${projCfg.status()} ${await projCfg.text()}`,
    );
  }
}

async function scaffoldProject(
  request: APIRequestContext,
  base: string,
  tag: string,
): Promise<ProjectFixture> {
  const solutionName = `E2EAi${tag}${Date.now().toString(36)}`;
  const testProjectName = `${solutionName}.Tests`;
  const namespace = solutionName;
  const res = await request.post(`${base}/api/projects`, {
    data: {
      solutionName,
      testProjectName,
      namespace,
      language: "csharp",
      solutionType: "playwright",
    },
  });
  if (res.status() !== 201) {
    throw new Error(
      `scaffold project failed: ${res.status()} ${await res.text()}`,
    );
  }
  const projectRoot = path.join(WORKSPACE_DIR, solutionName);
  const slnPath = path.join(projectRoot, `${solutionName}.sln`);
  // The POST sets the project as current already, but a subsequent
  // explicit /load makes the cleanup-on-ENOENT path on /projects/tree
  // a non-issue if a later test scaffolds a different project.
  const load = await request.post(`${base}/api/projects/load`, {
    data: { slnPath },
  });
  if (!load.ok()) {
    throw new Error(
      `load scaffolded project failed: ${load.status()} ${await load.text()}`,
    );
  }
  return { solutionName, testProjectName, namespace, slnPath, projectRoot };
}

async function startRun(
  request: APIRequestContext,
  base: string,
  projectName: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await request.post(
    `${base}/api/ai-agent/projects/${encodeURIComponent(projectName)}/runs`,
    { data: body },
  );
  if (res.status() !== 202) {
    throw new Error(
      `start AI run failed: ${res.status()} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as { id: string };
  return json.id;
}

async function waitForRunSucceeded(
  request: APIRequestContext,
  base: string,
  projectName: string,
  runId: string,
  timeoutMs = 30_000,
): Promise<{
  plan: string;
  report: {
    files: Array<{ path: string; bytes: number }>;
    summary: string;
    setupContextText?: string | null;
  } | null;
}> {
  const deadline = Date.now() + timeoutMs;
  let last: {
    status: string;
    plan: string;
    report: {
      files: Array<{ path: string; bytes: number }>;
      summary: string;
      setupContextText?: string | null;
    } | null;
    errorMessage: string | null;
  } | null = null;
  while (Date.now() < deadline) {
    const res = await request.get(
      `${base}/api/ai-agent/projects/${encodeURIComponent(projectName)}/runs/${runId}`,
    );
    if (res.ok()) {
      last = (await res.json()) as typeof last;
      if (last && (last.status === "succeeded" || last.status === "failed")) {
        if (last.status !== "succeeded") {
          throw new Error(
            `AI run did not succeed: status=${last.status} err=${last.errorMessage ?? "(none)"}`,
          );
        }
        return { plan: last.plan, report: last.report };
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `AI run timed out after ${timeoutMs}ms (last=${JSON.stringify(last)})`,
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeSuiteFile(
  projectRoot: string,
  testProjectName: string,
  namespace: string,
  className: string,
): Promise<string> {
  const rel = `${testProjectName}/Tests/${className}.cs`;
  const abs = path.join(projectRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(
    abs,
    `using System.Threading.Tasks;
using NUnit.Framework;
using ${namespace}.Infrastructure.Fixtures;

namespace ${namespace}.Tests
{
    [TestFixture]
    public class ${className} : TestFixture
    {
        [SetUp]
        public Task BeforeEachAsync()
        {
            return Task.CompletedTask;
        }

        [Test]
        public async Task ExistingTestAsync()
        {
            await Task.CompletedTask;
        }
    }
}
`,
    "utf8",
  );
  return rel;
}

test.describe("AI agent — suite naming, method naming, setup sidecar (#100)", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec.",
  );
  test.setTimeout(120_000);

  test("new suite: `LoginPage` becomes Tests/LoginPageTestSuite.cs / class LoginPageTestSuite", async ({
    request,
  }) => {
    const base = BASE!;
    await seedAdminCookie({ request }, base);
    const proj = await scaffoldProject(request, base, "Naming");
    await ensureAiAgentReady(request, base, proj.solutionName);

    const runId = await startRun(request, base, proj.solutionName, {
      kind: "playwright",
      plan: RULE_PARSER_PLAN,
      suiteName: "LoginPage",
      language: "csharp",
      targetMode: "new_suite",
    });
    const { report } = await waitForRunSucceeded(
      request,
      base,
      proj.solutionName,
      runId,
    );
    expect(report).not.toBeNull();
    const suiteRel = `${proj.testProjectName}/Tests/LoginPageTestSuite.cs`;
    const filePaths = report!.files.map((f) => f.path);
    expect(filePaths).toContain(suiteRel);
    const suiteAbs = path.join(proj.projectRoot, suiteRel);
    expect(await fileExists(suiteAbs)).toBe(true);
    const txt = await fs.readFile(suiteAbs, "utf8");
    expect(txt).toMatch(/\bclass\s+LoginPageTestSuite\b/);
    expect(txt).toMatch(/:\s*TestFixture\b/);

    // Companion artifacts retain pre-change naming derived from the
    // suite stem (`LoginPage`) — Selectors / Interfaces / Actions /
    // Constants live at their canonical paths and only the TEST CLASS
    // file is the new `*TestSuite.cs` shape. Regression guard for the
    // case where the suite-rename change accidentally renamed the
    // page-object companions too.
    const suiteStem = "LoginPage";
    const pageName = `${suiteStem}Page`;
    const expectedCompanions = [
      `${proj.testProjectName}/PageObjects/Selectors/${suiteStem}PageSelectors.cs`,
      `${proj.testProjectName}/PageObjects/Interfaces/I${pageName}.cs`,
      `${proj.testProjectName}/PageObjects/Actions/${pageName}.cs`,
      `${proj.testProjectName}/Constants/${suiteStem}Constants.cs`,
    ];
    for (const rel of expectedCompanions) {
      expect(
        await fileExists(path.join(proj.projectRoot, rel)),
        `expected companion artifact ${rel}`,
      ).toBe(true);
    }
    // None of the companions adopted the `*TestSuite` suffix on their
    // own filenames or class declarations.
    const ifaceTxt = await fs.readFile(
      path.join(
        proj.projectRoot,
        `${proj.testProjectName}/PageObjects/Interfaces/I${pageName}.cs`,
      ),
      "utf8",
    );
    expect(ifaceTxt).toMatch(new RegExp(`\\binterface\\s+I${pageName}\\b`));
    expect(ifaceTxt).not.toMatch(/TestSuite/);
    const actionsTxt = await fs.readFile(
      path.join(
        proj.projectRoot,
        `${proj.testProjectName}/PageObjects/Actions/${pageName}.cs`,
      ),
      "utf8",
    );
    expect(actionsTxt).toMatch(new RegExp(`\\bclass\\s+${pageName}\\b`));
    expect(actionsTxt).not.toMatch(/TestSuite/);
  });

  test("add_method: blank method name lets the runner derive a default name", async ({
    request,
  }) => {
    const base = BASE!;
    await seedAdminCookie({ request }, base);
    const proj = await scaffoldProject(request, base, "DerivedName");
    await ensureAiAgentReady(request, base, proj.solutionName);

    const className = "PreExistingSuite";
    const suiteRel = await writeSuiteFile(
      proj.projectRoot,
      proj.testProjectName,
      proj.namespace,
      className,
    );

    const runId = await startRun(request, base, proj.solutionName, {
      kind: "playwright",
      plan: RULE_PARSER_PLAN,
      suiteName: className,
      // methodName intentionally omitted (== blank).
      language: "csharp",
      targetMode: "add_method",
      existingSuiteFile: suiteRel,
      targetMethod: "test",
    });
    const { report } = await waitForRunSucceeded(
      request,
      base,
      proj.solutionName,
      runId,
    );
    const partial = report!.files.find((f) =>
      f.path.includes(`/Tests/${className}.AiMethod.`),
    );
    expect(partial, "AiMethod partial should be emitted").toBeDefined();
    const partialAbs = path.join(proj.projectRoot, partial!.path);
    const txt = await fs.readFile(partialAbs, "utf8");
    expect(txt).toMatch(/\bpublic\s+partial\s+class\s+PreExistingSuite\b/);
    // The runner-derived name follows the `Given<Start>_When<Action>_Then<Assert>`
    // convention from `deriveGivenWhenThen` when methodName is blank.
    // The seeded plan navigates to https://example.com and clicks Sign In,
    // so we expect `GivenExample_When<Click>_Then<Assert>`-style output.
    // `deriveGivenWhenThen` returns `Given<X>_When<Y>_Then<Z>` and the
    // C# safeIdentifier wrapper strips the underscores, so the final
    // method name reads `Given<X>When<Y>Then<Z>` (all three tokens
    // present, in order). The seeded plan navigates to example.com so
    // the "Given" token comes from that hostname.
    const m = txt.match(
      /public\s+async\s+Task\s+(Given[A-Za-z0-9]+When[A-Za-z0-9]+Then[A-Za-z0-9]+)Async\s*\(/,
    );
    expect(m, "should emit a Given<X>When<Y>Then<Z> runner-derived method").not.toBeNull();
    expect(m![1]).toMatch(/^GivenExample/);
    // Exactly one [Test] method was added by the run.
    const testAttrCount = (txt.match(/\[Test\]/g) ?? []).length;
    expect(testAttrCount).toBe(1);
  });

  test("add_method: explicit method name is pinned verbatim on the emitted method", async ({
    request,
  }) => {
    const base = BASE!;
    await seedAdminCookie({ request }, base);
    const proj = await scaffoldProject(request, base, "PinnedName");
    await ensureAiAgentReady(request, base, proj.solutionName);

    const className = "PinnedNameSuite";
    const suiteRel = await writeSuiteFile(
      proj.projectRoot,
      proj.testProjectName,
      proj.namespace,
      className,
    );

    // Underscores are stripped by `safeIdentifier` on the server, so
    // pick a name that is already a clean C# identifier — the point
    // of this test is "pinned verbatim", not "identifier sanitization".
    const explicitName = "GivenLoginPageWhenSubmitThenLands";
    const runId = await startRun(request, base, proj.solutionName, {
      kind: "playwright",
      plan: RULE_PARSER_PLAN,
      suiteName: className,
      methodName: explicitName,
      language: "csharp",
      targetMode: "add_method",
      existingSuiteFile: suiteRel,
      targetMethod: "test",
    });
    const { report } = await waitForRunSucceeded(
      request,
      base,
      proj.solutionName,
      runId,
    );
    const partial = report!.files.find((f) =>
      f.path.includes(`/Tests/${className}.AiMethod.`),
    );
    expect(partial).toBeDefined();
    const txt = await fs.readFile(
      path.join(proj.projectRoot, partial!.path),
      "utf8",
    );
    expect(txt).toMatch(
      new RegExp(`public\\s+async\\s+Task\\s+${explicitName}Async\\s*\\(`),
    );
    // Pinning means EXACTLY one [Test] method emitted under the
    // caller-supplied name — no accidental duplicate or Given_When_Then
    // fallback sibling.
    const testAttrCount = (txt.match(/\[Test\]/g) ?? []).length;
    expect(testAttrCount).toBe(1);
    const methodNames = [...txt.matchAll(/public\s+async\s+Task\s+([A-Za-z_][A-Za-z0-9_]*)Async\s*\(/g)].map((mm) => mm[1]);
    expect(methodNames).toEqual([explicitName]);
  });

  test("add_method: emits a partial-class companion and does NOT create a second standalone suite", async ({
    request,
  }) => {
    const base = BASE!;
    await seedAdminCookie({ request }, base);
    const proj = await scaffoldProject(request, base, "AddOnly");
    await ensureAiAgentReady(request, base, proj.solutionName);

    const className = "AddOnlySuite";
    const suiteRel = await writeSuiteFile(
      proj.projectRoot,
      proj.testProjectName,
      proj.namespace,
      className,
    );

    const runId = await startRun(request, base, proj.solutionName, {
      kind: "playwright",
      plan: RULE_PARSER_PLAN,
      suiteName: className,
      language: "csharp",
      targetMode: "add_method",
      existingSuiteFile: suiteRel,
      targetMethod: "test",
    });
    const { report } = await waitForRunSucceeded(
      request,
      base,
      proj.solutionName,
      runId,
    );
    const filePaths = report!.files.map((f) => f.path);
    // Must NOT emit a fresh `Tests/{className}TestSuite.cs` — that is
    // the exact regression task #98 / #100 set out to prevent.
    expect(filePaths).not.toContain(
      `${proj.testProjectName}/Tests/${className}TestSuite.cs`,
    );
    // The partial companion must be present.
    expect(
      filePaths.some((p) => p.includes(`/Tests/${className}.AiMethod.`)),
    ).toBe(true);
    // And the pre-seeded suite file must still be the only standalone
    // `.cs` test class in the Tests/ folder.
    const testsDir = path.join(
      proj.projectRoot,
      proj.testProjectName,
      "Tests",
    );
    const entries = await fs.readdir(testsDir);
    const standalone = entries.filter(
      (n) => n.endsWith(".cs") && !n.includes(".AiMethod."),
    );
    expect(standalone).toEqual([`${className}.cs`]);

    // The partial emitted by the run must contain exactly one NEW
    // `[Test]` method (the AI-authored one). The companion file is a
    // fresh partial, so it should have a single [Test] attribute and a
    // single `public async Task ...Async(` method declaration.
    const partialPath = filePaths.find((p) =>
      p.includes(`/Tests/${className}.AiMethod.`),
    )!;
    const partialTxt = await fs.readFile(
      path.join(proj.projectRoot, partialPath),
      "utf8",
    );
    expect((partialTxt.match(/\[Test\]/g) ?? []).length).toBe(1);
    expect(
      (partialTxt.match(/public\s+async\s+Task\s+[A-Za-z_][A-Za-z0-9_]*Async\s*\(/g) ?? []).length,
    ).toBe(1);
    // Partial must reuse the SAME class name (no `TestSuite` suffix
    // smuggled in) so the C# compiler merges it with the hand-written
    // half at build time.
    expect(partialTxt).toMatch(
      new RegExp(`\\bpartial\\s+class\\s+${className}\\b`),
    );
    expect(partialTxt).not.toMatch(
      new RegExp(`class\\s+${className}TestSuite\\b`),
    );
  });

  test("existing-suite dropdown filters out `TestFixture.cs` base class", async ({
    page,
  }) => {
    const base = BASE!;
    await seedAdminCookie(page, base);
    const proj = await scaffoldProject(page.request, base, "Filter");
    await ensureAiAgentReady(page.request, base, proj.solutionName);

    // Seed a real suite so the dropdown has at least one valid option.
    const realSuiteRel = await writeSuiteFile(
      proj.projectRoot,
      proj.testProjectName,
      proj.namespace,
      "RealSuite",
    );
    expect(realSuiteRel).toBeTruthy();

    // Also seed a sibling `Tests/TestFixture.cs` that carries the
    // `[TestFixture]` attribute on a SETUP-ONLY base class — without
    // this, the discovery walker silently drops it (no methods, no
    // attribute) and the dropdown excludes it for the wrong reason.
    // Seeding it explicitly forces the UI-level filter in
    // `test-with-ai-dialog.tsx` to be the only guard, so a regression
    // that removes the C# filter branch immediately trips this test.
    const baseFixtureRel = `${proj.testProjectName}/Tests/TestFixture.cs`;
    await fs.writeFile(
      path.join(proj.projectRoot, baseFixtureRel),
      `using System.Threading.Tasks;
using NUnit.Framework;
namespace ${proj.namespace}.Tests
{
    [TestFixture]
    public abstract class TestFixture
    {
        [SetUp]
        public Task SetupAsync() { return Task.CompletedTask; }
    }
}
`,
      "utf8",
    );

    await page.goto(`${base}/workbench`);
    const tourClose = page.getByTestId("button-tour-close");
    if (await tourClose.count()) await tourClose.click();

    const aiButton = page.getByTestId("button-test-with-ai");
    await expect(aiButton).toBeVisible({ timeout: 20_000 });
    await aiButton.click();
    await page.getByTestId("radio-ai-target-add-method").click();

    const suiteSelect = page.getByTestId("select-ai-existing-suite");
    await expect(suiteSelect).toBeVisible();
    await suiteSelect.click();

    const options = page.locator(
      '[data-testid^="option-ai-existing-suite-"]',
    );
    await expect(options.first()).toBeVisible({ timeout: 5_000 });
    const count = await options.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      labels.push((await options.nth(i).getAttribute("data-testid")) ?? "");
    }
    // None of the rendered options may point at the abstract
    // `TestFixture.cs` / `TestFixtureBase.cs` base classes, even
    // though the one we just seeded passes through the discovery
    // walker (it carries [TestFixture]).
    for (const label of labels) {
      expect(label).not.toMatch(/TestFixture\.cs$/);
      expect(label).not.toMatch(/TestFixtureBase\.cs$/);
    }
    // And the real seeded suite must be among the options.
    expect(
      labels.some((l) => l.endsWith(`/Tests/RealSuite.cs`)),
    ).toBe(true);
  });

  test("UI add-method to AiLoginTests: partial class lands on the real suite (not TestFixture) and setupContext carries both sources", async ({
    page,
  }) => {
    // End-to-end regression gate for task #116. Reproduces the user's
    // exact scenario: a C# project with `Tests/TestFixture.cs` (base
    // class, must NOT be selectable) and `Tests/AiLoginTests.cs`
    // (the real suite, with a [SetUp] hook AND a sidecar plan). The
    // run is dispatched via the API for determinism but the UI is
    // exercised first to prove the dropdown filter renders only the
    // real suite in the DOM.
    const base = BASE!;
    await seedAdminCookie(page, base);
    const proj = await scaffoldProject(page.request, base, "AiLoginUi");
    await ensureAiAgentReady(page.request, base, proj.solutionName);

    // Base/Fixture file — discovery surfaces it ([TestFixture]),
    // the UI filter must drop it.
    const baseFixtureRel = `${proj.testProjectName}/Tests/TestFixture.cs`;
    await fs.writeFile(
      path.join(proj.projectRoot, baseFixtureRel),
      `using System.Threading.Tasks;
using NUnit.Framework;
namespace ${proj.namespace}.Tests
{
    [TestFixture]
    public abstract class TestFixture
    {
        [SetUp]
        public Task SetupAsync() { return Task.CompletedTask; }
    }
}
`,
      "utf8",
    );

    // Real suite: AiLoginTests with a [SetUp] body and a sidecar.
    const className = "AiLoginTests";
    const suiteRel = `${proj.testProjectName}/Tests/${className}.cs`;
    const SETUP_HOOK_URL = "https://www.google.com/";
    const suiteAbs = path.join(proj.projectRoot, suiteRel);
    await fs.mkdir(path.dirname(suiteAbs), { recursive: true });
    await fs.writeFile(
      suiteAbs,
      `using System.Threading.Tasks;
using NUnit.Framework;
using Microsoft.Playwright;
using ${proj.namespace}.Infrastructure.Fixtures;

namespace ${proj.namespace}.Tests
{
    [TestFixture]
    public class ${className} : TestFixture
    {
        [SetUp]
        public async Task BeforeEachAsync()
        {
            await Page.GotoAsync("${SETUP_HOOK_URL}");
        }

        [Test]
        public async Task ExistingTestAsync()
        {
            await Task.CompletedTask;
        }
    }
}
`,
      "utf8",
    );

    const sidecarPlan =
      "1- go to www.google.com\n2- click login button";
    const sidecarAbs = path.join(
      proj.projectRoot,
      proj.testProjectName,
      "Tests",
      `${className}Setup`,
    );
    await fs.writeFile(sidecarAbs, sidecarPlan, "utf8");

    // UI assertion: dropdown lists AiLoginTests but excludes TestFixture.
    await page.goto(`${base}/workbench`);
    const tourClose = page.getByTestId("button-tour-close");
    if (await tourClose.count()) await tourClose.click();
    const aiButton = page.getByTestId("button-test-with-ai");
    await expect(aiButton).toBeVisible({ timeout: 20_000 });
    await aiButton.click();
    await page.getByTestId("radio-ai-target-add-method").click();
    const suiteSelect = page.getByTestId("select-ai-existing-suite");
    await expect(suiteSelect).toBeVisible();
    await suiteSelect.click();
    const options = page.locator(
      '[data-testid^="option-ai-existing-suite-"]',
    );
    await expect(options.first()).toBeVisible({ timeout: 5_000 });
    const labels: string[] = [];
    const count = await options.count();
    for (let i = 0; i < count; i++) {
      labels.push((await options.nth(i).getAttribute("data-testid")) ?? "");
    }
    for (const label of labels) {
      expect(label).not.toMatch(/TestFixture\.cs$/);
      expect(label).not.toMatch(/TestFixtureBase\.cs$/);
    }
    expect(
      labels.some((l) => l.endsWith(`/Tests/${className}.cs`)),
      `dropdown must list the real ${className} suite (labels=${labels.join(", ")})`,
    ).toBe(true);

    // Now dispatch the run via the API (deterministic) and verify
    // the partial-class companion + setupContext.
    const newPlan =
      "1- fill username 'aelhaj' in username textfield\n2- assert url contains 'google'";
    const runId = await startRun(page.request, base, proj.solutionName, {
      kind: "playwright",
      plan: newPlan,
      suiteName: className,
      language: "csharp",
      targetMode: "add_method",
      existingSuiteFile: suiteRel,
      targetMethod: "test",
    });
    const runRecord = await waitForRunSucceeded(
      page.request,
      base,
      proj.solutionName,
      runId,
    );

    // 1. Emitted file is a partial-class companion of AiLoginTests
    //    in the same folder — NOT a new standalone TestSuite class,
    //    NOT a TestFixture partial.
    const filePaths = runRecord.report!.files.map((f) => f.path);
    expect(filePaths).not.toContain(
      `${proj.testProjectName}/Tests/${className}TestSuite.cs`,
    );
    expect(filePaths).not.toContain(
      `${proj.testProjectName}/Tests/TestFixture.cs`,
    );
    expect(
      filePaths.some(
        (p) =>
          p.startsWith(`${proj.testProjectName}/Tests/`) &&
          p.includes(`/${className}.AiMethod.`),
      ),
      `expected an AiLoginTests partial companion (files=${filePaths.join(", ")})`,
    ).toBe(true);
    const partialPath = filePaths.find((p) =>
      p.includes(`/${className}.AiMethod.`),
    )!;
    const partialTxt = await fs.readFile(
      path.join(proj.projectRoot, partialPath),
      "utf8",
    );
    expect(partialTxt).toMatch(
      new RegExp(`public\\s+partial\\s+class\\s+${className}\\b`),
    );

    // 2. setupContext includes both the parsed [SetUp] body AND the
    //    sidecar text — proves the LLM saw prior state.
    const ctx = runRecord.report!.setupContextText;
    expect(ctx, "report.setupContextText must be populated").not.toBeNull();
    expect(ctx!).toContain("User setup plan:");
    expect(ctx!).toContain("click login button");
    expect(ctx!).toContain(SETUP_HOOK_URL);

    // 3. The new method body must NOT re-emit the setup goto.
    expect(partialTxt).not.toContain(SETUP_HOOK_URL);
  });

  test("setup sidecar: a `beforeEach` run writes `{ClassName}Setup` (extensionless) and the file tree hides it", async ({
    request,
  }) => {
    const base = BASE!;
    await seedAdminCookie({ request }, base);
    const proj = await scaffoldProject(request, base, "Sidecar");
    await ensureAiAgentReady(request, base, proj.solutionName);

    const className = "SidecarSuite";
    const suiteRel = await writeSuiteFile(
      proj.projectRoot,
      proj.testProjectName,
      proj.namespace,
      className,
    );

    const runId = await startRun(request, base, proj.solutionName, {
      kind: "playwright",
      plan: "Navigate to https://example.com/login",
      suiteName: className,
      language: "csharp",
      targetMode: "add_method",
      existingSuiteFile: suiteRel,
      targetMethod: "beforeEach",
    });
    await waitForRunSucceeded(request, base, proj.solutionName, runId);

    const sidecarAbs = path.join(
      proj.projectRoot,
      proj.testProjectName,
      "Tests",
      `${className}Setup`,
    );
    expect(await fileExists(sidecarAbs)).toBe(true);
    const sidecarBody = (await fs.readFile(sidecarAbs, "utf8")).trim();
    expect(sidecarBody).toContain("https://example.com/login");

    // The project tree walker dispatches by extension, so the
    // extensionless sidecar must never appear in the rendered tree.
    const treeRes = await request.get(`${base}/api/projects/tree`);
    expect(treeRes.ok()).toBe(true);
    const tree = await treeRes.json();
    const serialized = JSON.stringify(tree);
    expect(serialized).not.toContain(`${className}Setup"`);
  });

  test("setup sidecar: a follow-up add_method run reads the sidecar and the new method only contains the new step", async ({
    request,
  }) => {
    const base = BASE!;
    await seedAdminCookie({ request }, base);
    const proj = await scaffoldProject(request, base, "Context");
    await ensureAiAgentReady(request, base, proj.solutionName);

    const className = "ContextSuite";
    // Pre-seed BOTH possible setup-context sources the runner reads:
    //   1. The existing suite's `[SetUp]` hook body (read by
    //      `readSetupChain`).
    //   2. The hidden `{ClassName}Setup` extensionless sidecar (read
    //      by `readAiSetupSidecar`).
    // Each carries a DIFFERENT distinctive URL so we can prove the
    // runner treats both as PRIOR context and never re-emits either
    // URL as a step in the newly authored method.
    const suiteRel = `${proj.testProjectName}/Tests/${className}.cs`;
    const suiteAbs = path.join(proj.projectRoot, suiteRel);
    await fs.mkdir(path.dirname(suiteAbs), { recursive: true });
    const SETUP_HOOK_URL = "https://setup-hook.example.com/before-each";
    await fs.writeFile(
      suiteAbs,
      `using System.Threading.Tasks;
using NUnit.Framework;
using Microsoft.Playwright;
using ${proj.namespace}.Infrastructure.Fixtures;

namespace ${proj.namespace}.Tests
{
    [TestFixture]
    public class ${className} : TestFixture
    {
        [SetUp]
        public async Task BeforeEachAsync()
        {
            await Page.GotoAsync("${SETUP_HOOK_URL}");
        }

        [Test]
        public async Task ExistingTestAsync()
        {
            await Task.CompletedTask;
        }
    }
}
`,
      "utf8",
    );

    const SIDECAR_URL = "https://sidecar.example.com/login";
    const setupPlan = `Navigate to ${SIDECAR_URL}`;
    const sidecarAbs = path.join(
      proj.projectRoot,
      proj.testProjectName,
      "Tests",
      `${className}Setup`,
    );
    await fs.writeFile(sidecarAbs, setupPlan, "utf8");

    const explicitMethodName = "GivenLoginWhenSubmitThenOk";
    const followUpPlan = "Click the Submit button";
    const runId = await startRun(request, base, proj.solutionName, {
      kind: "playwright",
      plan: followUpPlan,
      suiteName: className,
      methodName: explicitMethodName,
      language: "csharp",
      targetMode: "add_method",
      existingSuiteFile: suiteRel,
      targetMethod: "test",
    });
    const runRecord = await waitForRunSucceeded(
      request,
      base,
      proj.solutionName,
      runId,
    );

    // The run record's `plan` field surfaces the user-supplied plan
    // verbatim — never accidentally polluted with the setup hook /
    // sidecar text. That's the contract the run-status page renders.
    expect(runRecord.plan).toBe(followUpPlan);
    expect(runRecord.plan).not.toContain(SETUP_HOOK_URL);
    expect(runRecord.plan).not.toContain(SIDECAR_URL);

    // The combined setup-context the runner prepended to the LLM
    // prompt is exposed on the report. Both sources must be present
    // AND ordered: the sidecar (under the `User setup plan:` header)
    // first, then the existing-suite hook code extracted by
    // `readSetupChain`. This is the end-to-end proof that the
    // sidecar is "prepended as AI context", not merely written to
    // disk and ignored.
    const ctx = runRecord.report!.setupContextText;
    expect(ctx, "report.setupContextText must be populated").not.toBeNull();
    expect(ctx!).toContain("User setup plan:");
    expect(ctx!).toContain(SIDECAR_URL);
    expect(ctx!).toContain(SETUP_HOOK_URL);
    const sidecarIdx = ctx!.indexOf(SIDECAR_URL);
    const hookIdx = ctx!.indexOf(SETUP_HOOK_URL);
    expect(
      sidecarIdx < hookIdx,
      "sidecar must be prepended BEFORE the existing-suite hook context",
    ).toBe(true);
    // And the sidecar header must appear before the sidecar URL —
    // i.e. the "User setup plan:" label introduces the sidecar
    // block, not a stray substring elsewhere.
    expect(ctx!.indexOf("User setup plan:")).toBeLessThan(sidecarIdx);

    const partial = runRecord.report!.files.find((f) =>
      f.path.includes(`/Tests/${className}.AiMethod.`),
    );
    expect(partial).toBeDefined();
    const txt = await fs.readFile(
      path.join(proj.projectRoot, partial!.path),
      "utf8",
    );
    // The new method body must reflect the new plan (a click on
    // "Submit") and must NOT re-emit EITHER the setup hook goto OR
    // the sidecar goto — the runner is supposed to surface both as
    // prior context to the LLM, not duplicate them as steps.
    expect(txt).toMatch(
      new RegExp(`public\\s+async\\s+Task\\s+${explicitMethodName}Async\\s*\\(`),
    );
    expect(txt).toMatch(/Submit/i);
    expect(txt).not.toContain(SIDECAR_URL);
    expect(txt).not.toContain(SETUP_HOOK_URL);
    // Exactly one new [Test] method on the partial — no duplicate
    // setup-goto siblings, no overwrite of the hand-written one.
    expect((txt.match(/\[Test\]/g) ?? []).length).toBe(1);

    // And the hand-written suite file is untouched — its `[SetUp]`
    // hook still owns the setup-hook goto. This proves the runner
    // didn't migrate the hook out from under the user when reading
    // it for context.
    const handWritten = await fs.readFile(suiteAbs, "utf8");
    expect(handWritten).toContain(SETUP_HOOK_URL);
    expect(handWritten).toMatch(/\[SetUp\]/);

    // Sidecar must remain on disk after the run (it's the persistent
    // record of prior beforeEach intent for the next add_method run).
    expect(await fileExists(sidecarAbs)).toBe(true);
    expect((await fs.readFile(sidecarAbs, "utf8")).trim()).toBe(setupPlan);
  });
});
