import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * End-to-end coverage for task #58 — personal forks + branch dropdown.
 *
 * Drives the live api-server + test-builder workflows behind the shared
 * proxy (gated on `E2E_API_BASE_URL`, e.g. `http://localhost:80`).
 *
 * Covers:
 *   1. my-fork API: PAT redaction on save, cross-user isolation,
 *      idempotent delete.
 *   2. branches API: list-shape + invalid_name validation on a project
 *      without a git working copy.
 *   3. Branch dropdown UI is hidden when the project has no .git.
 *   4. Settings → Git Repos UI: fill provider / fork URL / PAT, save,
 *      and assert the form re-renders showing the PAT redacted (only
 *      the last four leak; the plaintext never appears in the DOM).
 *   5. Branch dropdown UI against a real git working copy (bare repo
 *      seeded on local disk, project pulled, then driven through the
 *      UI): open dropdown → create branch via inline prompt → assert
 *      it becomes current → switch back to `main`.
 *   6. Push target selection (live): with a fork configured, a real
 *      push lands on the fork bare repo and not on the upstream bare.
 */
const BASE = process.env.E2E_API_BASE_URL;
const SUITE_TAG = `e2e_fork_${Date.now()}`;

function git(args: string[], cwd?: string): void {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function gitOut(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).toString();
}

/**
 * Create a discoverable bare repo on local disk with a seeded `main`
 * branch containing the marker file the pull validator requires plus
 * a `<solutionName>.sln` so listAvailableProjects picks the pulled
 * project up by name. Returns the `file://` URL of the bare.
 */
function makeBareRepo(args: { solutionName: string; tag: string }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-fork-${args.tag}-`));
  const bare = path.join(root, `${args.solutionName}.git`);
  fs.mkdirSync(bare, { recursive: true });
  git(["init", "--bare", "-b", "main", bare]);

  const work = path.join(root, `${args.solutionName}-work`);
  git(["clone", bare, work]);
  git(["-C", work, "checkout", "-B", "main"]);
  fs.writeFileSync(
    path.join(work, ".testbuilder.json"),
    JSON.stringify({
      language: "csharp",
      solutionName: args.solutionName,
      testProjectName: `${args.solutionName}.Tests`,
      namespace: `${args.solutionName}.QA`,
      solutionType: "playwright",
    }),
  );
  fs.writeFileSync(
    path.join(work, `${args.solutionName}.sln`),
    "Microsoft Visual Studio Solution File, Format Version 12.00\n",
  );
  fs.writeFileSync(path.join(work, "README.md"), "seed\n");
  git(["-C", work, "add", "-A"]);
  git([
    "-C",
    work,
    "-c",
    "user.name=e2e",
    "-c",
    "user.email=e2e@test",
    "commit",
    "-m",
    "initial",
  ]);
  git(["-C", work, "push", "origin", "main"]);
  fs.rmSync(work, { recursive: true, force: true });
  return `file://${bare}`;
}

function bareBranchCommitMessages(bareUrl: string, branch: string): string[] {
  const barePath = bareUrl.replace(/^file:\/\//, "");
  try {
    return gitOut(["log", "--format=%s", branch], barePath)
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

async function devLogin(
  request: APIRequestContext,
  username: string,
  role: "admin" | "limited_admin" | "limited",
): Promise<void> {
  // dev-login expects an `email`; we synthesize one from the username
  // so each suite-tagged user gets a deterministic, unique inbox.
  const email = `${username.toLowerCase()}@e2e.local`;
  const res = await request.get(
    `${BASE}/api/auth/dev-login?email=${encodeURIComponent(email)}&role=${role}`,
  );
  expect(res.ok(), `dev-login(${email},${role}) failed`).toBeTruthy();
}

async function createProject(
  request: APIRequestContext,
  solutionName: string,
): Promise<{ slnPath: string; solutionName: string }> {
  const res = await request.post(`${BASE}/api/projects`, {
    data: {
      solutionName,
      namespace: `${solutionName}.QA`,
      testProjectName: `${solutionName}.Tests`,
    },
  });
  expect(res.ok(), `create ${solutionName}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { slnPath: string; solutionName: string };
}

async function setUpstreamAndPull(
  request: APIRequestContext,
  projectName: string,
  repoUrl: string,
): Promise<void> {
  // Save the upstream config (provider azure_repos is accepted for any
  // https://-style URL; for file:// we use github which has a looser
  // host check, or just rely on the validator allowing local URLs).
  const cfg = await request.put(
    `${BASE}/api/projects/${projectName}/git-config`,
    {
      data: {
        provider: "github",
        repoUrl,
        branch: "main",
        // file:// URLs ignore credentials; the route still requires a
        // non-empty PAT to satisfy its server-side validator, so we
        // send a dummy that meets the >=8-char minimum.
        pat: "dummy-pat-12345678",
      },
    },
  );
  expect(cfg.ok(), `save git-config: ${await cfg.text()}`).toBeTruthy();
  const pull = await request.post(
    `${BASE}/api/projects/${projectName}/git-config/pull`,
  );
  expect(pull.ok(), `pull: ${await pull.text()}`).toBeTruthy();
}

async function seedSession(page: Page): Promise<void> {
  // Same trick the delete-approval / ai-build specs use to bypass the
  // onboarding tour overlay that intercepts pointer events.
  await page.request.put(`${BASE}/api/auth/profile`, {
    data: {
      firstName: "E2E",
      lastName: "Fork",
      title: "QA",
      email: "fork-admin@example.com",
    },
  });
  await page.request.post(`${BASE}/api/users/me/tour-seen`, {
    data: { hasSeenTour: true },
  });
}

test.describe("personal forks + branch dropdown (#58)", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec.",
  );

  const adminUser = `${SUITE_TAG}_admin`;
  const otherUser = `${SUITE_TAG}_other`;

  test("my-fork API: PAT is redacted on save + cross-user isolation + clear is idempotent", async ({
    request,
  }) => {
    await devLogin(request, adminUser, "admin");
    const project = await createProject(request, `E2E_Fork_${Date.now()}`);

    const empty = await request.get(
      `${BASE}/api/projects/${project.solutionName}/my-fork`,
    );
    expect(empty.status()).toBe(200);
    expect(((await empty.json()) as { configured: boolean }).configured).toBe(
      false,
    );

    const pat = "personal-pat-1234-WXYZ";
    const put = await request.put(
      `${BASE}/api/projects/${project.solutionName}/my-fork`,
      {
        data: {
          provider: "azure_repos",
          repoUrl: "https://dev.azure.com/me/myproj/_git/myfork",
          pat,
        },
      },
    );
    expect(put.status()).toBe(200);
    const putBody = (await put.json()) as {
      configured: boolean;
      provider: string;
      repoUrl: string;
      patLastFour: string;
      patSetAt: string;
    };
    expect(putBody.configured).toBe(true);
    expect(putBody.provider).toBe("azure_repos");
    expect(putBody.repoUrl).toBe("https://dev.azure.com/me/myproj/_git/myfork");
    expect(putBody.patLastFour).toBe("WXYZ");
    const putText = JSON.stringify(putBody);
    expect(putText).not.toContain(pat);
    expect(putText).not.toContain("patEncrypted");

    await devLogin(request, otherUser, "admin");
    const otherView = await request.get(
      `${BASE}/api/projects/${project.solutionName}/my-fork`,
    );
    const otherBody = (await otherView.json()) as { configured: boolean };
    expect(otherBody.configured).toBe(false);

    await devLogin(request, adminUser, "admin");
    const del = await request.delete(
      `${BASE}/api/projects/${project.solutionName}/my-fork`,
    );
    expect(del.status()).toBe(204);
    const cleared = await request.get(
      `${BASE}/api/projects/${project.solutionName}/my-fork`,
    );
    expect(((await cleared.json()) as { configured: boolean }).configured).toBe(
      false,
    );

    const del2 = await request.delete(
      `${BASE}/api/projects/${project.solutionName}/my-fork`,
    );
    expect(del2.status()).toBe(204);
  });

  test("branches API: list shape, invalid_name validation, no-git working copy", async ({
    request,
  }) => {
    await devLogin(request, adminUser, "admin");
    const project = await createProject(
      request,
      `E2E_Branches_${Date.now()}`,
    );

    const list = await request.get(
      `${BASE}/api/projects/${project.solutionName}/branches`,
    );
    expect(list.status()).toBe(200);
    const listBody = (await list.json()) as {
      hasGitWorkingCopy: boolean;
      current: string | null;
      branches: string[];
    };
    expect(listBody.hasGitWorkingCopy).toBe(false);
    expect(listBody.current).toBeNull();
    expect(Array.isArray(listBody.branches)).toBe(true);

    const invalid = await request.post(
      `${BASE}/api/projects/${project.solutionName}/branches`,
      { data: { name: "bad name with spaces" } },
    );
    expect(invalid.status()).toBe(200);
    const invalidBody = (await invalid.json()) as {
      ok: boolean;
      errorCode: string;
    };
    expect(invalidBody.ok).toBe(false);
    expect([
      "no_git_working_copy",
      "invalid_name",
    ]).toContain(invalidBody.errorCode);
  });

  test("branch dropdown UI is hidden for a project with no git working copy", async ({
    page,
  }) => {
    await devLogin(page.request, adminUser, "admin");
    await seedSession(page);
    const project = await createProject(
      page.request,
      `E2E_NoGit_${Date.now()}`,
    );
    const load = await page.request.post(`${BASE}/api/projects/load`, {
      data: { slnPath: project.slnPath },
    });
    expect(load.ok(), `load: ${await load.text()}`).toBeTruthy();

    await page.goto(`${BASE}/workbench`);
    await expect(page.getByTestId("button-branch-dropdown")).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test("Settings → Git Repos UI: save personal fork, PAT is redacted in the rendered form (never leaks plaintext)", async ({
    page,
  }) => {
    await devLogin(page.request, adminUser, "admin");
    await seedSession(page);
    const projectName = `E2E_ForkUI_${Date.now()}`;
    await createProject(page.request, projectName);

    await page.goto(`${BASE}/admin#git-repos`);

    // The per-project row exposes an "Edit"/"Configure" button that
    // opens a dialog hosting MyForkSection.
    const editBtn = page.getByTestId(`button-git-repos-edit-${projectName}`);
    await editBtn.waitFor({ state: "visible", timeout: 15_000 });
    await editBtn.click();

    const section = page.getByTestId(`section-my-fork-${projectName}`);
    await expect(section).toBeVisible({ timeout: 10_000 });

    // Fill the form: provider + URL + PAT.
    await section
      .getByTestId(`select-my-fork-provider-${projectName}`)
      .click();
    await page.getByRole("option", { name: "GitHub" }).click();
    await section.getByTestId(`input-my-fork-url-${projectName}`).fill(
      "https://github.com/me/myfork.git",
    );
    const pat = "ui-flow-pat-ABCD1234EFGH";
    await section
      .getByTestId(`input-my-fork-pat-${projectName}`)
      .fill(pat);

    await section
      .getByTestId(`button-my-fork-save-${projectName}`)
      .click();

    // After save the form re-renders with `configured: true`. The PAT
    // input collapses to a "Replace" button (proves the plaintext was
    // not echoed back), and the URL is preserved.
    await expect(
      section.getByTestId(`button-my-fork-replace-pat-${projectName}`),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      section.getByTestId(`input-my-fork-url-${projectName}`),
    ).toHaveValue("https://github.com/me/myfork.git");

    // Hard assertion: the plaintext PAT must not be present anywhere
    // in the rendered DOM after save.
    const dom = await page.content();
    expect(dom).not.toContain(pat);

    // And the server side echoes only `patLastFour`.
    const verify = await page.request.get(
      `${BASE}/api/projects/${projectName}/my-fork`,
    );
    const verifyBody = (await verify.json()) as {
      configured: boolean;
      patLastFour: string;
    };
    expect(verifyBody.configured).toBe(true);
    expect(verifyBody.patLastFour).toBe("EFGH");
    expect(JSON.stringify(verifyBody)).not.toContain(pat);
  });

  test("Workbench UI: create branch via inline prompt, switch to it, switch back to main", async ({
    page,
  }) => {
    await devLogin(page.request, adminUser, "admin");
    await seedSession(page);
    const projectName = `E2E_BrUI_${Date.now()}`;
    await createProject(page.request, projectName);

    // Seed a real upstream bare repo on disk and pull so the project
    // has a `.git` working copy the dropdown can drive.
    const upstream = makeBareRepo({ solutionName: projectName, tag: "ui" });
    await setUpstreamAndPull(page.request, projectName, upstream);

    // Load the project as the current workbench project.
    const project = await page.request
      .get(`${BASE}/api/projects/available`)
      .then((r) => r.json() as Promise<Array<{
        solutionName: string;
        slnPath: string;
      }>>)
      .then((list) => list.find((p) => p.solutionName === projectName)!);
    await page.request.post(`${BASE}/api/projects/load`, {
      data: { slnPath: project.slnPath },
    });

    await page.goto(`${BASE}/workbench`);

    const trigger = page.getByTestId("button-branch-dropdown");
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    // The trigger label reflects the current branch — `main` right
    // after pull.
    await expect(trigger).toContainText("main");

    // Open dropdown, click "Create new branch…", type a name, submit.
    await trigger.click();
    await page.getByTestId("button-open-create-branch").click();
    const branchName = "feature/ui-created";
    await page.getByTestId("input-branch-name").fill(branchName);
    await page.getByTestId("button-submit-create-branch").click();

    // After create+checkout the dropdown trigger shows the new branch.
    await expect(trigger).toContainText(branchName, { timeout: 10_000 });

    // Switch back to main through the dropdown. The BranchDropdown
    // uses Radix in non-modal mode so the body's pointer-events lock
    // is gone the moment the menu closes — one click is enough to
    // reopen.
    await trigger.click();
    await expect(page.getByTestId("branch-dropdown-menu")).toBeVisible();
    await page.getByTestId("branch-dropdown-item-main").click();
    await expect(trigger).toContainText("main", { timeout: 10_000 });

    // And the server agrees.
    const list = await page.request.get(
      `${BASE}/api/projects/${projectName}/branches`,
    );
    const listBody = (await list.json()) as {
      hasGitWorkingCopy: boolean;
      current: string | null;
      branches: string[];
    };
    expect(listBody.hasGitWorkingCopy).toBe(true);
    expect(listBody.current).toBe("main");
    expect(listBody.branches).toEqual(
      expect.arrayContaining(["main", branchName]),
    );
  });

  test("Push target via UI: create branch in workbench, then Push from admin dialog lands on fork bare on the new branch (not main, not upstream); then clear fork via UI reverts the section to unconfigured", async ({
    page,
  }) => {
    // This spec runs three full UI flows back-to-back (workbench
    // branch create, admin fork config + push, admin clear fork);
    // 30s isn't enough on slower runners.
    test.setTimeout(120_000);
    await devLogin(page.request, adminUser, "admin");
    await seedSession(page);
    const projectName = `E2E_Push_${Date.now()}`;
    await createProject(page.request, projectName);

    const upstream = makeBareRepo({ solutionName: projectName, tag: "push-up" });
    // Fork bare shares history with upstream so the (possibly
    // shallow) local push fast-forwards cleanly.
    const forkBarePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "e2e-fork-push-fork-")),
      "fork.git",
    );
    fs.mkdirSync(forkBarePath, { recursive: true });
    git([
      "clone",
      "--bare",
      upstream.replace(/^file:\/\//, ""),
      forkBarePath,
    ]);
    const fork = `file://${forkBarePath}`;

    await setUpstreamAndPull(page.request, projectName, upstream);

    // Load as current so the workbench shows the branch dropdown.
    const project = await page.request
      .get(`${BASE}/api/projects/available`)
      .then((r) => r.json() as Promise<Array<{
        solutionName: string;
        slnPath: string;
      }>>)
      .then((list) => list.find((p) => p.solutionName === projectName)!);
    await page.request.post(`${BASE}/api/projects/load`, {
      data: { slnPath: project.slnPath },
    });
    const rootPath = path.dirname(project.slnPath);

    // --- Workbench UI: create + switch to a new branch via dropdown.
    await page.goto(`${BASE}/workbench`);
    const trigger = page.getByTestId("button-branch-dropdown");
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    await page.getByTestId("button-open-create-branch").click();
    const branchName = "feature/ui-pushed";
    await page.getByTestId("input-branch-name").fill(branchName);
    await page.getByTestId("button-submit-create-branch").click();
    await expect(trigger).toContainText(branchName, { timeout: 10_000 });

    // Add a working-copy change so the push has something to commit.
    fs.writeFileSync(path.join(rootPath, "ui-new.txt"), "fork-target\n");

    // --- Admin UI: configure fork via the same MyForkSection dialog
    // the Settings UI exposes, then drive Push from the toolbar.
    await page.goto(`${BASE}/admin#git-repos`);
    await page
      .getByTestId(`button-git-repos-edit-${projectName}`)
      .first()
      .click();
    const forkSection = page.getByTestId(`section-my-fork-${projectName}`);
    await expect(forkSection).toBeVisible({ timeout: 10_000 });
    await forkSection
      .getByTestId(`select-my-fork-provider-${projectName}`)
      .click();
    await page.getByRole("option", { name: "GitHub" }).click();
    await forkSection
      .getByTestId(`input-my-fork-url-${projectName}`)
      .fill(fork);
    await forkSection
      .getByTestId(`input-my-fork-pat-${projectName}`)
      .fill("fork-push-pat-XYZA");
    await forkSection
      .getByTestId(`button-my-fork-save-${projectName}`)
      .click();
    await expect(
      forkSection.getByTestId(`button-my-fork-replace-pat-${projectName}`),
    ).toBeVisible({ timeout: 10_000 });

    // Watch the outgoing push request so we can assert the UI Push
    // action — not a hand-crafted page.request — hit the server.
    const pushReqPromise = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        req.url().endsWith(`/api/projects/${projectName}/git-config/push`),
    );

    // Close the fork dialog, click "Push", fill commit message,
    // confirm — this is the real toolbar action a user takes.
    await page.keyboard.press("Escape");
    await page
      .getByTestId(`button-git-repos-push-${projectName}`)
      .first()
      .click();
    const commit = "fork ui commit via UI";
    await page
      .getByTestId(`input-git-repos-commit-message-${projectName}`)
      .fill(commit);
    const [pushReq, pushRes] = await Promise.all([
      pushReqPromise,
      page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/projects/${projectName}/git-config/push`) &&
          r.request().method() === "POST",
      ),
      page
        .getByTestId(`button-git-repos-confirm-push-${projectName}`)
        .click(),
    ]);
    expect(pushReq.postDataJSON()).toMatchObject({ commitMessage: commit });
    expect(pushRes.status(), `push: ${await pushRes.text()}`).toBe(200);

    // Observable server behavior: the new commit lands on the fork
    // bare, on the new branch (not main), and never on upstream.
    const forkOnBranch = bareBranchCommitMessages(fork, branchName);
    const forkOnMain = bareBranchCommitMessages(fork, "main");
    const upstreamOnBranch = bareBranchCommitMessages(upstream, branchName);
    const upstreamOnMain = bareBranchCommitMessages(upstream, "main");
    expect(forkOnBranch[0]).toBe(commit);
    expect(forkOnMain).not.toContain(commit);
    expect(upstreamOnBranch).not.toContain(commit);
    expect(upstreamOnMain).not.toContain(commit);

    // --- UI Clear fork: open the dialog again, click "Clear fork",
    // and assert the section snaps back to the unconfigured shape
    // (URL empty, PAT input visible, no Replace button) and that the
    // server agrees via GET /my-fork.
    await page
      .getByTestId(`button-git-repos-edit-${projectName}`)
      .first()
      .click();
    await expect(forkSection).toBeVisible({ timeout: 10_000 });
    await forkSection
      .getByTestId(`button-my-fork-clear-${projectName}`)
      .click();
    await expect(
      forkSection.getByTestId(`button-my-fork-replace-pat-${projectName}`),
    ).toHaveCount(0, { timeout: 10_000 });
    await expect(
      forkSection.getByTestId(`input-my-fork-pat-${projectName}`),
    ).toBeVisible();
    await expect(
      forkSection.getByTestId(`input-my-fork-url-${projectName}`),
    ).toHaveValue("");
    const afterClear = await page.request
      .get(`${BASE}/api/projects/${projectName}/my-fork`)
      .then((r) => r.json() as Promise<{
        configured: boolean;
        patLastFour: string | null;
      }>);
    expect(afterClear.configured).toBe(false);
    expect(afterClear.patLastFour).toBeNull();
  });
});
