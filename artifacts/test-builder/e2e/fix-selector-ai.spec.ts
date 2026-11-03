import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * End-to-end coverage for the AI Fix Selector recovery flow (task #15).
 *
 * Drives the real <FixSelectorDialog /> (the same component the
 * workbench validation row mounts) on a tiny standalone fixture page,
 * with the four heal endpoints mocked via `page.route()`:
 *
 *   • `/api/selectors/heal/ai-available` — first call says
 *     "available", which un-disables the AI tab's call-to-action.
 *   • `/api/selectors/heal/ai-suggest`   — returns a confident
 *     suggestion the user accepts as-is.
 *   • `/api/selectors/heal` (dryRun)     — preview reports two
 *     recordings + one Selectors file touched.
 *   • `/api/selectors/heal` (apply)      — succeeds; the fixture
 *     increments `applied=` so the spec can assert the dialog
 *     transitioned through to a real apply.
 *
 * The "re-run pass" half is observed by re-opening the dialog after
 * apply and confirming the AI tab still works (no leaked state from
 * the previous run).
 */

const FIXTURE_URL = "/e2e-fix-selector-fixture.html";

interface SuggestBody {
  oldSelector: string;
  actionDescription: string | null;
  errorMessage: string | null;
  pageUrl: string | null;
  domSnippet: string | null;
  priorSteps: string[];
}

interface HealBody {
  oldSelector: string;
  newSelector: string;
  dryRun?: boolean;
  via?: "ai" | "repick" | "advanced";
  aiProvider?: string;
  aiModel?: string | null;
  aiConfidence?: "high" | "medium" | "low";
  aiTokensIn?: number | null;
  aiTokensOut?: number | null;
}

interface Captures {
  suggest: SuggestBody[];
  heal: HealBody[];
}

async function installMocks(
  page: Page,
  captures: Captures,
  opts: {
    aiAvailable?: boolean;
    suggestResponse?: Record<string, unknown>;
    suggestStatus?: number;
    suggestErrorBody?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const aiAvailable = opts.aiAvailable ?? true;
  const suggestResponse =
    opts.suggestResponse ?? {
      suggestedSelector: "[data-testid=login-submit]",
      confidence: "high",
      explanation:
        "The page now exposes a more specific login-submit testid; use it instead.",
      model: "claude-3-5-sonnet-20241022",
      provider: "anthropic",
      tokensIn: 187,
      tokensOut: 64,
    };

  await page.route("**/api/selectors/heal/ai-available", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        aiAvailable
          ? { available: true, provider: "anthropic" }
          : {
              available: false,
              reason: "NO_API_KEY",
              message: "No AI provider API key is configured.",
              setupHref: "/tools/ai-agent",
            },
      ),
    });
  });

  await page.route("**/api/selectors/heal/ai-suggest", async (route: Route) => {
    captures.suggest.push(
      JSON.parse(route.request().postData() ?? "{}") as SuggestBody,
    );
    if (opts.suggestStatus && opts.suggestStatus !== 200) {
      await route.fulfill({
        status: opts.suggestStatus,
        contentType: "application/json",
        body: JSON.stringify(
          opts.suggestErrorBody ?? { error: "boom", kind: "infrastructure" },
        ),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(suggestResponse),
    });
  });

  await page.route("**/api/selectors/heal", async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as HealBody;
    captures.heal.push(body);
    const newSelector = body.newSelector;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        oldSelector: body.oldSelector,
        newSelector,
        totalReplacements: 3,
        recordingsChanged: 2,
        details: [
          {
            filePath: "Tests/Login.cs",
            kind: "test",
            methodName: "Login",
            replacements: 2,
            sites: [
              {
                location: "step 1",
                before: `click selector="${body.oldSelector}"`,
                after: `click selector="${newSelector}"`,
              },
              {
                location: "step 3 (wait)",
                before: `wait waitSelector="${body.oldSelector}"`,
                after: `wait waitSelector="${newSelector}"`,
              },
            ],
          },
          {
            filePath: "Tests/Logout.cs",
            kind: "test",
            methodName: "Logout",
            replacements: 1,
            sites: [
              {
                location: "step 2",
                before: `click selector="${body.oldSelector}"`,
                after: `click selector="${newSelector}"`,
              },
            ],
          },
        ],
        filesChanged: 1,
        fileDetails: [
          {
            filePath: "PageObjects/Selectors/LoginSelectors.cs",
            keys: ["Submit"],
            replacements: 1,
            sites: [
              {
                location: "line 3",
                before: `    public static readonly string Submit = "${body.oldSelector}";`,
                after: `    public static readonly string Submit = "${newSelector}";`,
              },
            ],
          },
        ],
      }),
    });
  });
}

test.describe("Fix Selector — AI happy path", () => {
  test("failing selector → AI suggest → accept → apply succeeds; reopen still works", async ({
    page,
  }) => {
    const captures: Captures = { suggest: [], heal: [] };
    await installMocks(page, captures);
    await page.goto(FIXTURE_URL);

    await expect(page.getByTestId("fixture-applied-count")).toHaveText(
      "applied=0",
    );

    // Open the dialog (AI tab is the default).
    await page.getByTestId("fixture-open-dialog").click();
    await expect(page.getByTestId("dialog-fix-selector")).toBeVisible();
    await expect(page.getByTestId("tab-ai")).toBeVisible();

    // Availability probe resolves → button enables.
    const aiBtn = page.getByTestId("button-ai-suggest");
    await expect(aiBtn).toBeEnabled();
    await aiBtn.click();

    // Loading → suggested result card.
    await expect(page.getByTestId("fix-selector-ai-result")).toBeVisible();
    await expect(page.getByTestId("ai-confidence")).toHaveText(/high/i);
    await expect(page.getByTestId("ai-explanation")).toContainText(
      "login-submit testid",
    );
    await expect(page.getByTestId("input-ai-edited")).toHaveValue(
      "[data-testid=login-submit]",
    );

    // Suggest request carried the failing-step context.
    expect(captures.suggest).toHaveLength(1);
    expect(captures.suggest[0]).toMatchObject({
      oldSelector: "[data-testid=submit]",
      actionDescription: "click the submit button",
      pageUrl: "https://example.com/login",
    });

    // Preview → ack → apply.
    await page.getByTestId("button-ai-preview").click();
    await expect(page.getByTestId("heal-preview-recordings")).toBeVisible();
    await expect(page.getByTestId("heal-preview-files")).toBeVisible();

    // The dialog body has to be scrollable for the acknowledgement
    // checkbox to unlock; the fixture page is short enough that the
    // ack is always visible, so we can tick it directly.
    await page.getByTestId("checkbox-ack-heal").click();
    const apply = page.getByTestId("button-ai-apply");
    await expect(apply).toBeEnabled();
    await apply.click();

    // The dialog closes (onApplied → onOpenChange(false)) and the
    // fixture counter incremented — proof the real apply path ran.
    await expect(page.getByTestId("dialog-fix-selector")).toHaveCount(0);
    await expect(page.getByTestId("fixture-applied-count")).toHaveText(
      "applied=1",
    );

    // Two heal POSTs: one dry-run preview, one real apply with full
    // AI metadata forwarded for the audit row.
    expect(captures.heal).toHaveLength(2);
    expect(captures.heal[0]).toMatchObject({
      oldSelector: "[data-testid=submit]",
      newSelector: "[data-testid=login-submit]",
      dryRun: true,
    });
    expect(captures.heal[1]).toMatchObject({
      oldSelector: "[data-testid=submit]",
      newSelector: "[data-testid=login-submit]",
      via: "ai",
      aiProvider: "anthropic",
      aiConfidence: "high",
      aiTokensIn: 187,
      aiTokensOut: 64,
    });
    expect(captures.heal[1]!.dryRun).toBeUndefined();

    // "Re-run" the loop: reopen the dialog and confirm the AI tab is
    // back at idle (no leaked state from the previous accept), the
    // availability probe re-fires, and the CTA re-enables — the
    // dialog is reusable for the next failing step.
    captures.suggest.length = 0;
    captures.heal.length = 0;
    await page.getByTestId("fixture-open-dialog").click();
    await expect(page.getByTestId("dialog-fix-selector")).toBeVisible();
    await expect(page.getByTestId("button-ai-suggest")).toBeEnabled();
  });

  test("availability probe says no key → tab disabled + tab still navigable to manual paths", async ({
    page,
  }) => {
    const captures: Captures = { suggest: [], heal: [] };
    await installMocks(page, captures, { aiAvailable: false });
    await page.goto(FIXTURE_URL);

    await page.getByTestId("fixture-open-dialog").click();

    // The empty-state card is reachable from the idle AI tab.
    await expect(page.getByTestId("fix-selector-ai-no-key")).toBeVisible();
    await expect(page.getByTestId("button-ai-setup-link")).toHaveAttribute(
      "href",
      "/tools/ai-agent",
    );

    // The manual Edit-text tab still works.
    await page.getByTestId("tab-advanced").click();
    await expect(page.getByTestId("input-new-selector")).toBeVisible();

    // The suggest endpoint was never called.
    expect(captures.suggest).toHaveLength(0);
  });
});
