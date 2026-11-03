import { describe, expect, it, vi } from "vitest";
import {
  listBranches,
  createBranch,
  checkoutBranch,
  type BranchOpsDeps,
} from "@/features/projects/application/useCases/gitConfig/branchOperations";
import type { GitRunResult } from "@/features/projects/infrastructure/git/gitCli";

function ok(stdout = ""): GitRunResult {
  return { code: 0, stdout, stderr: "" };
}
function fail(stderr: string): GitRunResult {
  return { code: 1, stdout: "", stderr };
}

const PROJECT = "P";
const SLN = "/ws/P/P.sln";

function makeDeps(overrides: Partial<BranchOpsDeps> = {}): BranchOpsDeps {
  return {
    runGit: vi.fn().mockResolvedValue(ok()),
    listAvailableProjects: vi.fn().mockResolvedValue([
      { slnPath: SLN, solutionName: PROJECT, disabled: false, language: "csharp", solutionType: "playwright" },
    ]),
    hasGitDir: vi.fn().mockResolvedValue(true),
    readCurrentBranch: vi.fn().mockResolvedValue("main"),
    ...overrides,
  };
}

describe("listBranches (port-mocked)", () => {
  it("returns no_git when the project has no working copy", async () => {
    const deps = makeDeps({ hasGitDir: vi.fn().mockResolvedValue(false) });
    const r = await listBranches(PROJECT, deps);
    expect(r).toEqual({ hasGitWorkingCopy: false, current: null, branches: [] });
  });

  it("returns no_git when the project is not on disk", async () => {
    const deps = makeDeps({ listAvailableProjects: vi.fn().mockResolvedValue([]) });
    const r = await listBranches(PROJECT, deps);
    expect(r.hasGitWorkingCopy).toBe(false);
  });

  it("parses the for-each-ref output into a branch list", async () => {
    const deps = makeDeps({
      runGit: vi.fn().mockResolvedValue(ok("main\nfeature/x\n\n")),
      readCurrentBranch: vi.fn().mockResolvedValue("main"),
    });
    const r = await listBranches(PROJECT, deps);
    expect(r).toEqual({
      hasGitWorkingCopy: true,
      current: "main",
      branches: ["main", "feature/x"],
    });
  });
});

describe("createBranch (port-mocked)", () => {
  it("rejects names with invalid characters", async () => {
    const r = await createBranch(PROJECT, "bad name", {}, makeDeps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_name");
  });

  it("rejects when the branch already exists locally", async () => {
    // show-ref returns 0 => already exists.
    const runGit = vi.fn().mockResolvedValue(ok());
    const r = await createBranch(PROJECT, "feature", {}, makeDeps({ runGit }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("already_exists");
  });

  it("creates and checks out by default", async () => {
    const calls: string[][] = [];
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      calls.push(args);
      // show-ref → not found (code 1), then checkout -b → 0
      if (args[0] === "show-ref") return fail("");
      return ok();
    });
    const r = await createBranch(PROJECT, "feature", {}, makeDeps({ runGit }));
    expect(r.ok).toBe(true);
    expect(calls.some((a) => a[0] === "checkout" && a[1] === "-b")).toBe(true);
  });

  it("returns no_git_working_copy when project has no .git", async () => {
    const r = await createBranch(
      PROJECT,
      "feature",
      {},
      makeDeps({ hasGitDir: vi.fn().mockResolvedValue(false) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("no_git_working_copy");
  });
});

describe("checkoutBranch (port-mocked)", () => {
  it("returns not_found when show-ref fails", async () => {
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === "show-ref") return fail("");
      return ok();
    });
    const r = await checkoutBranch(PROJECT, "missing", {}, makeDeps({ runGit }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_found");
  });

  it("maps git's overwrite refusal to dirty_working_copy", async () => {
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === "show-ref") return ok();
      if (args[0] === "checkout")
        return fail(
          "error: Your local changes to the following files would be overwritten by checkout",
        );
      return ok();
    });
    const r = await checkoutBranch(PROJECT, "x", {}, makeDeps({ runGit }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("dirty_working_copy");
  });

  it("succeeds on a clean checkout", async () => {
    const runGit = vi.fn().mockResolvedValue(ok());
    const r = await checkoutBranch(PROJECT, "x", {}, makeDeps({ runGit }));
    expect(r.ok).toBe(true);
  });
});
