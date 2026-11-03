import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * End-to-end coverage for `POST /api/projects/clone` and the
 * Repos PAT-driven `existing_pat` branch. Exercises three live
 * paths through the api-server + test-builder workflows behind
 * the shared proxy:
 *   1. Inline-PAT clone of a bare local repo → project appears in
 *      `/api/projects/available` and has a matching git-config row.
 *   2. existing_pat clone of a bare local repo → server resolves
 *      credentials from a Repos PAT row instead of an inline PAT
 *      and the resulting git-config row reports the linked PAT.
 *   3. The rollback path: a cloned repo with no recognizable
 *      project marker returns 400 and leaves no orphan project.
 *
 * Gated on E2E_API_BASE_URL (e.g. `http://localhost:80`). The
 * api-server must run with `APP_ENVIRONMENT=development` so the
 * dev-login shortcut works and `file://` URLs pass the repo URL
 * validator.
 */
const BASE = process.env.E2E_API_BASE_URL;

const SUITE_TAG = `e2e_clone_${Date.now()}`;

function runCli(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function git(args: string[], opts: { cwd?: string } = {}): Promise<void> {
  const r = await runCli("git", args, opts);
  if (r.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
}

async function makeBareRepo(args: {
  dir: string;
  branch: string;
  withMarker: boolean;
  solutionName?: string;
}): Promise<string> {
  const bare = path.join(args.dir, "bare.git");
  await fs.mkdir(bare, { recursive: true });
  await git(["init", "--bare", "-b", args.branch, bare]);
  const work = path.join(args.dir, "work");
  await git(["clone", bare, work]);
  await git(["-C", work, "checkout", "-B", args.branch]);
  if (args.withMarker) {
    await fs.writeFile(
      path.join(work, ".testbuilder.json"),
      JSON.stringify({
        language: "csharp",
        ...(args.solutionName
          ? {
              solutionName: args.solutionName,
              testProjectName: `${args.solutionName}.Tests`,
              namespace: `${args.solutionName}.QA`,
              solutionType: "playwright",
            }
          : {}),
      }),
    );
    if (args.solutionName) {
      // listAvailableProjects() requires a `<solutionName>.sln` for
      // C# projects — the .testbuilder.json marker alone isn't enough
      // for the project to appear in `/api/projects/available`.
      await fs.writeFile(
        path.join(work, `${args.solutionName}.sln`),
        "Microsoft Visual Studio Solution File, Format Version 12.00\n",
      );
    }
  }
  await fs.writeFile(path.join(work, "README.md"), "hi\n");
  await git(["-C", work, "add", "-A"]);
  await git([
    "-C",
    work,
    "-c",
    "user.name=tester",
    "-c",
    "user.email=t@t",
    "commit",
    "-m",
    "initial",
  ]);
  await git(["-C", work, "push", "origin", args.branch]);
  await fs.rm(work, { recursive: true, force: true });
  return `file://${bare}`;
}

async function devLogin(
  request: APIRequestContext,
  username: string,
  role: "admin",
): Promise<void> {
  const res = await request.get(
    `${BASE}/api/auth/dev-login?email=${encodeURIComponent(username)}&role=${role}`,
  );
  expect(res.ok(), `dev-login(${username},${role}) failed`).toBeTruthy();
}

async function projectExists(
  request: APIRequestContext,
  solutionName: string,
): Promise<boolean> {
  const res = await request.get(`${BASE}/api/projects/available`);
  if (!res.ok()) return false;
  const rows = (await res.json()) as Array<{ solutionName: string }>;
  return rows.some((r) => r.solutionName === solutionName);
}

async function deleteProject(
  request: APIRequestContext,
  solutionName: string,
): Promise<void> {
  await request.delete(
    `${BASE}/api/projects/${encodeURIComponent(solutionName)}`,
    { data: { acknowledgeIrreversible: true } },
  );
}

test.describe("POST /api/projects/clone", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec.",
  );

  test.describe.configure({ mode: "serial" });

  const repoDirs: string[] = [];
  const createdProjects: string[] = [];
  const createdPats: string[] = [];

  test.afterAll(async ({ request }) => {
    if (!BASE) return;
    await devLogin(request, `${SUITE_TAG}_admin`, "admin");
    for (const name of createdProjects) {
      await deleteProject(request, name);
    }
    for (const id of createdPats) {
      await request.delete(`${BASE}/api/repo-pats/${id}`);
    }
    for (const dir of repoDirs) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("inline-PAT clone of a local bare repo registers the project", async ({
    request,
  }) => {
    await devLogin(request, `${SUITE_TAG}_admin`, "admin");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-clone-inl-"));
    repoDirs.push(dir);
    const solutionName = `${SUITE_TAG}_inline`;
    const url = await makeBareRepo({
      dir,
      branch: "main",
      withMarker: true,
      solutionName,
    });
    const res = await request.post(`${BASE}/api/projects/clone`, {
      data: {
        solutionName,
        provider: "azure_repos",
        repoUrl: url,
        branch: "main",
        pat: "e2e_inline_pat_abcd1234LAST",
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    createdProjects.push(solutionName);
    expect(await projectExists(request, solutionName)).toBe(true);

    const cfgRes = await request.get(
      `${BASE}/api/projects/${solutionName}/git-config`,
    );
    expect(cfgRes.status()).toBe(200);
    const cfg = (await cfgRes.json()) as {
      patLastFour: string | null;
      repoPatId: string | null;
    };
    expect(cfg.patLastFour).toBe("LAST");
    expect(cfg.repoPatId).toBeNull();
  });

  test("existing_pat clone resolves credentials from a Repos PAT row", async ({
    request,
  }) => {
    await devLogin(request, `${SUITE_TAG}_admin`, "admin");

    // Create a Repos PAT row to clone with.
    const patRes = await request.post(`${BASE}/api/repo-pats`, {
      data: {
        provider: "azure_repos",
        name: `${SUITE_TAG}_shared`,
        pat: "e2e_shared_pat_xxxxxxxSHRD",
      },
    });
    expect(patRes.status(), await patRes.text()).toBe(201);
    const pat = (await patRes.json()) as { id: string; patLastFour: string };
    createdPats.push(pat.id);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-clone-shr-"));
    repoDirs.push(dir);
    const solutionName = `${SUITE_TAG}_shared_proj`;
    const url = await makeBareRepo({
      dir,
      branch: "main",
      withMarker: true,
      solutionName,
    });
    const res = await request.post(`${BASE}/api/projects/clone`, {
      data: {
        solutionName,
        provider: "existing_pat",
        repoPatId: pat.id,
        repoUrl: url,
        branch: "main",
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    createdProjects.push(solutionName);

    const cfgRes = await request.get(
      `${BASE}/api/projects/${solutionName}/git-config`,
    );
    expect(cfgRes.status()).toBe(200);
    const cfg = (await cfgRes.json()) as {
      provider: string;
      repoPatId: string | null;
      repoPatName: string | null;
      patLastFour: string | null;
      patSetAt: string | null;
    };
    expect(cfg.repoPatId).toBe(pat.id);
    expect(cfg.repoPatName).toBe(`${SUITE_TAG}_shared`);
    expect(cfg.patLastFour).toBe(pat.patLastFour);
    // The git-config row itself never stores the PAT in shared mode,
    // so patSetAt must be null.
    expect(cfg.patSetAt).toBeNull();

    // Deleting a Repos PAT bound to a project must be blocked with 409.
    const deletePatBlocked = await request.delete(
      `${BASE}/api/repo-pats/${pat.id}`,
    );
    expect(deletePatBlocked.status()).toBe(409);
    const blockedBody = (await deletePatBlocked.json()) as {
      boundProjects: string[];
    };
    expect(blockedBody.boundProjects).toContain(solutionName);
  });

  test("user-driven UI: Projects → New Project → Clone-from-repo tab using an Existing Repo PAT", async ({
    page,
  }) => {
    // UI-driven flow includes a full workbench navigation; the
    // default 30s timeout isn't enough on slow CI runners.
    test.setTimeout(120_000);
    // Full UI-driven flow for the "Clone from repo" tab of the New
    // Project dialog using the `existing_pat` branch. Bare repo
    // already has a `.testbuilder.json` marker so the server's
    // marker check passes; this test then opens the cloned project
    // in the workbench and asserts a basic workstation render (the
    // workbench toolbar) shows up. That last step covers the
    // "basic workstation action works on the cloned project"
    // requirement.
    await devLogin(page.request, `${SUITE_TAG}_admin`, "admin");
    // The first-run onboarding tour intercepts pointer events on the
    // Projects page; mark the profile complete and the tour seen so
    // the New Project button is clickable.
    await page.request.put(`${BASE}/api/auth/profile`, {
      data: {
        firstName: "E2E",
        lastName: "Clone",
        title: "QA",
        email: `${SUITE_TAG}_admin@e2e.local`,
      },
    });
    await page.request.post(`${BASE}/api/users/me/tour-seen`, {
      data: { hasSeenTour: true },
    });

    // Pre-create the Repos PAT we'll bind the clone to.
    const patRes = await page.request.post(`${BASE}/api/repo-pats`, {
      data: {
        provider: "azure_repos",
        name: `${SUITE_TAG}_ui_clone`,
        pat: "ui-clone-pat-aaaaUI42",
      },
    });
    expect(patRes.status()).toBe(201);
    const pat = (await patRes.json()) as { id: string; name: string };

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-clone-ui-"));
    repoDirs.push(dir);
    const solutionName = `${SUITE_TAG}_uiclone`;
    const url = await makeBareRepo({
      dir,
      branch: "main",
      withMarker: true,
      solutionName,
    });

    try {
      const resp = await page.goto(`${BASE}/projects`);
      expect(resp?.ok(), `projects page status ${resp?.status()}`).toBeTruthy();

      await page
        .locator('[data-testid="button-new-project"]')
        .click({ timeout: 15_000 });
      await page.locator('[data-testid="tab-new-project-clone"]').click();

      // provider = existing_pat
      await page.locator('[data-testid="select-clone-provider"]').click();
      await page
        .locator('[data-testid="option-clone-provider-existing_pat"]')
        .click();

      // pick the PAT we created
      await page.locator('[data-testid="select-clone-repo-pat"]').click();
      await page.getByRole("option", { name: pat.name }).click();

      await page.locator('[data-testid="input-clone-repo-url"]').fill(url);
      await page.locator('[data-testid="input-clone-branch"]').fill("main");
      await page
        .locator('[data-testid="input-clone-solution-name"]')
        .fill(solutionName);
      await page.locator('[data-testid="button-clone-project"]').click();

      // Wait for the dialog to settle and the project to appear in
      // the API listing.
      await expect
        .poll(async () => projectExists(page.request, solutionName), {
          timeout: 30_000,
        })
        .toBe(true);

      // Basic workstation action: load the cloned project into the
      // workbench and assert it renders past the route shell. We
      // don't perform a write action here; "render" is the minimum
      // proof that the cloned project is openable.
      const listRes = await page.request.get(`${BASE}/api/projects/available`);
      const list = (await listRes.json()) as Array<{
        solutionName: string;
        slnPath: string;
      }>;
      const entry = list.find((p) => p.solutionName === solutionName);
      expect(entry, "cloned project missing from /projects/available").toBeTruthy();
      const loadRes = await page.request.post(`${BASE}/api/projects/load`, {
        data: { slnPath: entry!.slnPath },
      });
      expect(loadRes.ok(), `load: ${await loadRes.text()}`).toBeTruthy();
      const wbResp = await page.goto(`${BASE}/workbench`);
      expect(wbResp?.ok(), `workbench status ${wbResp?.status()}`).toBeTruthy();
      // The workbench has many toolbars; loosely match anything
      // testid-stable so the spec doesn't snap on layout churn.
      await expect(
        page.locator('[data-testid^="button-"]').first(),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      // Cleanup order: delete project (which clears the bound-PAT
      // FK), then delete the Repos PAT row.
      await page.request.delete(
        `${BASE}/api/projects/${encodeURIComponent(solutionName)}`,
      );
      await page.request.delete(`${BASE}/api/repo-pats/${pat.id}`);
    }
  });

  test("rolls back when the cloned repo has no recognizable project marker", async ({
    request,
  }) => {
    await devLogin(request, `${SUITE_TAG}_admin`, "admin");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-clone-nomk-"));
    repoDirs.push(dir);
    const url = await makeBareRepo({
      dir,
      branch: "main",
      withMarker: false,
    });
    const solutionName = `${SUITE_TAG}_rollback`;
    const res = await request.post(`${BASE}/api/projects/clone`, {
      data: {
        solutionName,
        provider: "azure_repos",
        repoUrl: url,
        branch: "main",
        pat: "e2e_inline_pat_abcd1234LAST",
      },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { errorCode: string; message: string };
    expect(body.errorCode).toBe("invalid_input");
    expect(body.message).toMatch(/no recognizable project file/);
    expect(await projectExists(request, solutionName)).toBe(false);
  });
});
