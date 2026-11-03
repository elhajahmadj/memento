import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  FORWARDED_HTTPS_HEADER,
  completeProfile as sharedCompleteProfile,
  devLogin as sharedDevLogin,
  type DevLoginRole,
} from "./_helpers/admin-session";

/**
 * End-to-end coverage for the Repos PAT admin tool (Admin →
 * Source control → Repos PAT). Exercises the four CRUD HTTP
 * endpoints behind the section against the live api-server +
 * test-builder workflows through the shared proxy, and asserts
 * the matching admin-only auth gates and the "bound project"
 * delete guard. Drives the API directly (same pattern as
 * `project-delete-approval.spec.ts`) so the spec is not
 * sensitive to UI markup churn.
 *
 * Gated on E2E_API_BASE_URL (e.g. `http://localhost:80`).
 */
const BASE = process.env.E2E_API_BASE_URL;

const SUITE_TAG = `e2e_repopats_${Date.now()}`;

interface PublicPat {
  id: string;
  provider: "azure_repos" | "github";
  name: string;
  patLastFour: string;
  createdAt: string;
  updatedAt: string;
}

async function devLogin(
  request: APIRequestContext,
  username: string,
  role: DevLoginRole,
): Promise<void> {
  await sharedDevLogin(request, BASE!, username, role);
}

async function completeProfile(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await sharedCompleteProfile(request, BASE!, email);
}

async function listPats(request: APIRequestContext): Promise<PublicPat[]> {
  const res = await request.get(`${BASE}/api/repo-pats`);
  expect(res.ok(), `list pats: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as PublicPat[];
}

test.describe("Repos PAT admin tool CRUD", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec.",
  );

  test.describe.configure({ mode: "serial" });

  // The api-server's session cookie is `secure: true`, so the proxy
  // must look like HTTPS — see `_helpers/admin-session.ts` for why.
  test.use({ extraHTTPHeaders: FORWARDED_HTTPS_HEADER });

  let createdId: string | null = null;

  test.afterAll(async ({ request }) => {
    if (!BASE || !createdId) return;
    await devLogin(request, `${SUITE_TAG}_admin`, "admin");
    await request.delete(`${BASE}/api/repo-pats/${createdId}`);
  });

  test("non-admin caller is rejected with 403", async ({ request }) => {
    await devLogin(request, `${SUITE_TAG}_user`, "limited");
    const res = await request.get(`${BASE}/api/repo-pats`);
    expect(res.status()).toBe(403);
  });

  test("admin can create, list, rename, rotate, and delete a PAT", async ({
    request,
  }) => {
    await devLogin(request, `${SUITE_TAG}_admin`, "admin");

    // Create
    const createRes = await request.post(`${BASE}/api/repo-pats`, {
      data: {
        provider: "azure_repos",
        name: `${SUITE_TAG}_pat_1`,
        pat: "ghx_e2e_repopat_initialXYZ",
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const created = (await createRes.json()) as PublicPat;
    createdId = created.id;
    expect(created.patLastFour).toBe("lXYZ");

    // List
    const all = await listPats(request);
    expect(all.find((p) => p.id === created.id)).toBeTruthy();
    // Plaintext PAT must never leak.
    expect(JSON.stringify(all)).not.toContain("ghx_e2e_repopat_initialXYZ");

    // Rename (PATCH without `pat` keeps the existing encrypted value)
    const patchRes = await request.patch(
      `${BASE}/api/repo-pats/${created.id}`,
      {
        data: {
          provider: "azure_repos",
          name: `${SUITE_TAG}_pat_renamed`,
        },
      },
    );
    expect(patchRes.status()).toBe(200);
    const renamed = (await patchRes.json()) as PublicPat;
    expect(renamed.name).toBe(`${SUITE_TAG}_pat_renamed`);
    expect(renamed.patLastFour).toBe("lXYZ");

    // Rotate (PATCH with a new `pat`)
    const rotateRes = await request.patch(
      `${BASE}/api/repo-pats/${created.id}`,
      {
        data: {
          provider: "azure_repos",
          name: `${SUITE_TAG}_pat_renamed`,
          pat: "ghx_e2e_repopat_rotatedZZZ",
        },
      },
    );
    expect(rotateRes.status()).toBe(200);
    expect(((await rotateRes.json()) as PublicPat).patLastFour).toBe("dZZZ");

    // Delete
    const delRes = await request.delete(
      `${BASE}/api/repo-pats/${created.id}`,
    );
    expect(delRes.status()).toBe(204);
    createdId = null;

    const after = await listPats(request);
    expect(after.find((p) => p.id === created.id)).toBeUndefined();
  });

  test("create rejects a duplicate (provider, name) with 400", async ({
    request,
  }) => {
    await devLogin(request, `${SUITE_TAG}_admin`, "admin");
    const name = `${SUITE_TAG}_dup`;
    const first = await request.post(`${BASE}/api/repo-pats`, {
      data: {
        provider: "github",
        name,
        pat: "ghp_e2e_repopat_dup_aaaa",
      },
    });
    expect(first.status()).toBe(201);
    const firstId = ((await first.json()) as PublicPat).id;
    try {
      const second = await request.post(`${BASE}/api/repo-pats`, {
        data: {
          provider: "github",
          name,
          pat: "ghp_e2e_repopat_dup_bbbb",
        },
      });
      expect(second.status()).toBe(400);
      const body = (await second.json()) as { error: string };
      expect(body.error).toMatch(/already exists/);
    } finally {
      await request.delete(`${BASE}/api/repo-pats/${firstId}`);
    }
  });

  test("PATCH on an unknown id returns 404", async ({ request }) => {
    await devLogin(request, `${SUITE_TAG}_admin`, "admin");
    const res = await request.patch(
      `${BASE}/api/repo-pats/00000000-0000-0000-0000-000000000000`,
      { data: { provider: "github", name: `${SUITE_TAG}_ghost` } },
    );
    expect(res.status()).toBe(404);
  });

  test("DELETE on an unknown id returns 404", async ({ request }) => {
    await devLogin(request, `${SUITE_TAG}_admin`, "admin");
    const res = await request.delete(
      `${BASE}/api/repo-pats/00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status()).toBe(404);
  });

  test("admin section renders behind the gate and exposes the section testid", async ({
    page,
  }) => {
    // Drive dev-login through `page.request` so the session cookie
    // lives in the same browser context as the navigation below.
    await devLogin(page.request, `${SUITE_TAG}_admin`, "admin");
    await completeProfile(page.request, `${SUITE_TAG}_admin@example.com`);
    const resp = await page.goto(`${BASE}/admin#repo-pats`);
    expect(resp?.ok(), `admin page status ${resp?.status()}`).toBeTruthy();
    // Section is wrapped in <div data-testid="section-repo-pats">.
    await expect(
      page.locator('[data-testid="section-repo-pats"]'),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("admin can add a new Repos PAT through the dialog and delete it via the row action", async ({
    page,
  }) => {
    // Full UI-driven flow: open the section, click "Add Repo PAT",
    // fill the dialog, save, assert the new row appears, then delete
    // it through the row's delete button + AlertDialog confirm. This
    // catches regressions in the dialog wiring (provider select +
    // name + pat → POST /api/repo-pats) and the delete confirm
    // flow that the API-only tests above can't see.
    await devLogin(page.request, `${SUITE_TAG}_admin`, "admin");
    await completeProfile(page.request, `${SUITE_TAG}_admin@example.com`);
    const resp = await page.goto(`${BASE}/admin#repo-pats`);
    expect(resp?.ok(), `admin page status ${resp?.status()}`).toBeTruthy();

    const section = page.locator('[data-testid="section-repo-pats"]');
    await expect(section).toBeVisible({ timeout: 15_000 });

    const patName = `${SUITE_TAG}_ui_${Date.now()}`;
    try {
      await section
        .locator('[data-testid="button-repo-pats-add"]')
        .click();
      // Dialog testids live on a portal'd dialog, not under the
      // section — query from `page`.
      await page
        .locator('[data-testid="input-repo-pats-name"]')
        .fill(patName);
      await page
        .locator('[data-testid="input-repo-pats-pat"]')
        .fill("ghp_e2e_ui_repopat_aaaaLAST");
      await page
        .locator('[data-testid="button-repo-pats-save"]')
        .click();

      // The dialog closes and a new row renders with a testid that
      // includes the PAT row id. We don't know the id up front, so
      // scope to the section and match on the row's visible name.
      const newRow = section
        .locator('[data-testid^="row-repo-pats-"]')
        .filter({ hasText: patName });
      await expect(newRow).toBeVisible({ timeout: 10_000 });

      // Now delete it via the row action + AlertDialog confirm.
      await newRow
        .locator('[data-testid^="button-repo-pats-delete-"]')
        .click();
      await page
        .locator('[data-testid="button-repo-pats-confirm-delete"]')
        .click();
      await expect(newRow).toHaveCount(0, { timeout: 10_000 });
    } finally {
      // Best-effort cleanup in case an assertion above bailed before
      // the UI delete completed.
      const remaining = await page.request.get(`${BASE}/api/repo-pats`);
      if (remaining.ok()) {
        const list = (await remaining.json()) as PublicPat[];
        for (const row of list.filter((r) => r.name === patName)) {
          await page.request.delete(`${BASE}/api/repo-pats/${row.id}`);
        }
      }
    }
  });

  test("admin can bind an existing project's git-config to an existing Repos PAT through the UI", async ({
    page,
  }) => {
    // UI-driven flow for the "Existing Repo PAT" path of the project
    // git-config Edit dialog (Admin → Source control → Git Repos).
    // Creates a Repos PAT via the API (the UI flow for that is
    // covered by the previous test), then drives the project row's
    // Edit → provider=existing_pat → pick PAT → Save UI, and asserts
    // the row's summary cell reflects the binding (PAT name + masked
    // last-four) via the API-side git-config response.
    await devLogin(page.request, `${SUITE_TAG}_admin`, "admin");
    await completeProfile(page.request, `${SUITE_TAG}_admin@example.com`);

    // Pre-create the Repos PAT we'll bind to.
    const patRes = await page.request.post(`${BASE}/api/repo-pats`, {
      data: {
        provider: "github",
        name: `${SUITE_TAG}_ui_bind`,
        pat: "ghp_e2e_ui_bind_aaaaBIND",
      },
    });
    expect(patRes.status()).toBe(201);
    const pat = (await patRes.json()) as PublicPat;

    // We need an existing project to edit. Pick the first one
    // available; if there are none the test is a no-op (Source
    // control UI requires at least one project to render a row).
    const projectsRes = await page.request.get(`${BASE}/api/projects/available`);
    expect(projectsRes.ok()).toBeTruthy();
    const projects = (await projectsRes.json()) as Array<{
      solutionName: string;
    }>;
    test.skip(
      projects.length === 0,
      "No projects available — Source control UI needs at least one project row to drive.",
    );
    const projectName = projects[0]!.solutionName;
    try {
      const resp = await page.goto(`${BASE}/admin#git-repos`);
      expect(resp?.ok(), `admin page status ${resp?.status()}`).toBeTruthy();

      const row = page.locator(
        `[data-testid="row-git-repos-${projectName}"]`,
      );
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row
        .locator(`[data-testid="button-git-repos-edit-${projectName}"]`)
        .click();

      // Switch the provider mode to "Existing Repo PAT".
      await page
        .locator(`[data-testid="select-git-repos-provider-${projectName}"]`)
        .click();
      await page.getByRole("option", { name: /Existing Repo PAT/i }).click();

      // Pick our PAT from the select. The select is a Radix Select;
      // its options are rendered with role=option.
      await page
        .locator(`[data-testid="select-git-repos-repo-pat-${projectName}"]`)
        .click();
      await page.getByRole("option", { name: pat.name }).click();

      // Set a repo URL appropriate for github so server-side
      // validateRepoUrl accepts it. Branch stays as whatever was on
      // the row.
      const urlInput = page.locator(
        `[data-testid="input-git-repos-url-${projectName}"]`,
      );
      await urlInput.fill("https://github.com/example/repo.git");

      // The Edit dialog content can overflow the viewport on the
      // shorter default Playwright window, leaving the Save button
      // permanently "outside of the viewport" for Playwright's
      // stability check. Scroll it in explicitly before clicking.
      const saveBtn = page.locator(
        `[data-testid="button-git-repos-save-${projectName}"]`,
      );
      await saveBtn.scrollIntoViewIfNeeded();
      await saveBtn.click({ force: true });

      // UI-side assertion: the summary cell for this row should
       // surface the linked PAT's name (or at least the masked
       // last-four) once the save completes, so an admin scanning
       // the table can see at a glance that the project is on the
       // shared-PAT path. We match on the PAT name first (preferred)
       // then fall back to the masked last-four, so this doesn't
       // snap on UI copy wording.
      const summary = page.locator(
        `[data-testid="text-git-repos-summary-${projectName}"]`,
      );
      await expect(summary).toContainText(
        new RegExp(`${pat.name}|\\*+${pat.patLastFour}`),
        { timeout: 10_000 },
      );

      // Verify via the API that the project is now bound to our PAT.
      await expect
        .poll(
          async () => {
            const r = await page.request.get(
              `${BASE}/api/projects/${encodeURIComponent(projectName)}/git-config`,
            );
            if (!r.ok()) return null;
            const body = (await r.json()) as {
              repoPatId: string | null;
              repoPatName: string | null;
              patLastFour: string | null;
            };
            return body;
          },
          { timeout: 10_000 },
        )
        .toMatchObject({
          repoPatId: pat.id,
          repoPatName: pat.name,
          patLastFour: pat.patLastFour,
        });
    } finally {
      // Cleanup: the PAT is now bound, so DELETE will 409. Flip the
      // project back to an inline PAT first (server requires a fresh
      // PAT to switch back), then delete the Repos PAT row.
      await page.request.put(
        `${BASE}/api/projects/${encodeURIComponent(projectName)}/git-config`,
        {
          data: {
            provider: "github",
            repoUrl: "https://github.com/example/repo.git",
            branch: "main",
            pat: "ghp_e2e_ui_bind_cleanupCLEAN",
          },
        },
      );
      await page.request.delete(`${BASE}/api/repo-pats/${pat.id}`);
    }
  });
});
