import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectGitConfig } from "@workspace/db";
import {
  pullProject,
  type PullProjectDeps,
} from "@/features/projects/application/useCases/gitConfig/pullProject";
import type { GitRunResult } from "@/features/projects/infrastructure/git/gitCli";

vi.mock("@/shared/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function ok(stdout = ""): GitRunResult {
  return { code: 0, stdout, stderr: "" };
}
function fail(stderr: string): GitRunResult {
  return { code: 128, stdout: "", stderr };
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

describe("pullProject (port-mocked)", () => {
  let tmp: string;
  let projectDir: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pull-uc-"));
    projectDir = path.join(tmp, PROJECT);
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, ".testbuilder.json"), "{}");
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  function deps(over: Partial<PullProjectDeps>): PullProjectDeps {
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
      ...over,
    };
  }

  it("returns git_failed when no Git config exists", async () => {
    const r = await pullProject(
      PROJECT,
      "u",
      deps({ loadGitConfigRow: vi.fn().mockResolvedValue(undefined) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("git_failed");
  });

  it("returns git_failed when PAT resolution fails", async () => {
    const r = await pullProject(
      PROJECT,
      "u",
      deps({ resolvePatForRow: vi.fn().mockResolvedValue(null) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("git_failed");
  });

  it("returns git_failed when project is not on disk", async () => {
    const r = await pullProject(
      PROJECT,
      "u",
      deps({ listAvailableProjects: vi.fn().mockResolvedValue([]) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("git_failed");
  });

  it("classifies clone auth failures from injected runner", async () => {
    const runGit = vi
      .fn()
      .mockResolvedValue(fail("fatal: Authentication failed for repo"));
    const r = await pullProject(PROJECT, "u", deps({ runGit }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("auth_failed");
  });

  it("classifies missing remote branch as branch_not_found", async () => {
    const runGit = vi
      .fn()
      .mockResolvedValue(fail("fatal: Remote branch nope not found in upstream"));
    const r = await pullProject(PROJECT, "u", deps({ runGit }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("branch_not_found");
  });

  it("happy path: clones, sanitizes remote, swaps in place, returns commit metadata", async () => {
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === "clone") {
        const dest = args[args.length - 1]!;
        await fs.mkdir(path.join(dest, ".git"), { recursive: true });
        await fs.writeFile(path.join(dest, ".testbuilder.json"), "{}");
        await fs.writeFile(path.join(dest, "new.txt"), "NEW");
        return ok();
      }
      if (args[0] === "log") return ok("abc123\nhello\n");
      if (args[0] === "remote") return ok();
      return ok();
    });
    const r = await pullProject(PROJECT, "u", deps({ runGit }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.commitSha).toBe("abc123");
      expect(r.commitMessage).toBe("hello");
      expect(
        await fs.readFile(path.join(projectDir, "new.txt"), "utf8"),
      ).toBe("NEW");
    }
  });
});
