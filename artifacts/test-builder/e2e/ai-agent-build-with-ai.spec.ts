import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end coverage for the "Build with AI" flow. Drives the real
 * test-builder UI behind the shared proxy (api-server + test-builder
 * workflows) and asserts the run-status page renders cleanly without
 * an unhandled error — the regression we just hit was the page
 * crashing on `report.files` being undefined, which a typecheck does
 * not catch.
 *
 * The plan text uses only patterns the rule-based parser handles
 * (Navigate / Click / Fill), so the runner never reaches the
 * provider.chat() LLM enrichment path. The org-level Anthropic key is
 * still required by the pre-flight gate but is never exercised.
 *
 * Gated behind `E2E_API_BASE_URL` (e.g. `http://localhost:80`).
 */
const BASE = process.env.E2E_API_BASE_URL;

const SEEDED_PROJECT = "AiAgentTesting";
const SEEDED_SLN_PATH = `/home/runner/workspace/workspace/${SEEDED_PROJECT}/${SEEDED_PROJECT}.sln`;

const RULE_PARSER_PLAN = [
  "Navigate to https://example.com",
  "Click the Sign In button",
  "Fill the username field with alice",
  // Intentionally unparseable line so the runner records a `skipped`
  // step. The fake provider key makes the LLM enrichment fall through
  // to the catch branch, leaving this line as `matchType: "none"` →
  // `result: "skipped"`. Used by the run-status assertion to prove
  // skipped steps render as a neutral indicator (not a red X) — the
  // regression we're fixing.
  "Reflect quietly on the meaning of dashboards",
].join("\n");

async function seedAdminCookie(page: Page, base: string): Promise<void> {
  const res = await page.goto(
    `${base}/api/auth/dev-login?email=admin@example.com&role=admin`,
  );
  if (!res || !res.ok()) {
    throw new Error(
      `dev-login failed: ${res?.status()} (is APP_ENVIRONMENT=development on the api-server?)`,
    );
  }
  const profile = await page.request.put(`${base}/api/auth/profile`, {
    data: {
      firstName: "E2E",
      lastName: "Admin",
      title: "QA",
      email: "admin@example.com",
    },
  });
  if (!profile.ok()) {
    throw new Error(
      `profile update failed: ${profile.status()} ${await profile.text()}`,
    );
  }
  // Mark the onboarding tour as seen so its full-screen overlay (which
  // intercepts pointer events) does not block the workbench / projects
  // toolbar from being clicked.
  await page.request.post(`${base}/api/users/me/tour-seen`, {
    data: { hasSeenTour: true },
  });
}

async function ensureAiAgentReady(
  page: Page,
  base: string,
  projectName: string,
): Promise<void> {
  // Org-enable flag still lives on the legacy `ai_agent_org_configs`
  // row (read by the orgEnabled gate). The actual key, however, is
  // resolved from the new `ai_agent_keys` library by the runner, so
  // we have to seed a default key there too.
  const cfg = await page.request.put(`${base}/api/ai-agent/org-config`, {
    data: { enabled: true, provider: "anthropic" },
  });
  if (!cfg.ok()) {
    throw new Error(
      `ai-agent/org-config failed: ${cfg.status()} ${await cfg.text()}`,
    );
  }
  const listRes = await page.request.get(`${base}/api/ai-agent/keys`);
  if (!listRes.ok()) {
    throw new Error(
      `ai-agent/keys list failed: ${listRes.status()} ${await listRes.text()}`,
    );
  }
  const list = (await listRes.json()) as {
    keys: Array<{ id: string; isDefault: boolean }>;
  };
  if (!list.keys.some((k) => k.isDefault)) {
    const create = await page.request.post(`${base}/api/ai-agent/keys`, {
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
  const projCfg = await page.request.put(
    `${base}/api/ai-agent/projects/${encodeURIComponent(projectName)}/config`,
    { data: { enabled: true } },
  );
  if (!projCfg.ok()) {
    throw new Error(
      `ai-agent/projects/.../config failed: ${projCfg.status()} ${await projCfg.text()}`,
    );
  }
}

async function dismissOnboardingTour(page: Page): Promise<void> {
  const tourClose = page.getByTestId("button-tour-close");
  if (await tourClose.count()) {
    await tourClose.click();
    await expect(page.getByTestId("onboarding-tour-overlay")).toHaveCount(0);
  }
}

async function loadSeededProject(page: Page, base: string): Promise<void> {
  // The seeded `AiAgentTesting` C# Playwright project is committed to
  // the repo (task #43) so this is a straight load — no on-demand
  // scaffold step.
  const res = await page.request.post(`${base}/api/projects/load`, {
    data: { slnPath: SEEDED_SLN_PATH },
  });
  if (!res.ok()) {
    throw new Error(
      `projects/load failed: ${res.status()} ${await res.text()}`,
    );
  }
}

async function assertRunStatusRendersCleanly(page: Page): Promise<void> {
  // The run-status page polls until `succeeded`. Asserting on the
  // status text covers the "no unhandled error" guarantee — the page
  // would have crashed (white screen) on `report.files` being
  // undefined and the testid would never appear.
  await expect(page.getByTestId("text-ai-run-status")).toHaveText(
    "succeeded",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("text-ai-run-plan")).toBeVisible();
  await expect(page.getByTestId("list-ai-run-steps")).toBeVisible();
  await expect(page.getByTestId("list-ai-run-files")).toBeVisible();
  // At least one materialized file rendered — the parser-driven plan
  // guarantees the runner builds one suite file.
  const filesCard = page.getByTestId("list-ai-run-files").locator("..");
  await expect(
    page.getByTestId("list-ai-run-files").locator("li"),
  ).not.toHaveCount(0);
  // The "Materialized files (N)" label and non-empty summary line live
  // on the same card as the file list — assert both so we catch a
  // regression on either piece of the run-status contract.
  await expect(filesCard).toContainText(/Materialized files \(\d+\)/);
  await expect(filesCard).toContainText(/Generated \d+ file/);
  // At least one step rendered.
  await expect(
    page.getByTestId("list-ai-run-steps").locator("li"),
  ).not.toHaveCount(0);
  // The unparseable plan line ("Reflect quietly...") must render as a
  // neutral skipped indicator, not a red X — this is the regression
  // being fixed. Asserts the per-status testid is present AND the
  // destructive failed icon is absent within that row, so a future
  // regression that swaps the indicator back to XCircle on a skipped
  // step is caught.
  const skippedItems = page.locator('[data-step-status="skipped"]');
  await expect(skippedItems.first()).toBeVisible();
  await expect(skippedItems).not.toHaveCount(0);
  // The destructive (failed) icon uses `text-destructive`; assert no
  // skipped row contains it.
  await expect(
    skippedItems.first().locator(".text-destructive"),
  ).toHaveCount(0);
}

test.describe("AI agent — Build with AI flow", () => {
  test.skip(!BASE, "Set E2E_API_BASE_URL to run against the live api-server");
  test.setTimeout(90_000);

  test("workbench toolbar — Build with AI lands on a clean run-status page", async ({
    page,
  }) => {
    const base = BASE!;
    await seedAdminCookie(page, base);
    await ensureAiAgentReady(page, base, SEEDED_PROJECT);
    await loadSeededProject(page, base);

    await page.goto(`${base}/workbench`);
    await dismissOnboardingTour(page);

    const aiButton = page.getByTestId("button-test-with-ai");
    await expect(aiButton).toBeVisible({ timeout: 20_000 });
    await expect(aiButton).toBeEnabled({ timeout: 20_000 });
    await aiButton.click();

    const suiteName = `E2EWorkbench${Date.now().toString(36)}`;
    await page.getByTestId("input-ai-suite-name").fill(suiteName);
    await page.getByTestId("textarea-ai-plan").fill(RULE_PARSER_PLAN);
    await page.getByTestId("button-ai-start-run").click();

    await page.waitForURL(/\/workbench\/ai-runs\//, { timeout: 20_000 });
    await assertRunStatusRendersCleanly(page);
  });

  test("workbench toolbar — Add method to existing suite dropdown is filtered by language + test kind (task #86)", async ({
    page,
  }) => {
    const base = BASE!;
    await seedAdminCookie(page, base);
    await ensureAiAgentReady(page, base, SEEDED_PROJECT);
    await loadSeededProject(page, base);

    await page.goto(`${base}/workbench`);
    await dismissOnboardingTour(page);

    const aiButton = page.getByTestId("button-test-with-ai");
    await expect(aiButton).toBeVisible({ timeout: 20_000 });
    await aiButton.click();

    // Flip the dialog into "Add method to existing suite" mode so the
    // dropdown becomes visible.
    await page.getByTestId("radio-ai-target-add-method").click();

    const suiteSelect = page.getByTestId("select-ai-existing-suite");
    await expect(suiteSelect).toBeVisible();

    // Walk every test kind (Playwright UI / API / Unit). For each one
    // the dropdown placeholder must either name a discovered suite
    // ("Pick a suite…") OR show the kind-specific empty-state copy
    // ("No suites match this kind yet — pick New test suite instead.")
    // — never the legacy "No suite files discovered" copy, since the
    // seeded project has at least one suite file on disk.
    // The kind <SelectItem>s don't carry per-option testids — match
    // them by visible label instead (using exact match so "API" does
    // not collide with "Playwright (UI)" or other substrings).
    const kindLabels = ["Playwright (UI)", "API", "Unit"] as const;
    let sawKindSpecificEmpty = false;
    for (const label of kindLabels) {
      await page.getByTestId("select-ai-kind").click();
      await page.getByRole("option", { name: label, exact: true }).click();
      const placeholder =
        (await suiteSelect.textContent())?.trim() ?? "";
      expect(placeholder).not.toBe("No suite files discovered");
      if (
        placeholder ===
        "No suites match this kind yet — pick New test suite instead."
      ) {
        sawKindSpecificEmpty = true;
      }
    }
    // The seeded AiAgentTesting project ships with suites for one
    // kind only, so at least one of the three kinds above must hit
    // the kind-specific empty-state copy — that proves the filter is
    // actually narrowing by kind rather than showing every suite.
    expect(sawKindSpecificEmpty).toBe(true);
  });

  test("workbench toolbar — Add method to existing suite dropdown renders discovered suite files (task #92)", async ({
    page,
  }) => {
    const base = BASE!;
    await seedAdminCookie(page, base);
    await ensureAiAgentReady(page, base, SEEDED_PROJECT);
    await loadSeededProject(page, base);

    // Sanity check that the discovery API itself returns at least one
    // suite file for the seeded Playwright (UI) project. The task #92
    // regression was that scaffolded C# UI projects classified every
    // method as `unit` (because the test files live under
    // `{Sln}.Tests/Tests/`, not `e2e/`), and the dialog's default
    // `kind=playwright` filter then hid every row from the dropdown —
    // collapsing the menu to a single "No suite files discovered" line.
    // We assert the *API* sees at least one `e2e`-classified method
    // before we ever open the dropdown, so a future regression in the
    // server-side `classifyMethod` default-kind threading is caught
    // here even if the UI changes shape.
    const discoveryRes = await page.request.get(
      `${base}/api/projects/${encodeURIComponent(SEEDED_SLN_PATH)}/tests`,
    );
    expect(discoveryRes.ok()).toBe(true);
    const discovery = (await discoveryRes.json()) as {
      root: {
        totals: { e2e: number; unit: number; api: number; all: number };
      };
    };
    expect(discovery.root.totals.e2e).toBeGreaterThan(0);

    await page.goto(`${base}/workbench`);
    await dismissOnboardingTour(page);

    const aiButton = page.getByTestId("button-test-with-ai");
    await expect(aiButton).toBeVisible({ timeout: 20_000 });
    await aiButton.click();

    // Switch into "Add method to existing suite" mode.
    await page.getByTestId("radio-ai-target-add-method").click();

    const suiteSelect = page.getByTestId("select-ai-existing-suite");
    await expect(suiteSelect).toBeVisible();
    // The placeholder must NOT be the empty-state copy — there is at
    // least one Playwright (UI) suite on disk.
    const placeholder = (await suiteSelect.textContent())?.trim() ?? "";
    expect(placeholder).not.toBe("No suite files discovered");
    expect(placeholder).not.toBe(
      "No suites match this kind yet — pick New test suite instead.",
    );

    // Actually open the dropdown and assert at least one option row is
    // rendered. This is the regression: previously the dropdown opened
    // but had zero `option-ai-existing-suite-*` children because the
    // dialog was calling the discovery API with the bare solution name
    // (`GoogleLogin`) instead of the URL-encoded `slnPath`, so the
    // route 404'd and the suite list was empty.
    await suiteSelect.click();
    const options = page.locator('[data-testid^="option-ai-existing-suite-"]');
    await expect(options.first()).toBeVisible({ timeout: 5_000 });
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test("projects page — Build with AI on existing project lands on a clean run-status page", async ({
    page,
  }) => {
    const base = BASE!;
    await seedAdminCookie(page, base);
    await ensureAiAgentReady(page, base, SEEDED_PROJECT);
    // The header "Build with AI" button only renders when there is at
    // least one *available* project on disk. The seeded `AiAgentTesting`
    // solution ships in the repo (task #43) so its presence on disk is
    // guaranteed — no on-demand scaffold required.

    // `/` resolves to the post-login `Dashboard`, not the projects
    // home — the "Build with AI" header button lives on `/projects`
    // (`AdminProjectsHome`), so go there directly.
    await page.goto(`${base}/projects`);
    await dismissOnboardingTour(page);

    // The header "Build with AI" button only renders when there is at
    // least one available project; the seeded `AiAgentTesting`
    // satisfies that.
    const buildBtn = page.getByTestId("button-build-with-ai");
    await expect(buildBtn).toBeVisible({ timeout: 20_000 });
    await buildBtn.click();

    // Default mode is "existing" when projects are available — pick
    // the seeded one explicitly via the dropdown.
    await page.getByTestId("select-bw-existing-project").click();
    await page
      .getByTestId(`option-bw-project-${SEEDED_PROJECT}`)
      .click();

    const suiteName = `E2EProjects${Date.now().toString(36)}`;
    await page.getByTestId("input-bw-suite-name").fill(suiteName);
    await page.getByTestId("textarea-bw-plan").fill(RULE_PARSER_PLAN);
    await page.getByTestId("button-bw-start").click();

    await page.waitForURL(/\/workbench\/ai-runs\//, { timeout: 20_000 });
    await assertRunStatusRendersCleanly(page);
  });
});
