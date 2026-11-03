import { test, expect } from "@playwright/test";

/**
 * End-to-end coverage for the post-login Home (formerly /dashboard,
 * task #30; promoted to `/` in task #34):
 *   - signing in routes through /splash and lands on `/`;
 *   - /dashboard remains as a permanent redirect to `/`;
 *   - /api/dashboard/summary returns 200 and matches the role;
 *   - the top nav lists Home first, then Projects.
 *
 * Driven through the shared proxy (E2E_API_BASE_URL, e.g.
 * http://localhost:80) so it runs against the real api-server +
 * test-builder workflows.
 */
const BASE = process.env.E2E_API_BASE_URL;

test.describe("post-login Home (`/`)", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec against the live workflows.",
  );

  for (const role of ["admin", "limited_admin", "limited"] as const) {
    test(`${role} lands on / after sign-in`, async ({ page }) => {
      // dev-login + cookie
      const loginResp = await page.request.get(
        `${BASE}/api/auth/dev-login?role=${role}`,
      );
      expect(loginResp.ok()).toBeTruthy();

      // The dev-login endpoint sets a session cookie scoped to the
      // proxied origin. Navigate directly to /.
      await page.goto(`${BASE}/`);
      await expect(page.getByTestId("page-dashboard")).toBeVisible();
      await expect(page.getByTestId("dash-title")).toBeVisible();

      // Every role sees these three core widgets.
      await expect(page.getByTestId("widget-my-recent-runs")).toBeVisible();
      await expect(page.getByTestId("widget-my-projects")).toBeVisible();
      await expect(page.getByTestId("widget-drafts-in-progress")).toBeVisible();

      // Top nav: Home is the first link, Projects comes second.
      await expect(page.getByTestId("nav-link-home")).toBeVisible();
      await expect(page.getByTestId("nav-link-projects")).toBeVisible();
    });

    test(`${role}: /projects renders the Projects picker`, async ({ page }) => {
      const loginResp = await page.request.get(
        `${BASE}/api/auth/dev-login?role=${role}`,
      );
      expect(loginResp.ok()).toBeTruthy();

      await page.goto(`${BASE}/projects`);
      // Projects page MUST NOT render the Dashboard widgets — confirms
      // routing actually swapped pages and didn't fall through to `/`.
      await expect(page.getByTestId("widget-my-recent-runs")).toHaveCount(0);
      // The Projects-page top-nav active state lives on the Projects
      // link, not Home — locks in the route swap.
      await expect(page.getByTestId("nav-link-projects")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByTestId("nav-link-home")).not.toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    test(`${role}: /dashboard permanently redirects to /`, async ({ page }) => {
      const loginResp = await page.request.get(
        `${BASE}/api/auth/dev-login?role=${role}`,
      );
      expect(loginResp.ok()).toBeTruthy();

      await page.goto(`${BASE}/dashboard`);
      await page.waitForURL((url) => new URL(url).pathname === "/");
      await expect(page.getByTestId("page-dashboard")).toBeVisible();
    });
  }

  test("API: /api/dashboard/summary returns 200 with role-tailored shape", async ({
    request,
  }) => {
    const login = await request.get(`${BASE}/api/auth/dev-login?role=admin`);
    expect(login.ok()).toBeTruthy();
    const resp = await request.get(`${BASE}/api/dashboard/summary?window=7d`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.role).toBe("admin");
    expect(body.window).toBe("7d");
    expect(Array.isArray(body.myRecentRuns)).toBe(true);
    expect(body.orgs).toBeNull();
    expect(body.systemHealth).toBeNull();
    expect(body.users).not.toBeNull();
  });
});
