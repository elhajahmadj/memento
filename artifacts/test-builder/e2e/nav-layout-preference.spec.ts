import { test, expect, type Page, type BrowserContext } from "@playwright/test";

/**
 * End-to-end coverage for the Settings → Appearance "Navigation
 * layout" preference. Drives the real test-builder UI behind the
 * shared proxy (api-server + test-builder workflows) and proves that
 * the choice round-trips through the server: switching to side-nav,
 * signing out, and signing back in (fresh browser context) leaves the
 * side nav as the active layout.
 *
 * Gated behind `E2E_API_BASE_URL` (e.g. `http://localhost:80`).
 */
const BASE = process.env.E2E_API_BASE_URL;

const USER_EMAIL = `nav-layout-e2e-${Date.now().toString(36)}@example.com`;

async function seedUserCookie(page: Page, base: string): Promise<void> {
  // The dev-login shortcut provisions the user on first hit and reuses
  // the same row on subsequent calls — perfect for re-establishing the
  // session in a fresh browser context with the preference still
  // persisted server-side.
  // The Appearance section in Settings is admin-gated, so the user
  // driving the preference toggle must be an admin.
  const url = `${base}/api/auth/dev-login?email=${encodeURIComponent(
    USER_EMAIL,
  )}&role=admin`;
  const res = await page.goto(url);
  if (!res || !res.ok()) {
    throw new Error(
      `dev-login failed: ${res?.status()} (is APP_ENVIRONMENT=development on the api-server?)`,
    );
  }
  // Complete the profile so the SPA does not redirect to
  // /profile-complete and hide the nav.
  const profile = await page.request.put(`${base}/api/auth/profile`, {
    data: {
      firstName: "Nav",
      lastName: "Layout",
      title: "QA",
      email: USER_EMAIL,
    },
  });
  if (!profile.ok()) {
    throw new Error(
      `profile update failed: ${profile.status()} ${await profile.text()}`,
    );
  }
  // Mark the onboarding tour as seen so its overlay doesn't intercept
  // clicks on the nav.
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

async function getPreference(
  context: BrowserContext,
  base: string,
): Promise<string> {
  const res = await context.request.get(`${base}/api/users/me/preferences`);
  expect(res.ok(), `GET preferences returned ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { navLayout: string };
  return body.navLayout;
}

test.describe("Settings → Appearance — Navigation layout preference", () => {
  test.skip(!BASE, "Set E2E_API_BASE_URL to run against the live api-server");
  test.setTimeout(90_000);

  test("switching to Side nav persists across sign-out and back in", async ({
    browser,
  }) => {
    const base = BASE!;

    // ── Session 1 ────────────────────────────────────────────────
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await seedUserCookie(page1, base);

    // Reset the user back to the default before driving the UI so the
    // test is idempotent regardless of any previous run that left
    // `side` in the row.
    const reset = await page1.request.put(
      `${base}/api/users/me/preferences`,
      { data: { navLayout: "top" } },
    );
    expect(reset.ok(), `reset preferences returned ${reset.status()}`).toBeTruthy();

    await page1.goto(`${base}/`);
    await dismissOnboardingTour(page1);

    // Top bar is the default — the header nav link should be visible
    // and the side nav should not exist.
    await expect(page1.getByTestId("nav-link-projects")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page1.getByTestId("side-nav")).toHaveCount(0);

    // Open Settings → Appearance and switch to side nav.
    await page1.goto(`${base}/settings`);
    await dismissOnboardingTour(page1);
    // Appearance is a collapsed section; expand it before the radio
    // is in the DOM.
    const appearanceTrigger = page1.getByTestId(
      "collapsible-trigger-appearance",
    );
    await expect(appearanceTrigger).toBeVisible({ timeout: 20_000 });
    await appearanceTrigger.click();
    const sideRadio = page1.getByTestId("radio-nav-layout-side");
    await expect(sideRadio).toBeVisible({ timeout: 20_000 });
    await sideRadio.click();

    // The mutation is fired optimistically. Wait until the server has
    // the new value before navigating away so the assertion on the
    // next page can't race the PUT.
    await expect
      .poll(() => getPreference(ctx1, base), { timeout: 10_000 })
      .toBe("side");

    // Navigate to a different top-level page and assert the side nav
    // is now showing instead of the top bar.
    await page1.goto(`${base}/`);
    await expect(page1.getByTestId("side-nav")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page1.getByTestId("side-nav-link-projects")).toBeVisible();

    // Sign out via the API and close the context so no cookies leak.
    const logout = await page1.request.post(`${base}/api/auth/logout`);
    expect(logout.ok(), `logout returned ${logout.status()}`).toBeTruthy();
    await ctx1.close();

    // ── Session 2 (fresh browser context) ────────────────────────
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await seedUserCookie(page2, base);

    // Server still remembers the choice.
    expect(await getPreference(ctx2, base)).toBe("side");

    await page2.goto(`${base}/`);
    await dismissOnboardingTour(page2);
    await expect(page2.getByTestId("side-nav")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page2.getByTestId("side-nav-link-projects")).toBeVisible();

    await ctx2.close();
  });
});
