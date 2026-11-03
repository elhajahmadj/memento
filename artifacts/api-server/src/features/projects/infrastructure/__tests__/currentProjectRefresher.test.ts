/**
 * Unit tests for the shared current-project refresh helper.
 *
 * Covers the two entry points that workbench-mutating code paths
 * (JMX stop, JMX clear, any future emitter) lean on to keep the
 * in-memory `currentProjectStore` snapshot consistent with disk:
 *
 *   - `refreshCurrentProjectFromDisk(userId)` — used by the JMX
 *     stop path after `writeJmxFile` appends a new plan.
 *   - `refreshCurrentProjectFromDiskByRoot(rootPath)` — used by the
 *     JMX clearer, which doesn't carry a user id but knows which
 *     project directory it just rewrote.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PROJECT_MARKER_FILE } from "@/features/projects/domain/paths";
import type { Project, ProjectMarker } from "@/features/projects/domain/types";
import {
  getCurrentProject,
  resetCurrentProjectsForTests,
  setCurrentProject,
} from "@/features/projects/infrastructure/repositories/currentProjectStore";
import {
  refreshCurrentProjectFromDisk,
  refreshCurrentProjectFromDiskByRoot,
} from "@/features/projects/infrastructure/repositories/currentProjectRefresher";
import { clearJmxFiles } from "@/features/projects/infrastructure/clearers/jmxClearer";

const SOLUTION = "RefresherFixtureProj";

async function writeMarker(root: string, marker: ProjectMarker) {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, PROJECT_MARKER_FILE),
    JSON.stringify(marker, null, 2),
    "utf8",
  );
}

function jmxProject(root: string, jmxFiles: string[] = []): Project {
  return {
    solutionName: SOLUTION,
    testProjectName: SOLUTION,
    namespace: SOLUTION,
    rootPath: root,
    slnPath: path.join(root, ".jmxproject"),
    language: "jmx",
    jmxFiles,
    targetUrl: "https://example.com",
  };
}

describe("currentProjectRefresher", () => {
  let tmp: string;
  let root: string;

  beforeEach(async () => {
    resetCurrentProjectsForTests();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cur-proj-refresh-"));
    root = path.join(tmp, SOLUTION);
  });

  afterEach(async () => {
    resetCurrentProjectsForTests();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("refreshCurrentProjectFromDisk re-reads marker fields into the cache", async () => {
    await writeMarker(root, {
      architectureId: "jmx",
      testProjectName: SOLUTION,
      namespace: SOLUTION,
      solutionName: SOLUTION,
      language: "jmx",
      targetUrl: "https://updated.example.com",
      bff: true,
      jmxFiles: ["jmx/a.jmx", "jmx/b.jmx"],
    });
    setCurrentProject(jmxProject(root, []), "user-1");

    await refreshCurrentProjectFromDisk("user-1");

    const refreshed = getCurrentProject("user-1");
    expect(refreshed?.jmxFiles).toEqual(["jmx/a.jmx", "jmx/b.jmx"]);
    expect(refreshed?.targetUrl).toBe("https://updated.example.com");
    expect(refreshed?.bff).toBe(true);
    // Identity fields are preserved.
    expect(refreshed?.rootPath).toBe(root);
    expect(refreshed?.solutionName).toBe(SOLUTION);
  });

  it("refreshCurrentProjectFromDisk is a no-op when no project is cached", async () => {
    await expect(
      refreshCurrentProjectFromDisk("unknown-user"),
    ).resolves.toBeUndefined();
    expect(getCurrentProject("unknown-user")).toBeNull();
  });

  it("refreshCurrentProjectFromDiskByRoot refreshes only users at the matching root", async () => {
    const otherRoot = path.join(tmp, "OtherProj");
    await writeMarker(root, {
      architectureId: "jmx",
      testProjectName: SOLUTION,
      namespace: SOLUTION,
      solutionName: SOLUTION,
      language: "jmx",
      targetUrl: "https://example.com",
      jmxFiles: ["jmx/new.jmx"],
    });
    await writeMarker(otherRoot, {
      architectureId: "jmx",
      testProjectName: "Other",
      namespace: "Other",
      solutionName: "Other",
      language: "jmx",
      targetUrl: "https://other.example.com",
      jmxFiles: ["jmx/other.jmx"],
    });

    setCurrentProject(jmxProject(root, []), "user-a");
    setCurrentProject(jmxProject(root, []), "user-b");
    setCurrentProject(
      { ...jmxProject(otherRoot, ["jmx/other.jmx"]), solutionName: "Other" },
      "user-c",
    );

    await refreshCurrentProjectFromDiskByRoot(root);

    expect(getCurrentProject("user-a")?.jmxFiles).toEqual(["jmx/new.jmx"]);
    expect(getCurrentProject("user-b")?.jmxFiles).toEqual(["jmx/new.jmx"]);
    // The other user's cache is untouched — its marker would have
    // looked the same anyway, but the helper must not have iterated it.
    expect(getCurrentProject("user-c")?.solutionName).toBe("Other");
    expect(getCurrentProject("user-c")?.jmxFiles).toEqual(["jmx/other.jmx"]);
  });

  it("clearJmxFiles refreshes the cache so workbench sees the emptied list", async () => {
    await writeMarker(root, {
      architectureId: "jmx",
      testProjectName: SOLUTION,
      namespace: SOLUTION,
      solutionName: SOLUTION,
      language: "jmx",
      targetUrl: "https://example.com",
      jmxFiles: ["jmx/old.jmx"],
    });
    // Create a stray recorded artifact the clearer is supposed to wipe.
    await fs.mkdir(path.join(root, "jmx"), { recursive: true });
    await fs.writeFile(path.join(root, "jmx", "old.jmx"), "<plan/>", "utf8");

    const cached = jmxProject(root, ["jmx/old.jmx"]);
    setCurrentProject(cached, "user-1");

    await clearJmxFiles(cached);

    const refreshed = getCurrentProject("user-1");
    expect(refreshed?.jmxFiles).toEqual([]);
    expect(refreshed?.rootPath).toBe(root);
  });
});
