/**
 * Regression coverage for `ensureDemoProject`.
 *
 * The demo flow used to leave the workbench's Explorer panel stuck on
 * an infinite "Loading…" because `detectProjectInfo` never actually
 * checks that the .sln file exists on disk — so a deleted (or never
 * created) `MementoDemo` directory would silently be re-attached as the
 * "current" project, and the very next `GET /projects/tree` would fail
 * with ENOENT. These tests pin the fix: `ensureDemoProject` must always
 * produce a real on-disk project.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  getCurrentProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import { ensureDemoProject } from "@/features/demo/infrastructure/demoService";
import { provisionUser, deleteUserByUsername } from "@/shared/test-helpers";

let tmp: string;
let originalWorkspace: string;
let USER_ID: string;
const USERNAME = "vitest-demo-svc";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-demo-svc-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  const u = await provisionUser({ username: USERNAME, role: "admin" });
  USER_ID = u.id;
  setCurrentProject(null, USER_ID);
});

afterEach(async () => {
  recorderConfig.workspaceDir = originalWorkspace;
  setCurrentProject(null, USER_ID);
  await deleteUserByUsername(USERNAME);
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("ensureDemoProject", () => {
  it("scaffolds MementoDemo on disk and sets it as the user's current project", async () => {
    const result = await ensureDemoProject({ userId: USER_ID });

    expect(result.project.solutionName).toBe("MementoDemo");
    expect(await exists(result.project.slnPath)).toBe(true);
    expect(await exists(result.project.rootPath)).toBe(true);
    expect(getCurrentProject(USER_ID)?.slnPath).toBe(result.project.slnPath);
    expect(result.seededTestMethods).toEqual([
      "Demo_VisitsHomePageAndAssertsTitle",
      "Demo_RunsAccessibilityAndApiChecks",
    ]);
  });

  it("re-creates the project when the .sln has been deleted out from under it", async () => {
    // First run: scaffold the demo.
    const first = await ensureDemoProject({ userId: USER_ID });
    expect(await exists(first.project.slnPath)).toBe(true);

    // Simulate a stale workspace: someone (or `deleteProject`) wiped the
    // MementoDemo directory while the in-memory `currentProjects` map
    // was cleared too. Before the fix `ensureDemoProject` would happily
    // hand back a Project pointing at the missing directory.
    setCurrentProject(null, USER_ID);
    await fs.rm(first.project.rootPath, { recursive: true, force: true });
    expect(await exists(first.project.slnPath)).toBe(false);

    const second = await ensureDemoProject({ userId: USER_ID });
    expect(await exists(second.project.slnPath)).toBe(true);
    expect(await exists(second.project.rootPath)).toBe(true);
    expect(getCurrentProject(USER_ID)?.slnPath).toBe(second.project.slnPath);
  });

  it("re-attaches to an existing demo project without rebuilding it", async () => {
    const first = await ensureDemoProject({ userId: USER_ID });

    // Drop a sentinel file so we can prove the second call did not wipe
    // and re-scaffold the directory.
    const sentinel = path.join(first.project.rootPath, "user-edit.txt");
    await fs.writeFile(sentinel, "do not delete");

    const second = await ensureDemoProject({ userId: USER_ID });
    expect(second.project.slnPath).toBe(first.project.slnPath);
    expect(await exists(sentinel)).toBe(true);
  });
});
