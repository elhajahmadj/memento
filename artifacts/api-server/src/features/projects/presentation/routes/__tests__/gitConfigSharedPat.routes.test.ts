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
import { eq, like } from "drizzle-orm";
import {
  db,
  projectGitConfigsTable,
  repoPatsTable,
  usersTable,
  projectOrganizationsTable,
} from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { createRepoPat } from "@/features/repo-pats/infrastructure/repoPatService";
import { decryptSecret } from "@/shared/crypto";

process.env.PROJECT_SECRETS_KEY ??=
  "vitest-gitcfg-sharedpat-secret-xxxxxxxxxx";
// Allow file:// repo URLs to pass validateRepoUrl. Mirrors
// gitConfig.routes.test.ts which depends on the same dev-mode gate.
process.env.APP_ENVIRONMENT ??= "development";

const PREFIX = "vitest-shared-pat-";
const ADMIN = `${PREFIX}admin`;
const NON_ADMIN = `${PREFIX}user`;

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let nonAdminCookie: string;
let adminId = "";
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
    proc.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function git(args: string[], opts: { cwd?: string } = {}): Promise<void> {
  const r = await runCli("git", args, opts);
  if (r.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
}

/**
 * Initialize a bare local repo. When `withMarker=true`, includes
 * `.testbuilder.json` so the clone post-validation accepts it as
 * a memento project (mirrors the helper in gitConfig.routes.test.ts).
 */
async function makeBareRepo(args: {
  dir: string;
  branch: string;
  withMarker: boolean;
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
      JSON.stringify({ language: "csharp" }),
    );
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

async function scrub(): Promise<void> {
  await db
    .delete(projectOrganizationsTable)
    .where(like(projectOrganizationsTable.projectName, `${PREFIX}%`));
  await db
    .delete(projectGitConfigsTable)
    .where(like(projectGitConfigsTable.projectName, `${PREFIX}%`));
  await db.delete(repoPatsTable).where(like(repoPatsTable.name, `${PREFIX}%`));
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
}

beforeAll(async () => {
  await scrub();
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({ username: ADMIN, role: "admin" });
  adminId = admin.id;
  await provisionUser({ username: NON_ADMIN, role: "limited" });
  adminCookie = await login(baseUrl, ADMIN);
  nonAdminCookie = await login(baseUrl, NON_ADMIN);
});

afterAll(async () => {
  await scrub();
  await deleteUserByUsername(ADMIN);
  await deleteUserByUsername(NON_ADMIN);
  await close();
}, 30_000);

beforeEach(async () => {
  workspaceTmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-sharedpat-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = workspaceTmp;
});

afterEach(async () => {
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(workspaceTmp, { recursive: true, force: true });
  await db
    .delete(projectOrganizationsTable)
    .where(like(projectOrganizationsTable.projectName, `${PREFIX}%`));
  await db
    .delete(projectGitConfigsTable)
    .where(like(projectGitConfigsTable.projectName, `${PREFIX}%`));
  await db.delete(repoPatsTable).where(like(repoPatsTable.name, `${PREFIX}%`));
});

async function makeRepoPat(name: string, pat = "shared-pat-abcd1234EFGH") {
  return createRepoPat({
    provider: "azure_repos",
    name: `${PREFIX}${name}`,
    pat,
    userId: adminId,
  });
}

// ---------------------------------------------------------------------------
// PUT /api/projects/:name/git-config — the `existing_pat` branch
// ---------------------------------------------------------------------------

describe("PUT /api/projects/:projectName/git-config (existing_pat)", () => {
  it("binds a new git config to a shared Repo PAT and exposes no PAT fields", async () => {
    const pat = await makeRepoPat("bind");
    const projectName = `${PREFIX}bind-proj`;
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          provider: "existing_pat",
          repoPatId: pat.id,
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
        }),
      },
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      provider: string;
      patLastFour: string | null;
      patSetAt: string | null;
      repoPatId: string | null;
      repoPatName: string | null;
    };
    // The linked PAT's provider is materialized onto the row, and the
    // public shape surfaces the linked PAT's last-four + name (but
    // never patSetAt, since the row itself does not store the PAT).
    expect(body.provider).toBe("azure_repos");
    expect(body.repoPatId).toBe(pat.id);
    expect(body.repoPatName).toBe(pat.name);
    expect(body.patLastFour).toBe(pat.patLastFour);
    expect(body.patSetAt).toBeNull();

    const [row] = await db
      .select()
      .from(projectGitConfigsTable)
      .where(eq(projectGitConfigsTable.projectName, projectName));
    expect(row!.repoPatId).toBe(pat.id);
    expect(row!.patEncrypted).toBeNull();
    expect(row!.patLastFour).toBeNull();
  });

  it("400s when provider=existing_pat but repoPatId is omitted", async () => {
    const projectName = `${PREFIX}no-id`;
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          provider: "existing_pat",
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("400s when the referenced repoPatId does not exist", async () => {
    const projectName = `${PREFIX}missing`;
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          provider: "existing_pat",
          repoPatId: "00000000-0000-0000-0000-000000000000",
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("switches a row from inline PAT → shared PAT, clearing inline fields", async () => {
    const projectName = `${PREFIX}switch`;
    // First: configure inline PAT.
    let res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          provider: "azure_repos",
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
          pat: "inline-pat-aaaa1234XXXX",
        }),
      },
    );
    expect(res.status).toBe(200);

    const pat = await makeRepoPat("switch");
    res = await fetch(`${baseUrl}/api/projects/${projectName}/git-config`, {
      method: "PUT",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        provider: "existing_pat",
        repoPatId: pat.id,
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        branch: "main",
      }),
    });
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(projectGitConfigsTable)
      .where(eq(projectGitConfigsTable.projectName, projectName));
    expect(row!.repoPatId).toBe(pat.id);
    expect(row!.patEncrypted).toBeNull();
    expect(row!.patLastFour).toBeNull();
    expect(row!.patSetAt).toBeNull();
  });

  it("rejects flipping a shared-PAT row back to inline without a new PAT", async () => {
    const projectName = `${PREFIX}flip`;
    const pat = await makeRepoPat("flip");
    // Start with shared PAT.
    let res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          provider: "existing_pat",
          repoPatId: pat.id,
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
        }),
      },
    );
    expect(res.status).toBe(200);

    // Now try inline without a fresh pat — must fail.
    res = await fetch(`${baseUrl}/api/projects/${projectName}/git-config`, {
      method: "PUT",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        branch: "main",
        pat: null,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("400s when both inline `pat` and `repoPatId` are supplied with provider=existing_pat", async () => {
    // The PUT contract is one-source-of-truth: a request that supplies
    // BOTH an inline PAT and a `repoPatId` is ambiguous and must be
    // rejected with 400 rather than silently dropping one. No row may
    // be created or mutated as a side-effect of the rejected request.
    const pat = await makeRepoPat("both", "shared-pat-final1234SHRD");
    const projectName = `${PREFIX}both`;
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config`,
      {
        method: "PUT",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          provider: "existing_pat",
          repoPatId: pat.id,
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
          pat: "inline-should-be-rejected-WXYZ",
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error ?? "").toMatch(/both.*pat.*repoPatId|one source/i);
    const rows = await db
      .select()
      .from(projectGitConfigsTable)
      .where(eq(projectGitConfigsTable.projectName, projectName));
    expect(rows).toHaveLength(0);
  });

  it("getGitConfig returns the linked PAT's provider and last-four for an existing_pat row", async () => {
    // Direct round-trip through getGitConfig (via the GET route) for
    // the repoPatId resolution branch. Mirrors the unit-level
    // `toPublic` mapping: linked provider takes precedence, the
    // public shape never leaks `patSetAt`, and `repoPatName` reflects
    // the Repos PAT row's name.
    const pat = await makeRepoPat("get-shared");
    const projectName = `${PREFIX}get-shared-proj`;
    await fetch(`${baseUrl}/api/projects/${projectName}/git-config`, {
      method: "PUT",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        provider: "existing_pat",
        repoPatId: pat.id,
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        branch: "feature/x",
      }),
    });
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/git-config`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const cfg = (await res.json()) as {
      provider: string;
      repoUrl: string;
      branch: string;
      patSetAt: string | null;
      patLastFour: string | null;
      repoPatId: string | null;
      repoPatName: string | null;
    };
    expect(cfg.provider).toBe("azure_repos");
    expect(cfg.branch).toBe("feature/x");
    expect(cfg.repoPatId).toBe(pat.id);
    expect(cfg.repoPatName).toBe(pat.name);
    expect(cfg.patLastFour).toBe(pat.patLastFour);
    expect(cfg.patSetAt).toBeNull();
  });

  it("rejects non-admin callers on the existing_pat branch", async () => {
    const pat = await makeRepoPat("forbid");
    const res = await fetch(
      `${baseUrl}/api/projects/${PREFIX}forbid-proj/git-config`,
      {
        method: "PUT",
        headers: withCookie(nonAdminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          provider: "existing_pat",
          repoPatId: pat.id,
          repoUrl: "https://dev.azure.com/o/p/_git/r",
          branch: "main",
        }),
      },
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects/clone — both the inline-PAT and existing_pat branches
// ---------------------------------------------------------------------------

describe("POST /api/projects/clone", () => {
  it("rejects non-admin callers", async () => {
    const res = await fetch(`${baseUrl}/api/projects/clone`, {
      method: "POST",
      headers: withCookie(nonAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        solutionName: `${PREFIX}forbid`,
        provider: "azure_repos",
        repoUrl: "file:///tmp/none.git",
        branch: "main",
        pat: "abcdefghij",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("400s on a malformed body", async () => {
    const res = await fetch(`${baseUrl}/api/projects/clone`, {
      method: "POST",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ solutionName: `${PREFIX}bad` }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errorCode: string };
    expect(body.errorCode).toBe("invalid_input");
  });

  it("400s when provider=existing_pat but no repoPatId is supplied", async () => {
    const res = await fetch(`${baseUrl}/api/projects/clone`, {
      method: "POST",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        solutionName: `${PREFIX}no-id`,
        provider: "existing_pat",
        repoUrl: "file:///tmp/none.git",
        branch: "main",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errorCode: string; message: string };
    expect(body.errorCode).toBe("invalid_input");
    expect(body.message).toMatch(/Existing Repo PAT/);
  });

  it("400s when both inline `pat` and `repoPatId` are supplied at the route level", async () => {
    // Mirrors the upsertGitConfig guard but on the clone endpoint:
    // the request payload simultaneously names a Repos PAT row AND
    // supplies a plaintext PAT; the route must reject with 400 and
    // an "invalid_input" code before any git or filesystem work.
    const res = await fetch(`${baseUrl}/api/projects/clone`, {
      method: "POST",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        solutionName: `${PREFIX}both`,
        provider: "existing_pat",
        repoUrl: "file:///tmp/none.git",
        branch: "main",
        pat: "should-not-be-allowed-WITH-id",
        repoPatId: "11111111-1111-1111-1111-111111111111",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errorCode: string; message: string };
    expect(body.errorCode).toBe("invalid_input");
    expect(body.message).toMatch(/both|one source/i);
  });

  it("rolls back when the cloned repo has no recognizable project marker", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "rec-bare-nomk-"));
    try {
      const url = await makeBareRepo({
        dir: repoDir,
        branch: "main",
        withMarker: false,
      });
      const solutionName = `${PREFIX}rollback`;
      const res = await fetch(`${baseUrl}/api/projects/clone`, {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          solutionName,
          provider: "azure_repos",
          repoUrl: url,
          branch: "main",
          pat: "abcdefghij1234XYZ",
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { errorCode: string; message: string };
      expect(body.errorCode).toBe("invalid_input");
      expect(body.message).toMatch(/no recognizable project file/);

      // Directory rolled back.
      await expect(
        fs.access(path.join(workspaceTmp, solutionName)),
      ).rejects.toThrow();
      // Row rolled back.
      const rows = await db
        .select()
        .from(projectGitConfigsTable)
        .where(eq(projectGitConfigsTable.projectName, solutionName));
      expect(rows).toHaveLength(0);
    } finally {
      await fs.rm(repoDir, { recursive: true, force: true });
    }
  });

  it("clones via the inline-PAT branch and writes a project_git_configs row", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "rec-bare-inl-"));
    try {
      const url = await makeBareRepo({
        dir: repoDir,
        branch: "main",
        withMarker: true,
      });
      const solutionName = `${PREFIX}inline`;
      const res = await fetch(`${baseUrl}/api/projects/clone`, {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          solutionName,
          provider: "azure_repos",
          repoUrl: url,
          branch: "main",
          pat: "abcdefghij1234LAST",
        }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      // Project on disk.
      await fs.access(path.join(workspaceTmp, solutionName));
      // DB row uses inline PAT.
      const [row] = await db
        .select()
        .from(projectGitConfigsTable)
        .where(eq(projectGitConfigsTable.projectName, solutionName));
      expect(row).toBeTruthy();
      expect(row!.repoPatId).toBeNull();
      expect(row!.patLastFour).toBe("LAST");
      expect(row!.patEncrypted).not.toBeNull();
      expect(decryptSecret(row!.patEncrypted!)).toBe(
        "abcdefghij1234LAST",
      );
    } finally {
      await fs.rm(repoDir, { recursive: true, force: true });
    }
  });

  it("clones via the existing_pat branch and binds repoPatId on the row", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "rec-bare-shr-"));
    try {
      const url = await makeBareRepo({
        dir: repoDir,
        branch: "main",
        withMarker: true,
      });
      const pat = await makeRepoPat("clone", "shared-pat-1234SHRD");
      const solutionName = `${PREFIX}shared`;
      const res = await fetch(`${baseUrl}/api/projects/clone`, {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          solutionName,
          provider: "existing_pat",
          repoPatId: pat.id,
          repoUrl: url,
          branch: "main",
        }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const [row] = await db
        .select()
        .from(projectGitConfigsTable)
        .where(eq(projectGitConfigsTable.projectName, solutionName));
      expect(row).toBeTruthy();
      expect(row!.repoPatId).toBe(pat.id);
      expect(row!.patEncrypted).toBeNull();
      expect(row!.patLastFour).toBeNull();
      expect(row!.patSetAt).toBeNull();
    } finally {
      await fs.rm(repoDir, { recursive: true, force: true });
    }
  });

  it("409s when a project with the same name already has a git-config row", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "rec-bare-dup-"));
    try {
      const url = await makeBareRepo({
        dir: repoDir,
        branch: "main",
        withMarker: true,
      });
      const solutionName = `${PREFIX}dup`;
      // Pre-seed a colliding row.
      await db.insert(projectGitConfigsTable).values({
        projectName: solutionName,
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        branch: "main",
        patEncrypted: "x".repeat(32),
        patLastFour: "ZZZZ",
        patSetAt: new Date(),
        updatedByUserId: adminId,
      });
      const res = await fetch(`${baseUrl}/api/projects/clone`, {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          solutionName,
          provider: "azure_repos",
          repoUrl: url,
          branch: "main",
          pat: "abcdefghij1234XYZ",
        }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { errorCode: string };
      expect(body.errorCode).toBe("project_exists");
    } finally {
      await fs.rm(repoDir, { recursive: true, force: true });
    }
  });
});
