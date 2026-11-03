/**
 * Route-level tests covering the branch endpoints and the push-target
 * selection (fork vs upstream) introduced by task #58.
 *
 * - GET /projects/:p/branches    → list + currently checked-out branch
 * - POST /projects/:p/branches   → create + auto-checkout
 * - POST /projects/:p/branches/checkout → switch branches, including the
 *   dirty-working-copy refusal path (errorCode = "dirty_working_copy")
 *   that the UI translates into the confirmation dialog.
 * - POST /projects/:p/git-config/push  → confirms that when the calling
 *   user has a personal fork row, the new commit lands in the fork's
 *   bare repo and *not* in the shared upstream bare repo.
 *
 * Uses local `file://` bare repos for both upstream and fork; the
 * gitConfigService accepts `file://` when APP_ENVIRONMENT is local /
 * development, which vitest globalSetup pins to.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { and, eq, like } from "drizzle-orm";
import {
  db,
  projectGitConfigsTable,
  userProjectForksTable,
  usersTable,
  auditEventsTable,
} from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import { encryptSecret } from "@/shared/crypto";

process.env.PROJECT_SECRETS_KEY ??=
  "vitest-branches-fork-push-secret-xxxxxxxxxxxxxxxx";

const PREFIX = "vitest-branchpush-";
const ADMIN_USERNAME = `${PREFIX}admin`;

let baseUrl = "";
let close: () => Promise<void>;
let adminCookie = "";
let adminUserId = "";
let workspaceTmp = "";
let originalWorkspace = "";

function runCli(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) =>
      resolve({ code: code ?? -1, stdout, stderr }),
    );
  });
}

async function git(args: string[], opts: { cwd?: string } = {}): Promise<void> {
  const r = await runCli("git", args, opts);
  if (r.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (code ${r.code}): ${r.stderr || r.stdout}`,
    );
  }
}

/**
 * Create a bare repo at `<dir>/<name>.git`. When `seed.solutionName` is
 * provided, seed the bare with an initial commit on `branch` containing:
 *   - `.testbuilder.json` marker (required by the pull validator)
 *   - `<solutionName>.sln` so `listAvailableProjects` discovers the
 *     pulled project as a C# solution
 *   - `README.md` and any additional `seed.extra` files.
 * When `seed` is omitted the bare repo is left empty (no commits) — use
 * this for a fork bare that will be pushed to with an unrelated history.
 */
async function makeBareRepo(args: {
  dir: string;
  name: string;
  branch: string;
  seed?: {
    solutionName: string;
    extra?: Record<string, string>;
  };
}): Promise<string> {
  const bare = path.join(args.dir, `${args.name}.git`);
  await fs.mkdir(bare, { recursive: true });
  await git(["init", "--bare", "-b", args.branch, bare]);
  if (!args.seed) return `file://${bare}`;

  const work = path.join(args.dir, `${args.name}-work`);
  await git(["clone", bare, work]);
  await git(["-C", work, "checkout", "-B", args.branch]);
  await fs.writeFile(
    path.join(work, ".testbuilder.json"),
    JSON.stringify({ language: "csharp", solutionName: args.seed.solutionName }),
  );
  // Minimal but discoverable C# solution file so listAvailableProjects()
  // picks up the pulled project by name after a pull.
  await fs.writeFile(
    path.join(work, `${args.seed.solutionName}.sln`),
    `Microsoft Visual Studio Solution File, Format Version 12.00\n`,
  );
  await fs.writeFile(path.join(work, "README.md"), "hi\n");
  for (const [name, content] of Object.entries(args.seed.extra ?? {})) {
    const target = path.join(work, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
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

async function insertUpstreamGitConfig(args: {
  projectName: string;
  repoUrl: string;
  branch: string;
}): Promise<void> {
  const pat = "upstream-pat-token-1234";
  await db
    .delete(projectGitConfigsTable)
    .where(eq(projectGitConfigsTable.projectName, args.projectName));
  await db.insert(projectGitConfigsTable).values({
    projectName: args.projectName,
    provider: "azure_repos",
    repoUrl: args.repoUrl,
    branch: args.branch,
    patEncrypted: encryptSecret(pat),
    patLastFour: pat.slice(-4),
    patSetAt: new Date(),
    updatedByUserId: adminUserId,
  });
}

async function insertUserFork(args: {
  userId: string;
  projectName: string;
  repoUrl: string;
}): Promise<void> {
  const pat = "fork-pat-token-1234";
  await db
    .delete(userProjectForksTable)
    .where(
      and(
        eq(userProjectForksTable.userId, args.userId),
        eq(userProjectForksTable.projectName, args.projectName),
      ),
    );
  await db.insert(userProjectForksTable).values({
    userId: args.userId,
    projectName: args.projectName,
    provider: "azure_repos",
    repoUrl: args.repoUrl,
    patEncrypted: encryptSecret(pat),
    patLastFour: pat.slice(-4),
  });
}

/**
 * Run `git log --oneline` against a bare repo at `bare/branch` and return
 * the commit messages, newest first. Empty array when the branch is absent.
 */
async function bareBranchCommits(
  bareUrl: string,
  branch: string,
): Promise<string[]> {
  const barePath = bareUrl.replace(/^file:\/\//, "");
  const r = await runCli("git", [
    "--git-dir",
    barePath,
    "log",
    "--format=%s",
    branch,
  ]);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function pullProject(projectName: string): Promise<void> {
  const res = await fetch(
    `${baseUrl}/api/projects/${projectName}/git-config/pull`,
    { method: "POST", headers: withCookie(adminCookie) },
  );
  if (res.status !== 200) {
    throw new Error(`pull(${projectName}) failed: ${res.status} ${await res.text()}`);
  }
}

async function makeProjectOnDisk(name: string): Promise<string> {
  const project = await createProject({
    solutionName: name,
    namespace: `${name}.QA`,
  });
  return project.rootPath;
}

beforeAll(async () => {
  // Clean up FK dependents first so the user delete doesn't 23503.
  await db
    .delete(projectGitConfigsTable)
    .where(like(projectGitConfigsTable.projectName, "BrPush%"));
  await db
    .delete(userProjectForksTable)
    .where(like(userProjectForksTable.projectName, "BrPush%"));
  await db
    .delete(auditEventsTable)
    .where(like(auditEventsTable.project, "BrPush%"));
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({ username: ADMIN_USERNAME, role: "admin" });
  adminUserId = admin.id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await close();
}, 30_000);

beforeEach(async () => {
  workspaceTmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-branchpush-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = workspaceTmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(workspaceTmp, { recursive: true, force: true });
  await db
    .delete(projectGitConfigsTable)
    .where(like(projectGitConfigsTable.projectName, "BrPush%"));
  await db
    .delete(userProjectForksTable)
    .where(like(userProjectForksTable.projectName, "BrPush%"));
  await db
    .delete(auditEventsTable)
    .where(like(auditEventsTable.project, "BrPush%"));
});

describe("GET /api/projects/:projectName/branches", () => {
  it("returns hasGitWorkingCopy:false for a freshly-created project without a .git dir", async () => {
    const projectName = "BrPushNoGit";
    await makeProjectOnDisk(projectName);
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hasGitWorkingCopy: boolean;
      current: string | null;
      branches: string[];
    };
    expect(body.hasGitWorkingCopy).toBe(false);
    expect(body.current).toBeNull();
    expect(body.branches).toEqual([]);
  });

  it("after a successful pull, lists the upstream branch and reports it as current", async () => {
    const projectName = "BrPushListed";
    await makeProjectOnDisk(projectName);
    const upstream = await makeBareRepo({
      dir: workspaceTmp,
      name: "upstream",
      branch: "main",
      seed: { solutionName: projectName },
    });
    await insertUpstreamGitConfig({ projectName, repoUrl: upstream, branch: "main" });
    await pullProject(projectName);

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hasGitWorkingCopy: boolean;
      current: string | null;
      branches: string[];
    };
    expect(body.hasGitWorkingCopy).toBe(true);
    expect(body.current).toBe("main");
    expect(body.branches).toContain("main");
  });
});

describe("POST /api/projects/:projectName/branches (create)", () => {
  it("creates a new branch and checks it out by default", async () => {
    const projectName = "BrPushCreate";
    await makeProjectOnDisk(projectName);
    const upstream = await makeBareRepo({
      dir: workspaceTmp,
      name: "upstream",
      branch: "main",
      seed: { solutionName: projectName },
    });
    await insertUpstreamGitConfig({ projectName, repoUrl: upstream, branch: "main" });
    await pullProject(projectName);

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ name: "feature/new" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      current: string | null;
      errorCode: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.errorCode).toBeNull();
    expect(body.current).toBe("feature/new");
  });

  it("with `checkout:false`, creates the branch but leaves the current branch unchanged", async () => {
    const projectName = "BrPushNoCheckout";
    await makeProjectOnDisk(projectName);
    const upstream = await makeBareRepo({
      dir: workspaceTmp,
      name: "upstream",
      branch: "main",
      seed: { solutionName: projectName },
    });
    await insertUpstreamGitConfig({ projectName, repoUrl: upstream, branch: "main" });
    await pullProject(projectName);

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ name: "feature/no-checkout", checkout: false }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      current: string | null;
      errorCode: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.errorCode).toBeNull();
    // Current branch is still `main` — we did not check out the new branch.
    expect(body.current).toBe("main");

    // And the new ref is still visible via GET /branches.
    const list = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches`,
      { headers: withCookie(adminCookie) },
    );
    const listBody = (await list.json()) as { branches: string[] };
    expect(listBody.branches).toContain("feature/no-checkout");
    expect(listBody.branches).toContain("main");
  });

  it("returns ok:false / errorCode=invalid_name for a name git refuses (HTTP 200 by design)", async () => {
    const projectName = "BrPushBadName";
    await makeProjectOnDisk(projectName);
    const upstream = await makeBareRepo({
      dir: workspaceTmp,
      name: "upstream",
      branch: "main",
      seed: { solutionName: projectName },
    });
    await insertUpstreamGitConfig({ projectName, repoUrl: upstream, branch: "main" });
    await pullProject(projectName);

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ name: "bad name with spaces" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; errorCode: string };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("invalid_name");
  });

  it("returns ok:false / errorCode=already_exists when re-creating the current branch", async () => {
    const projectName = "BrPushDup";
    await makeProjectOnDisk(projectName);
    const upstream = await makeBareRepo({
      dir: workspaceTmp,
      name: "upstream",
      branch: "main",
      seed: { solutionName: projectName },
    });
    await insertUpstreamGitConfig({ projectName, repoUrl: upstream, branch: "main" });
    await pullProject(projectName);

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ name: "main" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; errorCode: string };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("already_exists");
  });

  it("returns ok:false / errorCode=no_git_working_copy when the project isn't a git repo yet", async () => {
    const projectName = "BrPushNoRepo";
    await makeProjectOnDisk(projectName);
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ name: "feature/x" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; errorCode: string };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("no_git_working_copy");
  });
});

describe("POST /api/projects/:projectName/branches/checkout", () => {
  it("switches to an existing branch (ok:true, new `current`)", async () => {
    const projectName = "BrPushSwitch";
    const rootPath = await makeProjectOnDisk(projectName);
    const upstream = await makeBareRepo({
      dir: workspaceTmp,
      name: "upstream",
      branch: "main",
      seed: { solutionName: projectName },
    });
    await insertUpstreamGitConfig({ projectName, repoUrl: upstream, branch: "main" });
    await pullProject(projectName);
    // Create the branch first so we can switch back to it.
    await fetch(`${baseUrl}/api/projects/${projectName}/branches`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ name: "feature/x" }),
    });
    // Now go back to main.
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches/checkout`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ name: "main" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      current: string | null;
      errorCode: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.current).toBe("main");
    expect(rootPath).toBeTruthy(); // silence unused-var lint
  });

  it("surfaces errorCode=dirty_working_copy when a switch would overwrite local changes", async () => {
    const projectName = "BrPushDirty";
    const rootPath = await makeProjectOnDisk(projectName);
    const upstream = await makeBareRepo({
      dir: workspaceTmp,
      name: "upstream",
      branch: "main",
      seed: {
        solutionName: projectName,
        extra: { "tracked.txt": "v1\n" },
      },
    });
    await insertUpstreamGitConfig({ projectName, repoUrl: upstream, branch: "main" });
    await pullProject(projectName);
    // Create + switch to a divergent branch whose `tracked.txt` we will
    // then modify in main's working tree to force git to refuse the
    // switch with "would be overwritten".
    await fetch(`${baseUrl}/api/projects/${projectName}/branches`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ name: "feature/divergent" }),
    });
    // Commit a different version of tracked.txt on the feature branch.
    await fs.writeFile(path.join(rootPath, "tracked.txt"), "feature-version\n");
    await git(["-C", rootPath, "add", "tracked.txt"]);
    await git([
      "-C",
      rootPath,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-m",
      "feature change",
    ]);
    // Switch back to main, then dirty the same tracked file *without*
    // committing — this is what triggers git's "would be overwritten"
    // refusal when we try to switch back to feature/divergent.
    await fetch(
      `${baseUrl}/api/projects/${projectName}/branches/checkout`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ name: "main" }),
      },
    );
    await fs.writeFile(path.join(rootPath, "tracked.txt"), "local-uncommitted\n");

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches/checkout`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ name: "feature/divergent" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      errorCode: string;
      current: string | null;
    };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("dirty_working_copy");
    expect(body.current).toBe("main");

    // And with `force: true`, the same call succeeds (discards changes).
    const forced = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches/checkout`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ name: "feature/divergent", force: true }),
      },
    );
    expect(forced.status).toBe(200);
    const forcedBody = (await forced.json()) as { ok: boolean; current: string };
    expect(forcedBody.ok).toBe(true);
    expect(forcedBody.current).toBe("feature/divergent");
  });

  it("returns errorCode=not_found for a branch that doesn't exist", async () => {
    const projectName = "BrPushMissingBr";
    await makeProjectOnDisk(projectName);
    const upstream = await makeBareRepo({
      dir: workspaceTmp,
      name: "upstream",
      branch: "main",
      seed: { solutionName: projectName },
    });
    await insertUpstreamGitConfig({ projectName, repoUrl: upstream, branch: "main" });
    await pullProject(projectName);

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/branches/checkout`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ name: "no-such-branch" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; errorCode: string };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("not_found");
  });
});

describe("Push target selection — fork vs upstream", () => {
  it("with no personal fork configured: the push lands on the upstream bare repo", async () => {
    const projectName = "BrPushUpstream";
    const rootPath = await makeProjectOnDisk(projectName);
    const upstream = await makeBareRepo({
      dir: workspaceTmp,
      name: "upstream",
      branch: "main",
      seed: { solutionName: projectName },
    });
    await insertUpstreamGitConfig({ projectName, repoUrl: upstream, branch: "main" });
    // Pull so the project has a working git tree the push pipeline can
    // operate on.
    await pullProject(projectName);
    // Add a fresh change so the commit is not empty.
    await fs.writeFile(path.join(rootPath, "new.txt"), "upstream-target\n");

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/push`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ commitMessage: "upstream commit" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; nothingToCommit: boolean };
    expect(body.ok).toBe(true);
    expect(body.nothingToCommit).toBe(false);

    const upstreamCommits = await bareBranchCommits(upstream, "main");
    expect(upstreamCommits[0]).toBe("upstream commit");
  });

  it("with a personal fork configured: the push lands on the fork and NOT on the upstream", async () => {
    const projectName = "BrPushFork";
    const rootPath = await makeProjectOnDisk(projectName);
    const upstream = await makeBareRepo({
      dir: workspaceTmp,
      name: "upstream",
      branch: "main",
      seed: { solutionName: projectName },
    });
    // Fork bare shares history with the upstream (clone --bare from
    // the upstream bare) so the local working copy's push fast-forwards
    // cleanly. An unrelated empty bare would either refuse a non-fast
    // forward or reject the shallow pack with "shallow update not
    // allowed" because pullProject uses a shallow clone.
    const forkBarePath = path.join(workspaceTmp, "fork.git");
    await git([
      "clone",
      "--bare",
      upstream.replace(/^file:\/\//, ""),
      forkBarePath,
    ]);
    const fork = `file://${forkBarePath}`;
    await insertUpstreamGitConfig({ projectName, repoUrl: upstream, branch: "main" });
    await insertUserFork({
      userId: adminUserId,
      projectName,
      repoUrl: fork,
    });
    await pullProject(projectName);
    // pullProject does a shallow (depth=1) clone, which the fork bare
    // rejects on push with "shallow update not allowed". Unshallow the
    // local working copy so the push carries the full history.
    await git(["-C", rootPath, "fetch", "--unshallow", "origin"]).catch(
      () => undefined,
    );
    await fs.writeFile(path.join(rootPath, "new.txt"), "fork-target\n");

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/push`,
      {
        method: "POST",
        headers: withCookie(adminCookie, { "content-type": "application/json" }),
        body: JSON.stringify({ commitMessage: "fork commit" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const forkCommits = await bareBranchCommits(fork, "main");
    const upstreamCommits = await bareBranchCommits(upstream, "main");

    // The new commit is on the fork.
    expect(forkCommits[0]).toBe("fork commit");
    // The upstream is untouched — still just the seeded "initial" commit.
    expect(upstreamCommits).not.toContain("fork commit");
    expect(upstreamCommits[0]).toBe("initial");
  });
});
