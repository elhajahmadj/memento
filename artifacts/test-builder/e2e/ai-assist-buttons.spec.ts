import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end smoke for the AI assist surfaces wired in task #32.
 *
 * Drives the real test-builder UI behind the shared proxy and asserts
 * that at least one of the new sparkle buttons ("Suggest tests" on
 * the Projects page) opens its dialog, calls the
 * `POST /api/ai-agent/assists/test-ideas-from-url` endpoint, and
 * renders the AI's response inline. The provider call itself is
 * mocked at the network layer via `page.route(...)` so the test does
 * not depend on a live LLM provider key — the response shape is the
 * same one the server emits on success.
 *
 * Gated behind `E2E_API_BASE_URL` (e.g. `http://localhost:80`).
 */
const BASE = process.env.E2E_API_BASE_URL;

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
  await page.request.post(`${base}/api/users/me/tour-seen`, {
    data: { hasSeenTour: true },
  });
}

async function dismissOnboardingTour(page: Page): Promise<void> {
  const tourClose = page.getByTestId("button-tour-close");
  if (await tourClose.count()) {
    await tourClose.click();
    await expect(page.getByTestId("onboarding-tour-overlay")).toHaveCount(0);
  }
}

test.describe("AI assist buttons — Projects page", () => {
  test.skip(!BASE, "Set E2E_API_BASE_URL to run against the live api-server");
  test.setTimeout(60_000);

  test("'Suggest tests' button opens the dialog and renders the mocked AI response", async ({
    page,
  }) => {
    const base = BASE!;
    await seedAdminCookie(page, base);

    // Intercept the assist endpoint with a canned response so the
    // test is independent of provider keys / network.
    await page.route(
      "**/api/ai-agent/assists/test-ideas-from-url",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            output: {
              ideas: [
                {
                  name: "Sign-up happy path",
                  oneLineDescription:
                    "A new user signs up with a fresh email and lands on the dashboard.",
                  suggestedSteps: [
                    "Navigate to /signup",
                    "Fill the email field",
                    "Fill the password field",
                    "Click the Create account button",
                    "Expect to land on /dashboard",
                  ],
                },
                {
                  name: "Sign-up with taken email",
                  oneLineDescription:
                    "Submitting an email that already exists surfaces a clear error.",
                  suggestedSteps: [
                    "Navigate to /signup",
                    "Fill the email field with an existing account",
                    "Click Create account",
                    "Expect an 'email already taken' message",
                  ],
                },
              ],
            },
            model: "mock-model",
            usage: {
              promptTokens: 100,
              completionTokens: 200,
              totalTokens: 300,
            },
            purpose: "test-ideas-from-url",
          }),
        });
      },
    );

    await page.goto(`${base}/projects`);
    await dismissOnboardingTour(page);

    // The "Suggest tests" button only renders when at least one
    // project is visible to the admin. The dev-login admin has full
    // access, so any seeded project will satisfy the gate; if the
    // workspace happens to be empty the button isn't shown and the
    // test is a no-op for the assertion below — skip in that case
    // so an empty environment doesn't fail this smoke.
    const suggestBtn = page.getByTestId("button-suggest-tests");
    if ((await suggestBtn.count()) === 0) {
      test.skip(true, "No projects visible — Suggest tests button not rendered");
    }
    await expect(suggestBtn).toBeVisible({ timeout: 10_000 });
    await suggestBtn.click();

    await page
      .getByTestId("input-suggest-tests-url")
      .fill("https://example.com");
    await page.getByTestId("button-suggest-tests-run").click();

    await expect(page.getByTestId("list-suggest-tests-ideas")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("item-suggest-tests-idea-0")).toContainText(
      "Sign-up happy path",
    );
    await expect(page.getByTestId("item-suggest-tests-idea-1")).toContainText(
      "Sign-up with taken email",
    );
  });
});
