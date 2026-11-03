import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { and, desc, eq, like, inArray } from "drizzle-orm";
import {
  db,
  auditEventsTable,
  organizationsTable,
  projectGitConfigsTable,
  projectOrganizationsTable,
  userOrganizationsTable,
  usersTable,
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
import { hashPassword } from "@/features/auth/infrastructure/passwordHash";
import { encryptSecret } from "@/shared/crypto";

// Tests stored secrets are encrypted with AES-GCM keyed off this env var.
// Set it before any test imports a service that hits getProjectSecretsKey().
process.env.PROJECT_SECRETS_KEY ??= "vitest-git-config-routes-secret-xxxxxxxxxxxx";

const PREFIX = "vitest-gitcfg-";
const ADMIN_USERNAME = `${PREFIX}admin`;
const NON_ADMIN_USERNAME = `${PREFIX}user`;
const OTHER_ORG_ADMIN_USERNAME = `${PREFIX}other-org-admin`;

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let nonAdminCookie: string;
let adminUserId = "";
let otherOrgAdminUserId = "";
let otherOrgAdminCookie: string;
let orgBId = "";
let workspaceTmp: string;
let originalWorkspace: string;

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
    proc.on("close", (code) =>
      resolve({ code: code ?? -1, stdout, stderr }),
    );
  });
}

async function git(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<void> {
  const r = await runCli("git", args, opts);
  if (r.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${r.stderr || r.stdout}`,
    );
  }
}

/**
 * Initialize a bare repo at `<dir>/bare.git` with an initial commit on the
 * given branch. When `withMarker` is true, includes the `.testbuilder.json`
 * marker so the pull validator accepts it as a memento project.
 */
async function makeBareRepo(args: {
  dir: string;
  branch: string;
  withMarker: boolean;
  /** Optional extra file → contents to commit alongside the marker. */
  extra?: Record<string, string>;
}): Promise<string> {
  const bare = path.join(args.dir, "bare.git");
  await fs.mkdir(bare, { recursive: true });
  await git(["init", "--bare", "-b", args.branch, bare]);
  const work = path.join(args.dir, "work");
  await git(["clone", bare, work]);
  // Make sure the local branch matches the requested name.
  await git(["-C", work, "checkout", "-B", args.branch]);
  if (args.withMarker) {
    await fs.writeFile(
      path.join(work, ".testbuilder.json"),
      JSON.stringify({ language: "csharp" }),
    );
  }
  await fs.writeFile(path.join(work, "README.md"), "hi\n");
  for (const [name, content] of Object.entries(args.extra ?? {})) {
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

/** Insert a git config row directly, bypassing the URL-shape validation
 * in upsertGitConfig so tests can use file:// or local-http URLs. */
async function insertGitConfig(args: {
  projectName: string;
  repoUrl: string;
  branch: string;
  pat?: string;
  provider?: "azure_repos" | "github";
}): Promise<void> {
  const pat = args.pat ?? "test-pat-token-1234";
  await db
    .delete(projectGitConfigsTable)
    .where(eq(projectGitConfigsTable.projectName, args.projectName));
  await db.insert(projectGitConfigsTable).values({
    projectName: args.projectName,
    provider: args.provider ?? "azure_repos",
    repoUrl: args.repoUrl,
    branch: args.branch,
    patEncrypted: encryptSecret(pat),
    patLastFour: pat.slice(-4),
    patSetAt: new Date(),
    updatedByUserId: adminUserId,
  });
}

async function latestAudit(
  projectName: string,
  action: "project_git_pull" | "project_git_push",
) {
  const rows = await db
    .select()
    .from(auditEventsTable)
    .where(
      and(
        eq(auditEventsTable.project, projectName),
        eq(auditEventsTable.action, action),
      ),
    )
    .orderBy(desc(auditEventsTable.createdAt))
    .limit(1);
  return rows[0];
}

async function scrubUsersByPrefix(): Promise<void> {
  const stale = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(like(usersTable.username, `${PREFIX}%`));
  const ids = stale.map((u) => u.id);
  if (ids.length > 0) {
    await db
      .delete(userOrganizationsTable)
      .where(inArray(userOrganizationsTable.userId, ids));
  }
  await db
    .delete(projectOrganizationsTable)
    .where(like(projectOrganizationsTable.projectName, `${PREFIX}%`));
  await db
    .delete(organizationsTable)
    .where(like(organizationsTable.externalKey, `${PREFIX}%`));
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
}

beforeAll(async () => {
  await scrubUsersByPrefix();
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  await provisionUser({ username: NON_ADMIN_USERNAME, role: "limited" });
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  nonAdminCookie = await login(baseUrl, NON_ADMIN_USERNAME);

  // OIDC admin in a different org for org-scope guard tests.
  const [orgB] = await db
    .insert(organizationsTable)
    .values({ externalKey: `${PREFIX}org-b`, displayName: "Org B" })
    .returning();
  orgBId = orgB!.id;
  const passwordHash = await hashPassword("Sup3rSecret!");
  const [otherOrgAdmin] = await db
    .insert(usersTable)
    .values({
      username: OTHER_ORG_ADMIN_USERNAME,
      passwordHash,
      role: "admin",
      profile: {},
      authSource: "oidc",
    })
    .returning();
  otherOrgAdminUserId = otherOrgAdmin!.id;
  await db
    .insert(userOrganizationsTable)
    .values({ userId: otherOrgAdminUserId, organizationId: orgBId });
  otherOrgAdminCookie = await login(baseUrl, OTHER_ORG_ADMIN_USERNAME);
  // Activate Org B in the session.
  await fetch(`${baseUrl}/api/auth/active-org`, {
    method: "POST",
    headers: withCookie(otherOrgAdminCookie, {
      "content-type": "application/json",
    }),
    body: JSON.stringify({ organizationId: orgBId }),
  });
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(NON_ADMIN_USERNAME);
  // OIDC admin needs membership cleanup before user delete.
  if (otherOrgAdminUserId) {
    await db
      .delete(userOrganizationsTable)
      .where(eq(userOrganizationsTable.userId, otherOrgAdminUserId));
  }
  await deleteUserByUsername(OTHER_ORG_ADMIN_USERNAME);
  if (orgBId) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgBId));
  }
  await close();
}, 30_000);

beforeEach(async () => {
  workspaceTmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-gitcfg-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = workspaceTmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(workspaceTmp, { recursive: true, force: true });
  // Wipe git configs between tests so audit-row queries are unambiguous.
  await db
    .delete(projectGitConfigsTable)
    .where(like(projectGitConfigsTable.projectName, "GitCfg%"));
  await db
    .delete(auditEventsTable)
    .where(like(auditEventsTable.project, "GitCfg%"));
  await db
    .delete(projectOrganizationsTable)
    .where(like(projectOrganizationsTable.projectName, "GitCfg%"));
});

async function makeProjectOnDisk(name: string): Promise<string> {
  const project = await createProject({
    solutionName: name,
    namespace: `${name}.QA`,
  });
  return project.rootPath;
}

describe("GET /api/projects/:projectName/git-config", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgUnauth/git-config`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgNonAdmin/git-config`,
      { headers: withCookie(nonAdminCookie) },
    );
    expect(res.status).toBe(403);
  });

  it("returns the empty default config for a project that was never configured", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgNeverSet/git-config`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      provider: string;
      repoUrl: string;
      branch: string;
      patSetAt: string | null;
      patLastFour: string | null;
    };
    expect(body).toMatchObject({
      provider: "azure_repos",
      repoUrl: "",
      branch: "main",
      patSetAt: null,
      patLastFour: null,
    });
  });
});

describe("PUT /api/projects/:projectName/git-config", () => {
  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgPutNonAdmin/git-config`,
      {
        method: "PUT",
        headers: withCookie(nonAdminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
          pat: "abcdefghij",
        }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("round-trips a new azure_repos config and returns only the last 4 of the PAT", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgPutAzure/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          // provider omitted on purpose: defaults to azure_repos.
          repoUrl: "https://dev.azure.com/myorg/myproj/_git/myrepo",
          branch: "feature/x",
          pat: "abcdefghij1234WXYZ",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      provider: string;
      repoUrl: string;
      branch: string;
      patSetAt: string | null;
      patLastFour: string | null;
    };
    expect(body.provider).toBe("azure_repos");
    expect(body.repoUrl).toBe(
      "https://dev.azure.com/myorg/myproj/_git/myrepo",
    );
    expect(body.branch).toBe("feature/x");
    expect(body.patLastFour).toBe("WXYZ");
    expect(body.patSetAt).not.toBeNull();
    // Body must never expose the encrypted PAT or its full plaintext.
    const text = JSON.stringify(body);
    expect(text).not.toContain("abcdefghij1234WXYZ");
    expect(text).not.toContain("patEncrypted");
  });

  it("accepts a github provider URL", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgPutGitHub/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          provider: "github",
          repoUrl: "https://github.com/me/myrepo.git",
          branch: "main",
          pat: "ghpfgh_aaaaaaaa",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string; repoUrl: string };
    expect(body.provider).toBe("github");
    expect(body.repoUrl).toBe("https://github.com/me/myrepo.git");
  });

  it("rejects an azure URL when the host is not an Azure Repos host", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgPutBadHost/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          repoUrl: "https://example.com/o/p/_git/r",
          branch: "main",
          pat: "abcdefghij",
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a github URL when the host is not github.com", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgPutBadGh/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          provider: "github",
          repoUrl: "https://gitlab.com/me/myrepo.git",
          branch: "main",
          pat: "abcdefghij",
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("strips embedded credentials from the repo URL on save", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgPutCreds/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          repoUrl: "https://user:pass@dev.azure.com/o/p/_git/r",
          branch: "main",
          pat: "abcdefghij",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repoUrl: string };
    expect(body.repoUrl).not.toContain("user");
    expect(body.repoUrl).not.toContain("pass");
    expect(body.repoUrl).toBe("https://dev.azure.com/o/p/_git/r");
  });

  it("supports updating without rotating the PAT (pat: null keeps the existing one)", async () => {
    // Initial create.
    const create = await fetch(
      `${baseUrl}/api/projects/GitCfgKeepPat/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
          pat: "originalpat99",
        }),
      },
    );
    expect(create.status).toBe(200);
    const initial = (await create.json()) as {
      patSetAt: string;
      patLastFour: string;
    };
    expect(initial.patLastFour).toBe("at99");

    // Wait 1ms so patSetAt would change if we accidentally rotated.
    await new Promise((r) => setTimeout(r, 5));

    const update = await fetch(
      `${baseUrl}/api/projects/GitCfgKeepPat/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "develop",
          pat: null,
        }),
      },
    );
    expect(update.status).toBe(200);
    const after = (await update.json()) as {
      branch: string;
      patSetAt: string;
      patLastFour: string;
    };
    expect(after.branch).toBe("develop");
    // PAT must be unchanged.
    expect(after.patLastFour).toBe("at99");
    expect(after.patSetAt).toBe(initial.patSetAt);
  });

  it("rejects pat: null on the very first PUT (PAT is required for create)", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgNoPatCreate/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
          pat: null,
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rotates the PAT when a new one is sent on a subsequent PUT", async () => {
    await fetch(`${baseUrl}/api/projects/GitCfgRotate/git-config`, {
      method: "PUT",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        branch: "main",
        pat: "firstpat0001",
      }),
    });
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgRotate/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
          pat: "rotatedpatZZZZ",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { patLastFour: string };
    expect(body.patLastFour).toBe("ZZZZ");
  });
});

describe("POST /api/projects/:projectName/git-config/pull", () => {
  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgPullNonAdmin/git-config/pull`,
      { method: "POST", headers: withCookie(nonAdminCookie) },
    );
    expect(res.status).toBe(403);
  });

  it("succeeds, replaces the project dir, creates a backup, and writes an audit row", async () => {
    const projectName = "GitCfgPullOk";
    const rootPath = await makeProjectOnDisk(projectName);
    const repoUrl = await makeBareRepo({
      dir: workspaceTmp,
      branch: "main",
      withMarker: true,
      extra: { "from-remote.txt": "remote-content" },
    });
    await insertGitConfig({ projectName, repoUrl, branch: "main" });

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/pull`,
      { method: "POST", headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      commitSha: string | null;
      commitMessage: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(body.commitMessage).toBe("initial");

    // Project dir now contains the remote file and not the original sln.
    const remoteFile = await fs.readFile(
      path.join(rootPath, "from-remote.txt"),
      "utf8",
    );
    expect(remoteFile).toBe("remote-content");
    // Backup sibling exists.
    const wsParent = path.dirname(rootPath);
    const baseName = path.basename(rootPath);
    const siblings = await fs.readdir(wsParent);
    expect(siblings.some((s) => s.startsWith(`${baseName}.bak-`))).toBe(true);

    const audit = await latestAudit(projectName, "project_git_pull");
    expect(audit).toBeTruthy();
    expect(audit!.userId).toBe(adminUserId);
    const details = audit!.details as Record<string, unknown>;
    expect(details.commitSha).toBe(body.commitSha);
    expect(details.repoUrl).toBe(repoUrl);
    expect(details.branch).toBe("main");
    expect(details.error).toBeUndefined();
  });

  it("classifies a totally unreachable remote as repo_not_found and writes a failure audit row", async () => {
    // git's stderr for an unreachable file:// path is
    // "fatal: '...' does not appear to be a git repository", which
    // the classifier maps to repo_not_found.
    const projectName = "GitCfgPullMissing";
    await makeProjectOnDisk(projectName);
    await insertGitConfig({
      projectName,
      repoUrl: `file://${workspaceTmp}/no-such-repo.git`,
      branch: "main",
    });
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/pull`,
      { method: "POST", headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      errorCode: string;
    };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("repo_not_found");

    const audit = await latestAudit(projectName, "project_git_pull");
    expect(audit).toBeTruthy();
    expect((audit!.details as Record<string, unknown>).error).toBe(
      "repo_not_found",
    );
  });

  it("returns branch_not_found when the configured branch is missing on the remote", async () => {
    const projectName = "GitCfgPullBranch";
    await makeProjectOnDisk(projectName);
    const repoUrl = await makeBareRepo({
      dir: workspaceTmp,
      branch: "main",
      withMarker: true,
    });
    await insertGitConfig({
      projectName,
      repoUrl,
      branch: "not-a-real-branch",
    });
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/pull`,
      { method: "POST", headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; errorCode: string };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("branch_not_found");
  });

  it("returns not_a_memento_project when the clone has no marker and no matching solution file", async () => {
    const projectName = "GitCfgPullBadShape";
    await makeProjectOnDisk(projectName);
    const repoUrl = await makeBareRepo({
      dir: workspaceTmp,
      branch: "main",
      withMarker: false, // no .testbuilder.json
    });
    await insertGitConfig({ projectName, repoUrl, branch: "main" });
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/pull`,
      { method: "POST", headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; errorCode: string };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("not_a_memento_project");
  });

  it("returns auth_failed when the remote rejects credentials (HTTP 401)", async () => {
    const projectName = "GitCfgPullAuth";
    await makeProjectOnDisk(projectName);
    const server = http.createServer((_req, res) => {
      res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="git"',
        "Content-Type": "text/plain",
      });
      res.end("Authentication failed");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    try {
      const { port } = server.address() as AddressInfo;
      await insertGitConfig({
        projectName,
        repoUrl: `http://127.0.0.1:${port}/repo.git`,
        branch: "main",
      });
      const res = await fetch(
        `${baseUrl}/api/projects/${projectName}/git-config/pull`,
        { method: "POST", headers: withCookie(adminCookie) },
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; errorCode: string };
      expect(body.ok).toBe(false);
      expect(body.errorCode).toBe("auth_failed");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns git_failed when no git config exists for the project", async () => {
    const projectName = "GitCfgPullNoCfg";
    await makeProjectOnDisk(projectName);
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/pull`,
      { method: "POST", headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; errorCode: string };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("git_failed");
  });
});

describe("POST /api/projects/:projectName/git-config/push", () => {
  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgPushNonAdmin/git-config/push`,
      {
        method: "POST",
        headers: withCookie(nonAdminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ commitMessage: "x" }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when commitMessage is missing", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/GitCfgPushBadBody/git-config/push`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
  });

  it("succeeds, advances the bare repo, leaves the project dir untouched, and writes an audit row", async () => {
    const projectName = "GitCfgPushOk";
    const rootPath = await makeProjectOnDisk(projectName);
    const repoUrl = await makeBareRepo({
      dir: workspaceTmp,
      branch: "main",
      withMarker: true,
    });
    await insertGitConfig({ projectName, repoUrl, branch: "main" });

    // Add a new file to the project that should land in the push.
    await fs.writeFile(path.join(rootPath, "new-from-push.txt"), "pushed");

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/push`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ commitMessage: "Add new file" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      commitSha: string | null;
      nothingToCommit: boolean | null;
    };
    expect(body.ok).toBe(true);
    expect(body.nothingToCommit).toBe(false);
    expect(body.commitSha).toMatch(/^[0-9a-f]{40}$/);

    // The bare repo now has our commit at HEAD.
    const bare = repoUrl.replace(/^file:\/\//, "");
    const verify = await runCli("git", [
      "--git-dir",
      bare,
      "log",
      "--pretty=%s",
      "main",
      "-1",
    ]);
    expect(verify.code).toBe(0);
    expect(verify.stdout.trim()).toBe("Add new file");

    // Project dir on disk is untouched (still has its original sln,
    // and no `.git` directory was created in it).
    const projEntries = await fs.readdir(rootPath);
    expect(projEntries.some((e) => e === ".git")).toBe(false);
    expect(projEntries.some((e) => e === `${projectName}.sln`)).toBe(true);

    const audit = await latestAudit(projectName, "project_git_push");
    expect(audit).toBeTruthy();
    expect(audit!.userId).toBe(adminUserId);
    const details = audit!.details as Record<string, unknown>;
    expect(details.commitSha).toBe(body.commitSha);
    expect(details.commitMessage).toBe("Add new file");
    expect(details.nothingToCommit).toBe(false);
    expect(details.error).toBeUndefined();
  });

  it("returns nothingToCommit: true when the working copy already matches the remote", async () => {
    const projectName = "GitCfgPushNoop";
    const rootPath = await makeProjectOnDisk(projectName);
    const repoUrl = await makeBareRepo({
      dir: workspaceTmp,
      branch: "main",
      withMarker: true,
    });
    await insertGitConfig({ projectName, repoUrl, branch: "main" });

    // First push: project differs from remote → commit lands.
    await fs.writeFile(path.join(rootPath, "snapshot.txt"), "v1");
    const first = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/push`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ commitMessage: "Snapshot v1" }),
      },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { nothingToCommit: boolean };
    expect(firstBody.nothingToCommit).toBe(false);

    // Second push without changing anything → nothing to commit.
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/push`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ commitMessage: "No changes" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      commitSha: string | null;
      nothingToCommit: boolean | null;
    };
    expect(body.ok).toBe(true);
    expect(body.nothingToCommit).toBe(true);
    expect(body.commitSha).toBeNull();
  });

  it("maps a missing remote branch to branch_not_found", async () => {
    const projectName = "GitCfgPushBranch";
    await makeProjectOnDisk(projectName);
    const repoUrl = await makeBareRepo({
      dir: workspaceTmp,
      branch: "main",
      withMarker: true,
    });
    await insertGitConfig({
      projectName,
      repoUrl,
      branch: "no-such-branch",
    });
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/push`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ commitMessage: "anything" }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; errorCode: string };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("branch_not_found");
  });

  it("maps a server-side pre-receive hook rejection to push_rejected and writes a failure audit row", async () => {
    // pushProject re-clones the configured branch before pushing, so
    // the local tip always matches the remote — that means a plain
    // non-fast-forward rejection is impossible to provoke without
    // racing the bare repo. A pre-receive hook that always exits
    // non-zero is the realistic equivalent: it stands in for a
    // protected-branch policy on Azure DevOps / GitHub that refuses
    // the push outright.
    const projectName = "GitCfgPushRejected";
    const rootPath = await makeProjectOnDisk(projectName);
    const repoUrl = await makeBareRepo({
      dir: workspaceTmp,
      branch: "main",
      withMarker: true,
    });
    const barePath = repoUrl.replace(/^file:\/\//, "");
    const hookPath = path.join(barePath, "hooks", "pre-receive");
    await fs.writeFile(
      hookPath,
      "#!/bin/sh\necho 'branch is protected' 1>&2\nexit 1\n",
    );
    await fs.chmod(hookPath, 0o755);
    await insertGitConfig({ projectName, repoUrl, branch: "main" });

    // Make sure there *is* something to push so we reach the push step
    // (otherwise pushProject short-circuits with nothingToCommit).
    await fs.writeFile(path.join(rootPath, "rejected.txt"), "hi");

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/push`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ commitMessage: "Should be rejected" }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      errorCode: string;
      message: string;
    };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("push_rejected");
    expect(body.message.toLowerCase()).toContain("rejected");

    // Bare repo did not advance — HEAD still points at "initial".
    const verify = await runCli("git", [
      "--git-dir",
      barePath,
      "log",
      "--pretty=%s",
      "main",
      "-1",
    ]);
    expect(verify.code).toBe(0);
    expect(verify.stdout.trim()).toBe("initial");

    const audit = await latestAudit(projectName, "project_git_push");
    expect(audit).toBeTruthy();
    expect((audit!.details as Record<string, unknown>).error).toBe(
      "push_rejected",
    );
  });

  it("classifies a totally unreachable remote as repo_not_found and writes a failure audit row", async () => {
    // See the matching pull test: git's stderr for an unreachable
    // file:// path ("does not appear to be a git repository") is
    // mapped to repo_not_found.
    const projectName = "GitCfgPushMissing";
    await makeProjectOnDisk(projectName);
    await insertGitConfig({
      projectName,
      repoUrl: `file://${workspaceTmp}/missing.git`,
      branch: "main",
    });
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/push`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ commitMessage: "x" }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; errorCode: string };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("repo_not_found");

    const audit = await latestAudit(projectName, "project_git_push");
    expect(audit).toBeTruthy();
    expect((audit!.details as Record<string, unknown>).error).toBe(
      "repo_not_found",
    );
  });

  it("maps an HTTP 401 from the remote to auth_failed", async () => {
    const projectName = "GitCfgPushAuth";
    await makeProjectOnDisk(projectName);
    const server = http.createServer((_req, res) => {
      res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="git"',
        "Content-Type": "text/plain",
      });
      res.end("Authentication failed");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    try {
      const { port } = server.address() as AddressInfo;
      await insertGitConfig({
        projectName,
        repoUrl: `http://127.0.0.1:${port}/repo.git`,
        branch: "main",
      });
      const res = await fetch(
        `${baseUrl}/api/projects/${projectName}/git-config/push`,
        {
          method: "POST",
          headers: withCookie(adminCookie, {
            "content-type": "application/json",
          }),
          body: JSON.stringify({ commitMessage: "x" }),
        },
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; errorCode: string };
      expect(body.ok).toBe(false);
      expect(body.errorCode).toBe("auth_failed");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns git_failed when no git config exists for the project", async () => {
    const projectName = "GitCfgPushNoCfg";
    await makeProjectOnDisk(projectName);
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/push`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ commitMessage: "x" }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; errorCode: string };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("git_failed");
  });
});

// The implementation deliberately returns 404 (not 403) for projects
// the caller can't see, to avoid leaking project existence across orgs.
describe("Org-scope guard: an admin in a different org cannot reach a project owned by another org", () => {
  // The OIDC admin's session is pinned to Org B (via beforeAll). Any
  // project stamped with an Org A id should be invisible to them. We
  // create a brand-new org A inline so this test is self-contained.
  let orgAId = "";
  const projectName = "GitCfgOrgScope";

  beforeEach(async () => {
    // Project is owned by Org A.
    const [a] = await db
      .insert(organizationsTable)
      .values({
        externalKey: `${PREFIX}org-a-scope-${Date.now()}`,
        displayName: "Org A",
      })
      .returning();
    orgAId = a!.id;
    await makeProjectOnDisk(projectName);
    await db.insert(projectOrganizationsTable).values({
      projectName,
      organizationId: orgAId,
    });
  });

  afterEach(async () => {
    await db
      .delete(projectOrganizationsTable)
      .where(eq(projectOrganizationsTable.projectName, projectName));
    if (orgAId) {
      await db
        .delete(organizationsTable)
        .where(eq(organizationsTable.id, orgAId));
    }
  });

  it("GET /git-config returns 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config`,
      { headers: withCookie(otherOrgAdminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("PUT /git-config returns 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config`,
      {
        method: "PUT",
        headers: withCookie(otherOrgAdminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
          pat: "abcdefghij",
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("POST /git-config/pull returns 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/pull`,
      { method: "POST", headers: withCookie(otherOrgAdminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("POST /git-config/push returns 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config/push`,
      {
        method: "POST",
        headers: withCookie(otherOrgAdminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ commitMessage: "x" }),
      },
    );
    expect(res.status).toBe(404);
  });
});
