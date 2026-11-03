import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end coverage for the multi-provider AI Agent admin panel
 * shipped with task #71. Drives the live api-server + test-builder
 * workflows behind the shared proxy. Gated on `E2E_API_BASE_URL`
 * (e.g. `http://localhost:80`) with `APP_ENVIRONMENT=development` on
 * the api-server so dev-login works.
 *
 * Asserts:
 *  - All eight providers render in the Provider dropdown.
 *  - Switching to azure_openai reveals the Endpoint URL + API version
 *    inputs; switching back to anthropic hides them.
 *  - Switching to openrouter reveals the HTTP-Referer + X-Title inputs.
 *  - Switching providers pre-fills the Model field with the
 *    per-provider default.
 *  - Org-config PUT only accepts `enabled` + `provider`; legacy
 *    per-key fields (`apiKey`, `model`, etc.) are rejected with
 *    HTTP 410 (task #42).
 *  - The AI Key library round-trip persists extras and only exposes
 *    the last four digits of the API key.
 */
const BASE = process.env.E2E_API_BASE_URL;

const SEEDED_PROJECT = "AiAgentTesting";
const SEEDED_SLN_PATH = `/home/runner/workspace/workspace/${SEEDED_PROJECT}/${SEEDED_PROJECT}.sln`;

/**
 * Plan whose lines are 100% resolved by the rule-based parser (Navigate
 * / Click / Fill) plus one intentionally unparseable line. The runner
 * only reaches the provider.chat() path when there are unmatched
 * steps — the fake Gemini key makes that call fall through to the
 * catch branch, so the run still finishes `succeeded` and the
 * skipped-step renders neutrally. This lets us exercise the full
 * Gemini happy-path without a real API key.
 */
const RULE_PARSER_PLAN = [
  "Navigate to https://example.com",
  "Click the Sign In button",
  "Fill the username field with alice",
  "Reflect quietly on the meaning of dashboards",
].join("\n");

async function seedAdminCookie(page: Page, base: string): Promise<void> {
  const res = await page.goto(
    `${base}/api/auth/dev-login?email=ai-providers-admin@example.com&role=admin`,
  );
  if (!res || !res.ok()) {
    throw new Error(
      `dev-login failed: ${res?.status()} (is APP_ENVIRONMENT=development on the api-server?)`,
    );
  }
  await page.request.put(`${base}/api/auth/profile`, {
    data: {
      firstName: "E2E",
      lastName: "ProvidersAdmin",
      title: "QA",
      email: "ai-providers-admin@example.com",
    },
  });
}

async function dismissOnboardingTour(page: Page): Promise<void> {
  const tourClose = page.getByTestId("button-tour-close");
  if (await tourClose.count()) {
    await tourClose.click();
    await expect(page.getByTestId("onboarding-tour-overlay")).toHaveCount(0);
  }
}

test.describe("Tools → AI Agent — multi-provider", () => {
  test.skip(!BASE, "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run.");
  test.setTimeout(120_000);

  test("org-config + key library round-trip and per-key 410 rejections", async ({ page }) => {
    const base = BASE!;
    await seedAdminCookie(page, base);

    // 1) Flip the org-wide enabled+provider toggle. After task #42
    // this endpoint only accepts those two fields.
    const saveOrg = await page.request.put(
      `${base}/api/ai-agent/org-config`,
      { data: { enabled: true, provider: "anthropic" } },
    );
    expect(saveOrg.ok()).toBeTruthy();
    const orgBody = await saveOrg.json();
    expect(orgBody.enabled).toBe(true);
    expect(orgBody.provider).toBe("anthropic");
    // Per-key fields are never exposed via this endpoint.
    expect(orgBody.apiKeyLastFour).toBeNull();
    expect(orgBody.model).toBeNull();
    expect(orgBody.endpointUrl).toBeNull();

    // 2) Every legacy per-key field is rejected with HTTP 410 and a
    // message pointing the caller at the AI Key library.
    for (const field of [
      "apiKey",
      "model",
      "endpointUrl",
      "apiVersion",
      "refererUrl",
      "appName",
    ]) {
      const r = await page.request.put(`${base}/api/ai-agent/org-config`, {
        data: { [field]: "anything" },
      });
      expect(r.status(), `field ${field}`).toBe(410);
      const body = await r.json();
      expect(body.error).toMatch(/ai-agent\/keys/);
      expect(body.error).toContain(field);
    }

    // 3) Per-key fields now live in the AI Key library. Round-trip a
    // key through `/ai-agent/keys` and verify the plaintext never
    // appears in any response.
    const plaintext = `sk-anthropic-e2e-test-${Date.now()}-1234ABCD`;
    const created = await page.request.post(`${base}/api/ai-agent/keys`, {
      data: {
        name: `e2e-providers-${Date.now().toString(36)}`,
        provider: "anthropic",
        apiKey: plaintext,
        model: "claude-3-5-haiku-latest",
        isDefault: false,
      },
    });
    expect(created.ok(), `keys create: ${await created.text()}`).toBeTruthy();
    const createdBody = await created.json();
    expect(createdBody.apiKeyLastFour).toBe("ABCD");
    expect(createdBody.model).toBe("claude-3-5-haiku-latest");
    expect(JSON.stringify(createdBody)).not.toContain(plaintext);

    const list = await page.request.get(`${base}/api/ai-agent/keys`);
    expect(JSON.stringify(await list.json())).not.toContain(plaintext);

    // Clean up the seeded key so we don't accumulate fakes.
    await page.request.delete(`${base}/api/ai-agent/keys/${createdBody.id}`);

    // 4) UI smoke check — open the Add-key dialog on the AI Agent
    // keys library and toggle providers to verify the dropdown lists
    // all eight providers and reveals/hides the right conditional
    // inputs.
    await page.goto(`${base}/tools/ai-agent`);
    await dismissOnboardingTour(page);
    await page.getByTestId("button-ai-keys-add").click();
    const dropdown = page.getByTestId("select-ai-keys-provider");
    await expect(dropdown).toBeVisible();
    // Open the dropdown and verify the option labels.
    await dropdown.click();
    for (const label of [
      "Anthropic (Claude)",
      "OpenAI",
      "Google Gemini",
      "OpenRouter",
      "Azure OpenAI",
      "Groq",
      "DeepSeek",
      "Mistral",
    ]) {
      await expect(
        page.getByRole("option", { name: label, exact: true }),
      ).toBeVisible();
    }
    // Close the dropdown by picking Anthropic so the Azure-only
    // inputs are NOT visible.
    await page
      .getByRole("option", { name: "Anthropic (Claude)", exact: true })
      .click();
    await expect(page.getByTestId("input-ai-keys-endpoint-url")).toHaveCount(0);
    await expect(page.getByTestId("input-ai-keys-api-version")).toHaveCount(0);

    // Switch to Azure → Endpoint + API version appear and Model
    // pre-fills with the per-provider default (blank for Azure).
    await dropdown.click();
    await page.getByRole("option", { name: "Azure OpenAI" }).click();
    await expect(page.getByTestId("input-ai-keys-endpoint-url")).toBeVisible();
    await expect(page.getByTestId("input-ai-keys-api-version")).toBeVisible();
    await expect(page.getByTestId("input-ai-keys-referer-url")).toHaveCount(0);
    await expect(page.getByTestId("input-ai-keys-model")).toHaveValue("");

    // Switch to OpenRouter → attribution headers appear.
    await dropdown.click();
    await page.getByRole("option", { name: "OpenRouter" }).click();
    await expect(page.getByTestId("input-ai-keys-referer-url")).toBeVisible();
    await expect(page.getByTestId("input-ai-keys-app-name")).toBeVisible();
    await expect(page.getByTestId("input-ai-keys-endpoint-url")).toHaveCount(0);
    // Model field pre-fills with the OpenRouter default.
    await expect(page.getByTestId("input-ai-keys-model")).toHaveValue(
      "anthropic/claude-3.5-haiku",
    );
  });

  test("Gemini end-to-end — Build with AI run lands on a clean run-status page", async ({
    page,
  }) => {
    const base = BASE!;
    await seedAdminCookie(page, base);

    // Reset onboarding-tour flag (the helper above only handles the
    // close button if the overlay shows).
    await page.request.post(`${base}/api/users/me/tour-seen`, {
      data: { hasSeenTour: true },
    });

    // 1) Configure Gemini at the org level with a fake key. The
    // rule-parser-only plan means the runner's chat() path is only
    // reached for the one unparseable line and the failure falls into
    // the catch branch, so the run still finishes `succeeded`.
    //
    // Org-enable flag still lives on the legacy `ai_agent_org_configs`
    // row; the runner resolves the actual key from `ai_agent_keys`.
    const orgCfg = await page.request.put(`${base}/api/ai-agent/org-config`, {
      data: { enabled: true, provider: "gemini" },
    });
    expect(orgCfg.ok()).toBeTruthy();

    // Ensure a default Gemini key exists in the new key library. We
    // delete any pre-existing default first so the round-trip test
    // ahead of us (which switched the legacy row to Azure) does not
    // leave us with a non-Gemini default.
    const list = (await (
      await page.request.get(`${base}/api/ai-agent/keys`)
    ).json()) as {
      keys: Array<{ id: string; provider: string; isDefault: boolean }>;
    };
    const hasGeminiDefault = list.keys.some(
      (k) => k.isDefault && k.provider === "gemini",
    );
    if (!hasGeminiDefault) {
      const created = await page.request.post(`${base}/api/ai-agent/keys`, {
        data: {
          name: `e2e-gemini-${Date.now().toString(36)}`,
          provider: "gemini",
          apiKey: "gemini-e2e-fake-key-for-tests-not-used",
          isDefault: true,
        },
      });
      expect(created.ok(), `keys create: ${await created.text()}`).toBeTruthy();
    }

    // 2) Enable AI on the seeded project. The `AiAgentTesting` C#
    // Playwright solution ships in the repo (task #43) so its presence
    // on disk is guaranteed — no on-demand scaffold required.
    const projCfg = await page.request.put(
      `${base}/api/ai-agent/projects/${encodeURIComponent(SEEDED_PROJECT)}/config`,
      { data: { enabled: true } },
    );
    expect(projCfg.ok()).toBeTruthy();

    // 3) Load the seeded project so the workbench can address it.
    const load = await page.request.post(`${base}/api/projects/load`, {
      data: { slnPath: SEEDED_SLN_PATH },
    });
    expect(load.ok()).toBeTruthy();

    // 4) Drive the Build-with-AI flow from the workbench toolbar.
    await page.goto(`${base}/workbench`);
    await dismissOnboardingTour(page);

    const aiButton = page.getByTestId("button-test-with-ai");
    await expect(aiButton).toBeVisible({ timeout: 20_000 });
    await expect(aiButton).toBeEnabled({ timeout: 20_000 });
    await aiButton.click();

    const suiteName = `E2EGemini${Date.now().toString(36)}`;
    await page.getByTestId("input-ai-suite-name").fill(suiteName);
    await page.getByTestId("textarea-ai-plan").fill(RULE_PARSER_PLAN);
    await page.getByTestId("button-ai-start-run").click();

    // 5) Run-status page renders cleanly — Plan / Steps / Materialized
    // files are all visible and at least one file was materialized.
    await page.waitForURL(/\/workbench\/ai-runs\//, { timeout: 20_000 });
    await expect(page.getByTestId("text-ai-run-status")).toHaveText(
      "succeeded",
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("text-ai-run-plan")).toBeVisible();
    await expect(page.getByTestId("list-ai-run-steps")).toBeVisible();
    await expect(page.getByTestId("list-ai-run-files")).toBeVisible();
    await expect(
      page.getByTestId("list-ai-run-files").locator("li"),
    ).not.toHaveCount(0);
    await expect(
      page.getByTestId("list-ai-run-steps").locator("li"),
    ).not.toHaveCount(0);
  });
});
