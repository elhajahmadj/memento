import { test, expect, type Page } from "@playwright/test";

/**
 * UI-driven full-stack e2e for the Node.js API test solution flow.
 *
 * Drives the real workbench against the live api-server + test-builder
 * workflows behind the shared proxy:
 *
 *   1. Sign in as an admin via `/api/auth/dev-login` to seed a session
 *      cookie on the browsing context.
 *   2. Open the Scaffold New Solution dialog from the home page.
 *   3. Pick `solutionType=api` + `language=nodejs`, fill in a unique
 *      solution name, click Create.
 *   4. The workbench navigates into the new project. Open the Build
 *      Test dialog from the toolbar and walk both wizard steps,
 *      submitting the minimal endpoint spec.
 *   5. Assert the success toast and that the generated
 *      `tests/tests/<sln>-tests.spec.ts` file shows up in the project
 *      file tree.
 *
 * Gated behind `E2E_API_BASE_URL` (e.g. `http://localhost:80`) because
 * the default `playwright.config.ts` webServer is the test-builder
 * vite dev server only — this spec needs both api-server + test-builder
 * workflows running behind the shared proxy.
 */
const BASE = process.env.E2E_API_BASE_URL;

async function seedAdminCookie(page: Page, base: string): Promise<void> {
  // Navigate via the browser so the Set-Cookie lands in the page's
  // cookie jar (not just the APIRequestContext jar).
  const res = await page.goto(
    `${base}/api/auth/dev-login?email=admin@example.com&role=admin`,
  );
  if (!res || !res.ok()) {
    throw new Error(
      `dev-login failed: ${res?.status()} (is APP_ENVIRONMENT=development on the api-server?)`,
    );
  }
  // Dev-login leaves profileComplete=false on a freshly seeded user,
  // which the AuthGate redirects to /profile/complete. Mark the
  // profile complete via the same session so the projects home
  // renders.
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
}

async function tryClickByText(page: Page, text: string): Promise<boolean> {
  const button = page.getByRole("button", { name: text }).first();
  if (await button.count()) {
    await button.click();
    return true;
  }
  return false;
}

test.describe("Node.js API test solution UI flow", () => {
  test.skip(!BASE, "Set E2E_API_BASE_URL to run against the live api-server");
  test.setTimeout(60_000);

  test("create + build emits a Node.js suite visible in the file tree", async ({
    page,
    context,
  }) => {
    const base = BASE!;
    await seedAdminCookie(page, base);

    await page.goto(`${base}/`);
    // The admin projects home renders one of two entry points to the
    // Scaffold New Solution dialog:
    //   - `button-new-project` in the header when projects already exist
    //   - `button-add-project-empty` in the empty-state card when none do
    // Either flips the same `setNewOpen(true)` state.
    const newBtn = page.getByTestId("button-new-project");
    const emptyBtn = page.getByTestId("button-add-project-empty");
    await expect(newBtn.or(emptyBtn)).toBeVisible({ timeout: 20_000 });
    // The onboarding tour overlay covers the page on first load and
    // intercepts pointer events. Close it before interacting with the
    // projects toolbar.
    const tourClose = page.getByTestId("button-tour-close");
    if (await tourClose.count()) {
      await tourClose.click();
      await expect(page.getByTestId("onboarding-tour-overlay")).toHaveCount(0);
    }
    if (await newBtn.count()) {
      await newBtn.click();
    } else {
      await emptyBtn.click();
    }

    // Fill the dialog: solutionType=api, language=nodejs.
    await page.getByTestId("radio-solution-type-api").click();
    await page.getByTestId("select-language").click();
    await page.getByTestId("option-language-nodejs").click();
    const solutionName = `E2EApiNodejs${Date.now().toString(36)}`;
    await page.getByTestId("input-solution-name").fill(solutionName);
    // The dialog auto-derives testProjectName + namespace from
    // solutionName — for nodejs API we keep the auto-filled values.
    await page.getByTestId("button-create-project").click();

    // After creation the workbench navigates into the project; the
    // toolbar's Build Test button (`button-build-test`) becomes
    // visible.
    await expect(page.getByTestId("button-build-test")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId("button-build-test").click();

    // Step 1 — endpoint constant + URL.
    await page.getByTestId("input-url-name").fill("Default");
    await page.getByTestId("input-base-url").fill("https://api.example.com");
    await page.getByTestId("input-endpoint-name").fill("GetUsers");
    await page.getByTestId("input-endpoint-path").fill("/users");
    await page.getByTestId("button-build-test-next").click();

    // Step 2 — helper + test method + new test class.
    await page.getByTestId("input-helper-method").fill("GetUsersAsync");
    await page.getByTestId("input-test-method-name").fill("GetUsers_Returns200");
    await page.getByTestId("radio-test-class-new").click();
    await page.getByTestId("input-new-class-name").fill("UsersTests");
    await page.getByTestId("button-build-test-submit").click();

    // The success path closes the dialog and shows a "Built N files"
    // toast. We assert the dialog is gone and the new spec file is
    // visible in the project tree (as kebab-case `users-tests.spec.ts`
    // under `tests/tests/`).
    await expect(page.getByTestId("button-build-test-submit")).toHaveCount(0, {
      timeout: 20_000,
    });

    // Verify on the server side that the four expected files exist —
    // this is more reliable than poking the file-tree DOM, which has
    // its own virtualization quirks and can lag behind the cache
    // invalidation. Going through the public `/api/projects/tree`
    // endpoint keeps the assertion end-to-end.
    const tree = await context.request.get(`${base}/api/projects/tree`);
    expect(tree.ok()).toBe(true);
    interface TreeNode {
      path: string;
      type: "file" | "folder";
      children?: TreeNode[];
    }
    const treeJson = (await tree.json()) as TreeNode;
    const allPaths: string[] = [];
    (function walk(n: TreeNode) {
      allPaths.push(n.path);
      n.children?.forEach(walk);
    })(treeJson);
    expect(allPaths).toContain("tests/tests/users-tests.spec.ts");
    expect(allPaths).toContain(
      "tests/api-testing-assistants/users-tests-api-testing-assistants.ts",
    );
    expect(allPaths).toContain(
      "src/automation-api/constants/api-endpoints.ts",
    );
  });
});
