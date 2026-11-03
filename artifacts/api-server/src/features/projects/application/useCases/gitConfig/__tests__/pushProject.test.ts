import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectGitConfig } from "@workspace/db";
import {
  pushProject,
  type PushProjectDeps,
} from "@/features/projects/application/useCases/gitConfig/pushProject";
import type { GitRunResult } from "@/features/projects/infrastructure/git/gitCli";

vi.mock("@/shared/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function ok(stdout = ""): GitRunResult {
  return { code: 0, stdout, stderr: "" };
}
function fail(stderr: string, code = 1): GitRunResult {
  return { code, stdout: "", stderr };
}

const PROJECT = "Proj";

function makeCfg(): ProjectGitConfig {
  return {
    projectName: PROJECT,
    provider: "github",
    repoUrl: "https://github.com/o/r",
    branch: "main",
    patEncrypted: "enc(p)",
    patLastFour: "p",
    patSetAt: new Date(),
    repoPatId: null,
    updatedByUserId: "u",
    updatedAt: new Date(),
    createdAt: new Date(),
  } as unknown as ProjectGitConfig;
}

describe("pushProject (port-mocked)", () => {
  let tmp: string;
  let projectDir: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "push-uc-"));
    projectDir = path.join(tmp, PROJECT);
    await fs.mkdir(path.join(projectDir, ".git"), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  function deps(over: Partial<PushProjectDeps>): PushProjectDeps {
    return {
      runGit: vi.fn().mockResolvedValue(ok()),
      loadGitConfigRow: vi.fn().mockResolvedValue(makeCfg()),
      resolvePatForRow: vi
        .fn()
        .mockResolvedValue({ provider: "github", pat: "the-pat" }),
      listAvailableProjects: vi.fn().mockResolvedValue([
        {
          slnPath: path.join(projectDir, `${PROJECT}.sln`),
          solutionName: PROJECT,
          disabled: false,
          language: "csharp",
          solutionType: "playwright",
        },
      ]),
      loadMyForkForPush: vi.fn().mockResolvedValue(null),
      readCurrentBranch: vi.fn().mockResolvedValue("main"),
      ...over,
    };
  }

  it("returns git_failed when commit message is blank", async () => {
    const r = await pushProject(PROJECT, "   ", "u", deps({}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("git_failed");
      expect(r.message).toMatch(/Commit message/);
    }
  });

  it("returns git_failed when there is no config row", async () => {
    const r = await pushProject(
      PROJECT,
      "Commit",
      "u",
      deps({ loadGitConfigRow: vi.fn().mockResolvedValue(undefined) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("git_failed");
      expect(r.message).toMatch(/No Git provider/);
    }
  });

  it("returns git_failed when PAT can't be resolved", async () => {
    const r = await pushProject(
      PROJECT,
      "Commit",
      "u",
      deps({ resolvePatForRow: vi.fn().mockResolvedValue(null) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("git_failed");
      expect(r.message).toMatch(/no PAT available/i);
    }
  });

  it("returns git_failed when project is not on disk", async () => {
    const r = await pushProject(
      PROJECT,
      "Commit",
      "u",
      deps({ listAvailableProjects: vi.fn().mockResolvedValue([]) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("git_failed");
      expect(r.message).toMatch(/Project directory/);
    }
  });

  it("classifies auth failure on push", async () => {
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === "clone") {
        const dest = args[args.length - 1]!;
        await fs.mkdir(path.join(dest, ".git"), { recursive: true });
        return ok();
      }
      if (args[0] === "diff") return fail("", 1); // there are staged changes
      if (args[0] === "push") return fail("fatal: Authentication failed", 128);
      return ok();
    });
    const r = await pushProject(PROJECT, "Commit", "u", deps({ runGit }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("auth_failed");
  });

  it("classifies non-fast-forward push rejection", async () => {
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === "clone") {
        const dest = args[args.length - 1]!;
        await fs.mkdir(path.join(dest, ".git"), { recursive: true });
        return ok();
      }
      if (args[0] === "diff") return fail("", 1);
      if (args[0] === "push")
        return fail("! [rejected] main -> main (non-fast-forward)", 1);
      return ok();
    });
    const r = await pushProject(PROJECT, "Commit", "u", deps({ runGit }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("push_rejected");
  });

  it("happy path: returns commit SHA when push succeeds", async () => {
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === "clone") {
        const dest = args[args.length - 1]!;
        await fs.mkdir(path.join(dest, ".git"), { recursive: true });
        return ok();
      }
      if (args[0] === "diff") return fail("", 1);
      if (args.includes("rev-parse")) return ok("deadbeef\n");
      return ok();
    });
    const r = await pushProject(PROJECT, "Commit", "u", deps({ runGit }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.commitSha).toBe("deadbeef");
      expect(r.nothingToCommit).toBe(false);
    }
  });

  it("returns nothingToCommit when diff --cached is clean", async () => {
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === "clone") {
        const dest = args[args.length - 1]!;
        await fs.mkdir(path.join(dest, ".git"), { recursive: true });
        return ok();
      }
      // diff --cached returns 0 → nothing to commit
      return ok();
    });
    const r = await pushProject(PROJECT, "Commit", "u", deps({ runGit }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.nothingToCommit).toBe(true);
      expect(r.commitSha).toBeNull();
    }
  });
});
