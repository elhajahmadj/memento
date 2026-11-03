import { describe, it, expect, beforeEach } from "vitest";
import {
  clearCurrentProjectForUser,
  clearCurrentProjectIfSolution,
  currentProjectCacheSize,
  forEachCurrentProject,
  getCurrentProject,
  resetCurrentProjectsForTests,
  setCurrentProject,
} from "@/features/projects/infrastructure/repositories/currentProjectStore";
import type { Project } from "@/features/projects/domain/types";

/**
 * Per-user active-project cache (audit findings M-3 and M-4).
 *
 * M-4: the store falls back to a `"__default__"` key whenever `userId` is
 * nullish — for reads *and* writes. That was reachable in production:
 * `createProject` called `setCurrentProject(project)` with no user, while
 * `sessionStart`, `openBrowserOps` and `hookOps` all fall back to
 * `getCurrentProject()` with no user. One user's project could therefore
 * surface as another user's "current project".
 *
 * The fix is at the writer — `createProject` now threads `ownerUserId`
 * through — so these tests pin the property that matters: a per-user
 * write is never visible to another user, and the shared slot is a
 * separate compartment from every real user's slot.
 *
 * M-3: entries were only dropped on explicit unload, project delete or
 * assignment revocation — never on logout — so the map retained a full
 * `Project` per user who had ever loaded one, for the process lifetime.
 */

function project(name: string): Project {
  return {
    solutionName: name,
    testProjectName: `${name}.Tests`,
    namespace: name,
    rootPath: `/tmp/${name}`,
    slnPath: `/tmp/${name}/${name}.sln`,
    language: "csharp",
  } as Project;
}

const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

beforeEach(() => {
  resetCurrentProjectsForTests();
});

describe("currentProjectStore — per-user isolation (M-4)", () => {
  it("keeps each user's project separate", () => {
    setCurrentProject(project("Alpha"), USER_A);
    setCurrentProject(project("Beta"), USER_B);

    expect(getCurrentProject(USER_A)?.solutionName).toBe("Alpha");
    expect(getCurrentProject(USER_B)?.solutionName).toBe("Beta");
  });

  it("does not expose a per-user project to a no-user read", () => {
    // This is the leak direction that mattered: a real user's project
    // must never be what a userless caller sees.
    setCurrentProject(project("Alpha"), USER_A);

    expect(getCurrentProject(undefined)).toBeNull();
    expect(getCurrentProject(null)).toBeNull();
    expect(getCurrentProject("")).toBeNull();
  });

  it("does not let a no-user write reach any real user's slot", () => {
    setCurrentProject(project("Mine"), USER_A);
    setCurrentProject(project("Injected"), undefined);

    expect(getCurrentProject(USER_A)?.solutionName).toBe("Mine");
    expect(getCurrentProject(USER_B)).toBeNull();
  });

  it("keeps the shared slot in its own compartment", () => {
    setCurrentProject(project("Shared"), undefined);
    setCurrentProject(project("Alpha"), USER_A);

    expect(getCurrentProject(undefined)?.solutionName).toBe("Shared");
    expect(getCurrentProject(USER_A)?.solutionName).toBe("Alpha");
    expect(currentProjectCacheSize()).toBe(2);
  });
});

describe("currentProjectStore — eviction (M-3)", () => {
  it("clears a single user's entry on logout without touching others", () => {
    setCurrentProject(project("Alpha"), USER_A);
    setCurrentProject(project("Beta"), USER_B);

    clearCurrentProjectForUser(USER_A);

    expect(getCurrentProject(USER_A)).toBeNull();
    expect(getCurrentProject(USER_B)?.solutionName).toBe("Beta");
    expect(currentProjectCacheSize()).toBe(1);
  });

  it("is idempotent for a user with no cached project", () => {
    clearCurrentProjectForUser(USER_A);
    expect(currentProjectCacheSize()).toBe(0);
  });

  it("removes the entry when set to null (explicit unload)", () => {
    setCurrentProject(project("Alpha"), USER_A);
    setCurrentProject(null, USER_A);
    expect(currentProjectCacheSize()).toBe(0);
  });

  it("does not grow when the same user reloads a project", () => {
    for (let i = 0; i < 50; i++) {
      setCurrentProject(project(`Alpha${i}`), USER_A);
    }
    expect(currentProjectCacheSize()).toBe(1);
    expect(getCurrentProject(USER_A)?.solutionName).toBe("Alpha49");
  });
});

describe("currentProjectStore — existing behavior preserved", () => {
  it("clearCurrentProjectIfSolution only clears on a name match", () => {
    setCurrentProject(project("Alpha"), USER_A);

    expect(clearCurrentProjectIfSolution(USER_A, "Beta")).toBe(false);
    expect(getCurrentProject(USER_A)?.solutionName).toBe("Alpha");

    expect(clearCurrentProjectIfSolution(USER_A, "Alpha")).toBe(true);
    expect(getCurrentProject(USER_A)).toBeNull();
  });

  it("forEachCurrentProject still yields (userId, project) pairs", () => {
    setCurrentProject(project("Alpha"), USER_A);
    setCurrentProject(project("Beta"), USER_B);

    const seen: Array<[string, string]> = [];
    forEachCurrentProject((key, p) => seen.push([key, p.solutionName]));

    expect(seen.sort()).toEqual([
      [USER_A, "Alpha"],
      [USER_B, "Beta"],
    ]);
  });
});
