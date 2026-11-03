import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface FakeGitCall {
  args: string[];
  cwd: string | undefined;
  env: NodeJS.ProcessEnv | undefined;
}

interface FakeGitResponse {
  code?: number;
  stdout?: string;
  stderr?: string;
  errorEvent?: Error;
  onCall?: (call: FakeGitCall) => void | Promise<void>;
}

const gitCalls: FakeGitCall[] = [];
const gitResponses: FakeGitResponse[] = [];

function pushResponse(r: FakeGitResponse): void {
  gitResponses.push(r);
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawn: (
      cmd: string,
      args: string[],
      opts: { cwd?: string; env?: NodeJS.ProcessEnv },
    ) => {
      if (cmd !== "git") {
        return actual.spawn(cmd, args, opts);
      }
      const call: FakeGitCall = { args, cwd: opts.cwd, env: opts.env };
      gitCalls.push(call);
      const proc = new FakeChildProcess();
      const response = gitResponses.shift() ?? { code: 0, stdout: "", stderr: "" };
      // Async emit so the consumer's .on() handlers are wired first.
      void Promise.resolve()
        .then(async () => {
          if (response.onCall) await response.onCall(call);
        })
        .then(() => {
          if (response.errorEvent) {
            proc.emit("error", response.errorEvent);
            proc.emit("close", response.code ?? -1);
            return;
          }
          if (response.stdout) proc.stdout.emit("data", Buffer.from(response.stdout));
          if (response.stderr) proc.stderr.emit("data", Buffer.from(response.stderr));
          proc.emit("close", response.code ?? 0);
        });
      return proc as unknown as ReturnType<typeof actual.spawn>;
    },
  };
});

const dbSelectRows: unknown[] = [];
// Sequential override: when non-empty, each db.select(...).limit() call
// shifts one array of rows off the front. Lets a single test stage
// different responses for the cfg read vs. the loadLinkedPat read.
// When empty, the mock falls back to the shared `dbSelectRows`.
const dbSelectQueue: unknown[][] = [];

// db.insert(...).values(...) override. Each call shifts one entry off
// the queue. Entry { throw: Error } makes the insert reject (used to
// exercise the post-clone rollback path); otherwise it resolves.
const dbInsertQueue: Array<{ throw?: Error }> = [];
const dbInsertCalls: unknown[] = [];

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@workspace/db");
  const nextRows = (): unknown[] => {
    if (dbSelectQueue.length > 0) return dbSelectQueue.shift()!;
    return [...dbSelectRows];
  };
  const queryable = {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(nextRows()),
      }),
    }),
  };
  return {
    ...actual,
    db: {
      select: () => queryable,
      insert: () => ({
        values: async (v: unknown) => {
          dbInsertCalls.push(v);
          const next = dbInsertQueue.shift();
          if (next?.throw) throw next.throw;
        },
      }),
    },
  };
});

vi.mock("@/shared/crypto", () => ({
  encryptSecret: (s: string) => `enc(${s})`,
  decryptSecret: (s: string) =>
    s.startsWith("enc(") ? s.slice(4, -1) : s,
  getProjectSecretsKey: () => Buffer.alloc(32),
}));

const listAvailableProjectsMock = vi.fn();

vi.mock("@/features/projects/infrastructure/projectService", () => ({
  listAvailableProjects: () => listAvailableProjectsMock(),
}));

// The shared `dbSelectRows` mock above returns the same row for every
// `db.select()` call. Without this mock, `loadMyForkForPush` would
// reinterpret the project_git_configs row as a user_project_forks
// row and route pushProject through the fork-only `remote set-url`
// branch — which throws off the gitCalls indexes the push tests
// assert on. Default to "no personal fork configured".
vi.mock(
  "@/features/projects/infrastructure/userProjectForkService",
  () => ({
    loadMyForkForPush: vi.fn().mockResolvedValue(null),
  }),
);

vi.mock("@/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Imported AFTER mocks are registered.
const {
  redactPatFromGitOutput,
  classifyGitError,
  classifyPushError,
  injectPatIntoUrl,
  copyTreeInto,
  clearDirExcept,
  pushProject,
  pullProject,
  cloneProjectFromRepo,
  getGitConfig,
} = await import("@/features/projects/infrastructure/gitConfigService");

beforeEach(() => {
  gitCalls.length = 0;
  gitResponses.length = 0;
  dbSelectRows.length = 0;
  dbSelectQueue.length = 0;
  dbInsertQueue.length = 0;
  dbInsertCalls.length = 0;
  listAvailableProjectsMock.mockReset();
});

describe("redactPatFromGitOutput", () => {
  it("replaces literal PAT occurrences with ***", () => {
    const out = redactPatFromGitOutput("token=ghp_secret123 trailing", "ghp_secret123");
    expect(out).toBe("token=*** trailing");
    expect(out).not.toContain("ghp_secret123");
  });

  it("strips https://user:pat@host credentials regardless of pat value", () => {
    const out = redactPatFromGitOutput(
      "fatal: clone https://memento:supersecret@dev.azure.com/org/_git/r failed",
      null,
    );
    expect(out).toBe(
      "fatal: clone https://***@dev.azure.com/org/_git/r failed",
    );
    expect(out).not.toContain("supersecret");
  });

  it("redacts both literal PAT and embedded credential URL together", () => {
    const out = redactPatFromGitOutput(
      "git failed: https://x:abcd1234@github.com/o/r.git ; pat=abcd1234",
      "abcd1234",
    );
    expect(out).not.toContain("abcd1234");
    expect(out).toContain("https://***@github.com/o/r.git");
  });

  it("never leaks the PAT when git itself errored", () => {
    const out = redactPatFromGitOutput(
      "Authentication failed for 'https://memento:abcd1234@dev.azure.com/'",
      "abcd1234",
    );
    expect(out).not.toContain("abcd1234");
    expect(out).not.toContain("memento:");
    expect(out).toContain("https://***@dev.azure.com/");
  });
});

describe("classifyGitError", () => {
  const cases: Array<[string, string]> = [
    ["fatal: Authentication failed", "auth_failed"],
    ["remote: Invalid username or token", "auth_failed"],
    ["fatal: could not read Username for 'https://...'", "auth_failed"],
    ["The requested URL returned error: 401", "auth_failed"],
    ["The requested URL returned error: 403", "auth_failed"],
    ["remote: Repository not found.", "repo_not_found"],
    ["fatal: could not resolve host: dev.azure.com", "repo_not_found"],
    ["The project does not exist", "repo_not_found"],
    ["The requested URL returned error: 404", "repo_not_found"],
    ["fatal: Remote branch foo not found in upstream origin", "branch_not_found"],
    ["fatal: Could not find remote branch foo", "branch_not_found"],
    ["error: src refspec foo not found in upstream", "branch_not_found"],
    ["something else exploded", "git_failed"],
    ["", "git_failed"],
  ];
  it.each(cases)("classifies %j as %s", (stderr, expected) => {
    expect(classifyGitError(stderr)).toBe(expected);
  });
});

describe("classifyPushError", () => {
  const cases: Array<[string, string]> = [
    [
      "! [rejected] main -> main (non-fast-forward)",
      "push_rejected",
    ],
    [
      "! [rejected] main -> main (fetch first)\nUpdates were rejected because the remote contains work that you do not have locally",
      "push_rejected",
    ],
    ["fatal: Authentication failed", "auth_failed"],
    ["The requested URL returned error: 401", "auth_failed"],
    ["remote: Repository not found.", "repo_not_found"],
    ["The requested URL returned error: 404", "repo_not_found"],
    ["error: remote branch missing", "branch_not_found"],
    ["random unrelated git output", "git_failed"],
    [
      "rejected because the tip of your current branch is behind",
      "git_failed",
    ],
  ];
  it.each(cases)("classifies %j as %s", (stderr, expected) => {
    expect(classifyPushError(stderr)).toBe(expected);
  });
});

describe("injectPatIntoUrl", () => {
  it("uses memento:<pat> for Azure Repos URLs", () => {
    const url = injectPatIntoUrl(
      "azure_repos",
      "https://dev.azure.com/org/proj/_git/repo",
      "abcd1234",
    );
    expect(url).toBe(
      "https://memento:abcd1234@dev.azure.com/org/proj/_git/repo",
    );
  });

  it("uses x-access-token:<pat> for GitHub URLs", () => {
    const url = injectPatIntoUrl(
      "github",
      "https://github.com/octo/repo.git",
      "ghp_xyz",
    );
    expect(url).toBe("https://x-access-token:ghp_xyz@github.com/octo/repo.git");
  });

  it("validateRepoUrl strips embedded credentials before storage (azure)", async () => {
    const { validateAzureRepoUrl, validateGitHubRepoUrl } = await import(
      "@/features/projects/infrastructure/gitConfigService"
    );
    expect(
      validateAzureRepoUrl(
        "https://user:pat@dev.azure.com/org/proj/_git/repo",
      ),
    ).toBe("https://dev.azure.com/org/proj/_git/repo");
    expect(
      validateGitHubRepoUrl("https://user:pat@github.com/octo/repo.git"),
    ).toBe("https://github.com/octo/repo.git");
  });
});

describe("filesystem helpers", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "git-fs-helpers-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("copyTreeInto copies hidden files, nested dirs, and symlinks", async () => {
    const src = path.join(tmp, "src");
    const dest = path.join(tmp, "dest");
    await fs.mkdir(src);
    await fs.mkdir(dest);
    await fs.writeFile(path.join(src, ".hidden"), "h");
    await fs.writeFile(path.join(src, "top.txt"), "t");
    await fs.mkdir(path.join(src, "nested", "deeper"), { recursive: true });
    await fs.writeFile(path.join(src, "nested", "deeper", "leaf.txt"), "leaf");
    await fs.symlink("top.txt", path.join(src, "link"));

    await copyTreeInto(src, dest);

    expect(await fs.readFile(path.join(dest, ".hidden"), "utf8")).toBe("h");
    expect(await fs.readFile(path.join(dest, "top.txt"), "utf8")).toBe("t");
    expect(
      await fs.readFile(path.join(dest, "nested", "deeper", "leaf.txt"), "utf8"),
    ).toBe("leaf");
    const lst = await fs.lstat(path.join(dest, "link"));
    expect(lst.isSymbolicLink()).toBe(true);
    expect(await fs.readlink(path.join(dest, "link"))).toBe("top.txt");
  });

  it("copyTreeInto honors top-level skip set", async () => {
    const src = path.join(tmp, "src");
    const dest = path.join(tmp, "dest");
    await fs.mkdir(src);
    await fs.mkdir(dest);
    await fs.mkdir(path.join(src, ".git"));
    await fs.writeFile(path.join(src, ".git", "HEAD"), "ref");
    await fs.writeFile(path.join(src, "keep.txt"), "k");

    await copyTreeInto(src, dest, new Set([".git"]));

    expect(await fs.readFile(path.join(dest, "keep.txt"), "utf8")).toBe("k");
    await expect(fs.access(path.join(dest, ".git"))).rejects.toThrow();
  });

  it("clearDirExcept preserves .git but removes everything else (including symlinks)", async () => {
    const dir = path.join(tmp, "d");
    await fs.mkdir(dir);
    await fs.mkdir(path.join(dir, ".git"));
    await fs.writeFile(path.join(dir, ".git", "HEAD"), "x");
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    await fs.mkdir(path.join(dir, "sub"));
    await fs.writeFile(path.join(dir, "sub", "b.txt"), "b");
    await fs.symlink("a.txt", path.join(dir, "link"));

    await clearDirExcept(dir, new Set([".git"]));

    const remaining = await fs.readdir(dir);
    expect(remaining).toEqual([".git"]);
    expect(await fs.readFile(path.join(dir, ".git", "HEAD"), "utf8")).toBe("x");
  });
});

describe("pushProject", () => {
  let tmp: string;
  let projectDir: string;
  const PROJECT = "TestProj";
  const PAT = "abcd1234secret";

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "git-push-"));
    projectDir = path.join(tmp, PROJECT);
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "marker.txt"), "live-content");

    dbSelectRows.push({
      projectName: PROJECT,
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/org/proj/_git/repo",
      branch: "main",
      patEncrypted: `enc(${PAT})`,
      patLastFour: PAT.slice(-4),
      patSetAt: new Date(),
      updatedByUserId: "u1",
      updatedAt: new Date(),
    });
    listAvailableProjectsMock.mockResolvedValue([
      {
        slnPath: path.join(projectDir, `${PROJECT}.sln`),
        solutionName: PROJECT,
        disabled: false,
        language: "csharp",
        solutionType: "playwright",
      },
    ]);
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns nothingToCommit when staged diff is empty and never mutates the project dir", async () => {
    pushResponse({
      // clone
      code: 0,
      onCall: async (c) => {
        await fs.mkdir(path.join(c.args[c.args.length - 1]!, ".git"), {
          recursive: true,
        });
      },
    });
    pushResponse({ code: 0 }); // add
    pushResponse({ code: 0 }); // diff --cached --quiet => nothing to commit

    const before = await fs.readFile(
      path.join(projectDir, "marker.txt"),
      "utf8",
    );
    const result = await pushProject(PROJECT, "msg", "u1");
    const after = await fs.readFile(
      path.join(projectDir, "marker.txt"),
      "utf8",
    );

    expect(result).toEqual({ ok: true, commitSha: null, nothingToCommit: true });
    expect(after).toBe(before);
    expect(gitCalls[0]!.args[0]).toBe("clone");
    expect(gitCalls[1]!.args).toEqual(["add", "-A"]);
    expect(gitCalls[2]!.args).toEqual(["diff", "--cached", "--quiet"]);
  });

  it("commits with the fixed memento identity and pushes HEAD:<branch>", async () => {
    pushResponse({
      code: 0,
      onCall: async (c) => {
        await fs.mkdir(path.join(c.args[c.args.length - 1]!, ".git"), {
          recursive: true,
        });
      },
    }); // clone
    pushResponse({ code: 0 }); // add
    pushResponse({ code: 1 }); // diff has changes
    pushResponse({ code: 0 }); // commit
    pushResponse({ code: 0 }); // push
    pushResponse({ code: 0, stdout: "deadbeef\n" }); // rev-parse

    const result = await pushProject(PROJECT, "  my msg  ", "u1");
    expect(result).toEqual({
      ok: true,
      commitSha: "deadbeef",
      nothingToCommit: false,
    });

    const cloneCall = gitCalls[0]!;
    expect(cloneCall.args.slice(0, 5)).toEqual([
      "clone",
      "--depth",
      "1",
      "--branch",
      "main",
    ]);
    // PAT is injected into the URL passed to git clone.
    expect(cloneCall.args[5]).toBe(
      `https://memento:${PAT}@dev.azure.com/org/proj/_git/repo`,
    );

    const commitCall = gitCalls[3]!;
    expect(commitCall.args).toEqual([
      "-c",
      "user.name=memento",
      "-c",
      "user.email=memento@local",
      "commit",
      "-m",
      "my msg",
    ]);

    const pushCall = gitCalls[4]!;
    expect(pushCall.args).toEqual(["push", "origin", "HEAD:main"]);
  });

  it("classifies push rejection as push_rejected", async () => {
    pushResponse({
      code: 0,
      onCall: async (c) => {
        await fs.mkdir(path.join(c.args[c.args.length - 1]!, ".git"), {
          recursive: true,
        });
      },
    }); // clone
    pushResponse({ code: 0 }); // add
    pushResponse({ code: 1 }); // diff
    pushResponse({ code: 0 }); // commit
    pushResponse({
      code: 1,
      stderr:
        "! [rejected] main -> main (non-fast-forward)\nhint: Updates were rejected",
    }); // push

    const result = await pushProject(PROJECT, "msg", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("push_rejected");
    }
  });

  it("rejects empty commit message without invoking git", async () => {
    const result = await pushProject(PROJECT, "   ", "u1");
    expect(result.ok).toBe(false);
    expect(gitCalls).toHaveLength(0);
  });
});

describe("pullProject", () => {
  let tmp: string;
  let projectDir: string;
  const PROJECT = "TestProj";
  const PAT = "ghp_pullsecret";

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "git-pull-"));
    projectDir = path.join(tmp, PROJECT);
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, ".testbuilder.json"), "{}");
    await fs.writeFile(path.join(projectDir, "old.txt"), "OLD");

    dbSelectRows.push({
      projectName: PROJECT,
      provider: "github",
      repoUrl: "https://github.com/octo/repo",
      branch: "main",
      patEncrypted: `enc(${PAT})`,
      patLastFour: PAT.slice(-4),
      patSetAt: new Date(),
      updatedByUserId: "u1",
      updatedAt: new Date(),
    });
    listAvailableProjectsMock.mockResolvedValue([
      {
        slnPath: path.join(projectDir, `${PROJECT}.sln`),
        solutionName: PROJECT,
        disabled: false,
        language: "csharp",
        solutionType: "playwright",
      },
    ]);
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writes a <project>.bak-<timestamp> backup and uses the GitHub PAT format", async () => {
    pushResponse({
      code: 0,
      onCall: async (c) => {
        const dest = c.args[c.args.length - 1]!;
        await fs.mkdir(path.join(dest, ".git"), { recursive: true });
        await fs.writeFile(path.join(dest, ".testbuilder.json"), "{}");
        await fs.writeFile(path.join(dest, "new.txt"), "NEW");
      },
    }); // clone
    pushResponse({ code: 0, stdout: "abc123\nfresh commit\n" }); // log

    const result = await pullProject(PROJECT, "u1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commitSha).toBe("abc123");
      expect(result.commitMessage).toBe("fresh commit");
      expect(result.backupPath).not.toBeNull();
      expect(path.basename(result.backupPath!)).toMatch(
        /^TestProj\.bak-/,
      );
      const backupExists = await fs
        .access(result.backupPath!)
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(true);
      // The pulled clone replaced the project dir.
      expect(
        await fs.readFile(path.join(projectDir, "new.txt"), "utf8"),
      ).toBe("NEW");
    }

    const cloneCall = gitCalls[0]!;
    expect(cloneCall.args[5]).toBe(
      `https://x-access-token:${PAT}@github.com/octo/repo`,
    );
  });

  it("classifies clone auth failures as auth_failed", async () => {
    pushResponse({
      code: 128,
      stderr: "fatal: Authentication failed for 'https://github.com/'",
    });
    const result = await pullProject(PROJECT, "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("auth_failed");
  });
});

// ---------------------------------------------------------------------------
// pull/push credential resolution — shared-Repo-PAT (repoPatId) branch.
// Proves that when a project_git_configs row has `repoPatId` set,
// pull/push call `loadLinkedPat`, decrypt the linked PAT's secret, and
// inject THAT into the clone URL (not any inline value from the cfg
// row, which is null in shared mode).
// ---------------------------------------------------------------------------

describe("pullProject / pushProject — repoPatId credential resolution", () => {
  const PROJECT = "SharedPatProj";

  function stageSharedCfgAndPat(linkedPatPlain: string): void {
    // 1st db.select(): project_git_configs row in "shared" mode — no
    // inline patEncrypted, repoPatId pointing at a Repos PAT row.
    dbSelectQueue.push([
      {
        projectName: PROJECT,
        provider: "github",
        repoUrl: "https://github.com/o/r.git",
        branch: "main",
        patEncrypted: null,
        patLastFour: null,
        patSetAt: null,
        repoPatId: "linked-pat-1",
        updatedByUserId: "u",
        updatedAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    // 2nd db.select(): loadLinkedPat returns the repo_pats row whose
    // patEncrypted is the secret that MUST end up in the clone URL.
    dbSelectQueue.push([
      {
        id: "linked-pat-1",
        provider: "github",
        name: "shared-gh",
        patEncrypted: `enc(${linkedPatPlain})`,
        patLastFour: linkedPatPlain.slice(-4),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  }

  it("pullProject: when repoPatId is set, decrypts the linked PAT and injects it into the clone URL", async () => {
    const LINKED = "linked-gh-pat-AAAA1234";
    stageSharedCfgAndPat(LINKED);
    // Make the project look present on disk so we get past the
    // listAvailableProjects check.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "git-pull-shared-"));
    const projectDir = path.join(tmp, PROJECT);
    await fs.mkdir(projectDir);
    listAvailableProjectsMock.mockResolvedValue([
      {
        slnPath: path.join(projectDir, `${PROJECT}.sln`),
        solutionName: PROJECT,
        disabled: false,
        language: "csharp",
        solutionType: "playwright",
      },
    ]);
    // Fail clone deterministically so we don't have to mock the rest
    // of the pull pipeline. The point of this test is what `git clone`
    // is called with, not what happens after.
    pushResponse({
      code: 128,
      stderr: "fatal: Repository not found",
    });

    try {
      const result = await pullProject(PROJECT, "u-1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("repo_not_found");

      const cloneCall = gitCalls.find((c) => c.args[0] === "clone");
      expect(cloneCall, "git clone must have been called").toBeTruthy();
      const url = cloneCall!.args.find((a) => a.startsWith("https://"))!;
      // Linked PAT — NOT any inline value — must be embedded.
      expect(url).toContain(LINKED);
      // For github, `injectPatIntoUrl` uses `x-access-token:<pat>@`.
      expect(url).toContain(`x-access-token:${LINKED}@`);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("pullProject: when repoPatId is set but the linked row is missing, returns git_failed without invoking git", async () => {
    // 1st select returns cfg with repoPatId; 2nd (loadLinkedPat)
    // returns []; resolvePatForRow must short-circuit to null and
    // pullProject must surface a "no PAT available" git_failed
    // WITHOUT making any spawn('git', …) call.
    dbSelectQueue.push([
      {
        projectName: PROJECT,
        provider: "github",
        repoUrl: "https://github.com/o/r.git",
        branch: "main",
        patEncrypted: null,
        patLastFour: null,
        patSetAt: null,
        repoPatId: "missing-pat",
        updatedByUserId: "u",
        updatedAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    dbSelectQueue.push([]);

    const result = await pullProject(PROJECT, "u-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("git_failed");
      expect(result.message).toMatch(/no PAT available/i);
    }
    expect(gitCalls).toHaveLength(0);
  });

  it("pushProject: when repoPatId is set, decrypts the linked PAT and injects it into the upstream clone URL", async () => {
    const LINKED = "linked-push-pat-ZZZZ9999";
    stageSharedCfgAndPat(LINKED);
    // pushProject also calls loadMyForkForPush (another db.select).
    // Stage an empty row set so it treats "no fork" → push to upstream.
    dbSelectQueue.push([]);

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "git-push-shared-"));
    const projectDir = path.join(tmp, PROJECT);
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "marker.txt"), "x");
    listAvailableProjectsMock.mockResolvedValue([
      {
        slnPath: path.join(projectDir, `${PROJECT}.sln`),
        solutionName: PROJECT,
        disabled: false,
        language: "csharp",
        solutionType: "playwright",
      },
    ]);
    // Fail the first git invocation (clone) so we exit the pipeline
    // early — the assertion below only cares what the clone URL was.
    pushResponse({
      code: 128,
      stderr: "fatal: Authentication failed",
    });

    try {
      const result = await pushProject(PROJECT, "msg", "u-1");
      expect(result.ok).toBe(false);
      const cloneCall = gitCalls.find((c) => c.args[0] === "clone");
      expect(cloneCall, "git clone must have been called").toBeTruthy();
      const url = cloneCall!.args.find((a) => a.startsWith("https://"))!;
      expect(url).toContain(LINKED);
      expect(url).toContain(`x-access-token:${LINKED}@`);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// cloneProjectFromRepo — early-return validation branches. These never
// reach the git CLI or filesystem, so the mocks above are enough.
// ---------------------------------------------------------------------------

describe("cloneProjectFromRepo validation branches", () => {
  const base = {
    solutionName: "OkName",
    branch: "main",
    repoUrl: "https://dev.azure.com/o/p/_git/r",
    actingUserId: "u-1",
  };

  it("rejects an empty or syntactically invalid solutionName as invalid_input", async () => {
    const empty = await cloneProjectFromRepo({
      ...base,
      solutionName: "",
      provider: "azure_repos",
      pat: "abcdefghij",
      repoPatId: null,
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe("invalid_input");

    const bad = await cloneProjectFromRepo({
      ...base,
      // Starts with a digit — fails the `^[A-Za-z]...` rule.
      solutionName: "1bad",
      provider: "azure_repos",
      pat: "abcdefghij",
      repoPatId: null,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("invalid_input");
  });

  it("rejects empty branch as invalid_input", async () => {
    const result = await cloneProjectFromRepo({
      ...base,
      branch: "  ",
      provider: "azure_repos",
      pat: "abcdefghij",
      repoPatId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });

  it("rejects existing_pat mode without repoPatId", async () => {
    const result = await cloneProjectFromRepo({
      ...base,
      provider: "existing_pat",
      pat: null,
      repoPatId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_input");
      expect(result.message).toMatch(/Existing Repo PAT/);
    }
  });

  it("rejects supplying both inline `pat` and `repoPatId` as invalid_input", async () => {
    const result = await cloneProjectFromRepo({
      ...base,
      provider: "existing_pat",
      pat: "inline-and-id-WXYZ",
      repoPatId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_input");
      expect(result.message).toMatch(/both|one source/i);
    }
  });

  it("rejects existing_pat mode when the Repos PAT row is not found", async () => {
    // The mocked db.select returns whatever's in dbSelectRows; with []
    // loadLinkedPat resolves to null.
    dbSelectRows.length = 0;
    const result = await cloneProjectFromRepo({
      ...base,
      provider: "existing_pat",
      pat: null,
      repoPatId: "00000000-0000-0000-0000-000000000000",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_input");
      expect(result.message).toMatch(/no longer exists/);
    }
  });

  it("rejects inline mode with a too-short / missing PAT as invalid_input", async () => {
    const result = await cloneProjectFromRepo({
      ...base,
      provider: "azure_repos",
      pat: "short",
      repoPatId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_input");
      expect(result.message).toMatch(/Personal Access Token/);
    }
  });

  it("rejects an unsupported provider as invalid_input", async () => {
    const result = await cloneProjectFromRepo({
      ...base,
      provider: "bitbucket" as never,
      pat: "abcdefghij",
      repoPatId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });

  it("rejects a malformed inline-mode repo URL as invalid_input", async () => {
    const result = await cloneProjectFromRepo({
      ...base,
      // Right shape (PAT ok, provider ok) but URL fails validateRepoUrl.
      repoUrl: "not-a-url",
      provider: "azure_repos",
      pat: "abcdefghij",
      repoPatId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });
});

// ---------------------------------------------------------------------------
// cloneProjectFromRepo — service-layer success + rollback paths.
// Drives the actual filesystem dance (mkdtemp under the recorder
// workspace, git-clone-into-staging, fs.rename into rootPath, db
// insert, finally tmpDir cleanup). The git CLI is mocked: `onCall`
// creates the cloneInto directory with a marker file so the
// rename-into-place step succeeds, the same way a real `git clone`
// would have left the files behind.
// ---------------------------------------------------------------------------

describe("cloneProjectFromRepo success + rollback (service layer)", () => {
  let recorderConfig: { workspaceDir: string };
  const createdRoots: string[] = [];

  beforeEach(async () => {
    ({ recorderConfig } = await import(
      "@/features/projects/infrastructure/config"
    ));
    await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  });

  afterEach(async () => {
    // Best-effort cleanup of any project rootPath the test created or
    // the service rolled back (the workspaceDir itself is shared
    // dev infrastructure — we never remove it).
    for (const r of createdRoots.splice(0)) {
      await fs.rm(r, { recursive: true, force: true });
    }
  });

  function stageSuccessfulClone(markerFiles: Array<{ name: string; content: string }>): void {
    // 1st db.select() — existingRow check returns no row.
    dbSelectQueue.push([]);
    // git clone: create the cloneInto directory + marker so the
    // subsequent fs.rename(cloneInto, rootPath) succeeds.
    pushResponse({
      code: 0,
      onCall: async (c) => {
        const cloneInto = c.args[c.args.length - 1]!;
        await fs.mkdir(cloneInto, { recursive: true });
        await fs.mkdir(path.join(cloneInto, ".git"), { recursive: true });
        for (const f of markerFiles) {
          await fs.writeFile(path.join(cloneInto, f.name), f.content);
        }
      },
    });
  }

  it("happy path: clones, moves into workspaceDir, inserts the inline-PAT git-config row, and reports rootPath", async () => {
    const solutionName = `CloneOk_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const expectedRoot = path.join(recorderConfig.workspaceDir, solutionName);
    createdRoots.push(expectedRoot);
    stageSuccessfulClone([{ name: ".testbuilder.json", content: "{}" }]);
    dbInsertQueue.push({}); // insert succeeds

    const result = await cloneProjectFromRepo({
      solutionName,
      branch: "main",
      repoUrl: "https://dev.azure.com/o/p/_git/r",
      provider: "azure_repos",
      pat: "abcdefghijLAST",
      repoPatId: null,
      actingUserId: "u-1",
    });

    expect(result).toEqual({
      ok: true,
      solutionName,
      rootPath: expectedRoot,
    });

    // Files actually moved into place from the staging area.
    const markerOnDisk = await fs.readFile(
      path.join(expectedRoot, ".testbuilder.json"),
      "utf8",
    );
    expect(markerOnDisk).toBe("{}");
    // .git was stripped before the rename.
    await expect(fs.access(path.join(expectedRoot, ".git"))).rejects.toThrow();

    // The inline-PAT row was inserted with the encrypted PAT and the
    // correct last-four, NOT a repoPatId.
    expect(dbInsertCalls).toHaveLength(1);
    const row = dbInsertCalls[0] as {
      projectName: string;
      provider: string;
      repoUrl: string;
      branch: string;
      patEncrypted: string | null;
      patLastFour: string | null;
      patSetAt: Date | null;
      repoPatId: string | null;
      updatedByUserId: string;
    };
    expect(row.projectName).toBe(solutionName);
    expect(row.provider).toBe("azure_repos");
    expect(row.branch).toBe("main");
    expect(row.repoPatId).toBeNull();
    expect(row.patLastFour).toBe("LAST");
    expect(row.patEncrypted).toBe("enc(abcdefghijLAST)");
    expect(row.patSetAt).toBeInstanceOf(Date);
    expect(row.updatedByUserId).toBe("u-1");

    // The staging directory (mkdtemp'd under workspaceDir with the
    // `.memento-gitclone-…` prefix) is cleaned up by the finally
    // block regardless of outcome.
    const leftovers = (await fs.readdir(recorderConfig.workspaceDir)).filter(
      (n) => n.startsWith(`.memento-gitclone-${solutionName}-`),
    );
    expect(leftovers).toEqual([]);

    // The clone URL handed to `git clone` carried the inline PAT.
    const cloneCall = gitCalls.find((c) => c.args[0] === "clone")!;
    const url = cloneCall.args.find((a) => a.startsWith("https://"))!;
    expect(url).toBe(
      "https://memento:abcdefghijLAST@dev.azure.com/o/p/_git/r",
    );
  });

  it("rollback path: when the DB insert fails after clone, removes the on-disk project directory and returns git_failed", async () => {
    const solutionName = `CloneRollback_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const expectedRoot = path.join(recorderConfig.workspaceDir, solutionName);
    createdRoots.push(expectedRoot);
    stageSuccessfulClone([{ name: ".testbuilder.json", content: "{}" }]);
    // Insert blows up — simulating an FK violation or transient DB
    // error after the clone has already been moved into place.
    dbInsertQueue.push({ throw: new Error("simulated DB insert failure") });

    const result = await cloneProjectFromRepo({
      solutionName,
      branch: "main",
      repoUrl: "https://github.com/o/r.git",
      provider: "github",
      pat: "ghp_abcdefghijROLL",
      repoPatId: null,
      actingUserId: "u-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("git_failed");
      expect(result.message).toMatch(/Failed to save Git configuration/);
    }

    // The rolled-back rootPath MUST be gone from disk (the whole
    // point of the rollback branch — otherwise the next attempt
    // would fail with project_exists on the fs.access check).
    await expect(fs.access(expectedRoot)).rejects.toThrow();

    // The mkdtemp staging directory was also cleaned up by the
    // finally block.
    const leftovers = (await fs.readdir(recorderConfig.workspaceDir)).filter(
      (n) => n.startsWith(`.memento-gitclone-${solutionName}-`),
    );
    expect(leftovers).toEqual([]);

    // The clone WAS attempted — we want to be sure the failure is
    // specifically the DB-insert path, not an earlier short-circuit.
    expect(gitCalls.some((c) => c.args[0] === "clone")).toBe(true);
    expect(dbInsertCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getGitConfig — toPublic mapping for the repoPatId branch. Pure
// unit test against the mocked db.
// ---------------------------------------------------------------------------

describe("getGitConfig", () => {
  it("returns empty defaults when no row exists for the project", async () => {
    dbSelectRows.length = 0;
    const cfg = await getGitConfig("nope");
    expect(cfg).toEqual({
      provider: "azure_repos",
      repoUrl: "",
      branch: "main",
      patSetAt: null,
      patLastFour: null,
      repoPatId: null,
      repoPatName: null,
    });
  });

  it("surfaces the linked PAT's provider, last-four, and name for an existing_pat row", async () => {
    // First db.select() call (load project_git_configs row).
    // Second db.select() call (loadLinkedPat).
    // Our mock returns the same dbSelectRows for both, so we stage a
    // row that doubles as both shapes — that's fine because each
    // consumer only reads the fields it cares about.
    dbSelectRows.length = 0;
    dbSelectRows.push({
      // project_git_configs fields
      projectName: "p1",
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/o/p/_git/r",
      branch: "main",
      patEncrypted: null,
      patLastFour: null,
      patSetAt: null,
      repoPatId: "pat-1",
      updatedByUserId: "u",
      updatedAt: new Date(),
      createdAt: new Date(),
      // repo_pats fields (toPublic reads these via loadLinkedPat)
      id: "pat-1",
      name: "shared-azure",
    });
    const cfg = await getGitConfig("p1");
    expect(cfg.repoPatId).toBe("pat-1");
    expect(cfg.repoPatName).toBe("shared-azure");
    expect(cfg.provider).toBe("azure_repos");
    // The public shape MUST NOT leak patSetAt for the shared branch.
    expect(cfg.patSetAt).toBeNull();
  });

  it("falls back to inline PAT fields when there's no linked Repos PAT row", async () => {
    const now = new Date("2025-01-01T00:00:00.000Z");
    // Two db.select() calls happen. First returns the project row;
    // second (loadLinkedPat) should return [] so toPublic takes the
    // inline-PAT path. Our mock returns the same array for both, so
    // we model "no repoPatId" instead — same effect.
    dbSelectRows.length = 0;
    dbSelectRows.push({
      projectName: "p2",
      provider: "github",
      repoUrl: "https://github.com/o/r.git",
      branch: "main",
      patEncrypted: "enc(abcd1234LAST)",
      patLastFour: "LAST",
      patSetAt: now,
      repoPatId: null,
      updatedByUserId: "u",
      updatedAt: now,
      createdAt: now,
    });
    const cfg = await getGitConfig("p2");
    expect(cfg.provider).toBe("github");
    expect(cfg.repoPatId).toBeNull();
    expect(cfg.repoPatName).toBeNull();
    expect(cfg.patLastFour).toBe("LAST");
    expect(cfg.patSetAt).toBe(now.toISOString());
  });
});
