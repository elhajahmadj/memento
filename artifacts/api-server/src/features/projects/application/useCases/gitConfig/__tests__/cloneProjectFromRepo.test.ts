import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cloneProjectFromRepo,
  type CloneProjectDeps,
} from "@/features/projects/application/useCases/gitConfig/cloneProjectFromRepo";
import type { GitRunResult } from "@/features/projects/infrastructure/git/gitCli";

vi.mock("@/shared/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// `cloneProjectFromRepo` writes a project_git_configs row at the end of
// the happy path; stub the DB to a no-op so the use case test stays a
// pure port test.
vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@workspace/db");
  return {
    ...actual,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
      insert: () => ({ values: async () => undefined }),
      update: () => ({
        set: () => ({ where: async () => undefined }),
      }),
      delete: () => ({ where: async () => undefined }),
    },
  };
});

vi.mock("@/shared/crypto", () => ({
  encryptSecret: (s: string) => `enc(${s})`,
  decryptSecret: (s: string) => (s.startsWith("enc(") ? s.slice(4, -1) : s),
  getProjectSecretsKey: () => Buffer.alloc(32),
}));

function ok(stdout = ""): GitRunResult {
  return { code: 0, stdout, stderr: "" };
}

describe("cloneProjectFromRepo (port-mocked)", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "clone-uc-"));
  });
  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  function deps(over: Partial<CloneProjectDeps>): CloneProjectDeps {
    return {
      runGit: vi.fn().mockResolvedValue(ok()),
      loadLinkedPat: vi.fn().mockResolvedValue(null),
      workspaceDir: () => workspace,
      ...over,
    };
  }

  it("rejects invalid solution names", async () => {
    const r = await cloneProjectFromRepo(
      {
        solutionName: "1bad",
        provider: "github",
        repoUrl: "https://github.com/o/r",
        branch: "main",
        pat: "x",
        repoPatId: null,
        actingUserId: "u",
      },
      deps({}),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
  });

  it("rejects blank branch", async () => {
    const r = await cloneProjectFromRepo(
      {
        solutionName: "Proj",
        provider: "github",
        repoUrl: "https://github.com/o/r",
        branch: "   ",
        pat: "x",
        repoPatId: null,
        actingUserId: "u",
      },
      deps({}),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
  });

  it("rejects when the target directory already exists", async () => {
    await fs.mkdir(path.join(workspace, "Proj"));
    const r = await cloneProjectFromRepo(
      {
        solutionName: "Proj",
        provider: "github",
        repoUrl: "https://github.com/o/r",
        branch: "main",
        pat: "validpattoken",
        repoPatId: null,
        actingUserId: "u",
      },
      deps({}),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("project_exists");
  });

  it("classifies auth failure from the clone runner", async () => {
    const runGit = vi
      .fn()
      .mockResolvedValue({ code: 128, stdout: "", stderr: "fatal: Authentication failed for https://github.com/o/r" });
    const r = await cloneProjectFromRepo(
      {
        solutionName: "Proj",
        provider: "github",
        repoUrl: "https://github.com/o/r",
        branch: "main",
        pat: "validpattoken",
        repoPatId: null,
        actingUserId: "u",
      },
      deps({ runGit }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("auth_failed");
      // Workspace was rolled back.
      await expect(fs.stat(path.join(workspace, "Proj"))).rejects.toThrow();
    }
  });

  it("happy path: clones into workspace and returns rootPath", async () => {
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === "clone") {
        const dest = args[args.length - 1]!;
        await fs.mkdir(path.join(dest, ".git"), { recursive: true });
        await fs.writeFile(path.join(dest, ".testbuilder.json"), "{}");
        return ok();
      }
      return ok();
    });
    const r = await cloneProjectFromRepo(
      {
        solutionName: "Proj",
        provider: "github",
        repoUrl: "https://github.com/o/r",
        branch: "main",
        pat: "validpattoken",
        repoPatId: null,
        actingUserId: "u",
      },
      deps({ runGit }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.solutionName).toBe("Proj");
      expect(r.rootPath).toBe(path.join(workspace, "Proj"));
    }
  });
});
