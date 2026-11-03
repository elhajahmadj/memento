import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  clearProjectFiles,
  deleteProject,
  listAvailableProjects,
  loadProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import {
  JMX_PROJECT_FILE,
  PROJECT_MARKER_FILE,
} from "@/features/projects/domain/paths";
import type { ProjectMarker } from "@/features/projects/domain/types";

let tmp: string;
let originalWorkspace: string;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readMarker(rootPath: string): Promise<ProjectMarker> {
  const raw = await fs.readFile(
    path.join(rootPath, PROJECT_MARKER_FILE),
    "utf8",
  );
  return JSON.parse(raw) as ProjectMarker;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-jmx-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  setCurrentProject(null);
});

afterEach(async () => {
  recorderConfig.workspaceDir = originalWorkspace;
  setCurrentProject(null);
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("createProject with language=jmx", () => {
  it("scaffolds an on-disk skeleton with the JMX marker file and a JMX-shaped .testbuilder.json", async () => {
    const project = await createProject({
      solutionName: "LoadFlow",
      namespace: "LoadFlow",
      language: "jmx",
      targetUrl: "https://api.example.com",
      jwtAuth: true,
    });

    expect(project.solutionName).toBe("LoadFlow");
    expect(project.language).toBe("jmx");
    expect(project.rootPath).toBe(path.join(tmp, "LoadFlow"));
    expect(project.slnPath).toBe(
      path.join(tmp, "LoadFlow", JMX_PROJECT_FILE),
    );

    expect(await exists(path.join(project.rootPath, JMX_PROJECT_FILE))).toBe(
      true,
    );

    const marker = await readMarker(project.rootPath);
    expect(marker.language).toBe("jmx");
    expect(marker.solutionName).toBe("LoadFlow");
    expect(marker.targetUrl).toBe("https://api.example.com");
    expect(marker.jwtAuth).toBe(true);
    expect(marker.bff).toBe(false);
    expect(marker.jmxFiles).toEqual([]);
  });

  it("defaults jwtAuth to false when omitted", async () => {
    const project = await createProject({
      solutionName: "Smoke",
      namespace: "Smoke",
      language: "jmx",
      targetUrl: "http://localhost:3000",
    });
    const marker = await readMarker(project.rootPath);
    expect(marker.jwtAuth).toBe(false);
    expect(marker.bff).toBe(false);
    expect(marker.targetUrl).toBe("http://localhost:3000");
  });

  it("persists bff=true on the marker and round-trips it through loadProject", async () => {
    const project = await createProject({
      solutionName: "BffApp",
      namespace: "BffApp",
      language: "jmx",
      targetUrl: "https://bff.example.com",
      bff: true,
    });
    const marker = await readMarker(project.rootPath);
    expect(marker.bff).toBe(true);
    expect(project.bff).toBe(true);

    const loaded = await loadProject(project.slnPath);
    expect(loaded.bff).toBe(true);
  });

  it("defaults bff to false when omitted (and the loaded project reflects that)", async () => {
    const project = await createProject({
      solutionName: "NoBff",
      namespace: "NoBff",
      language: "jmx",
      targetUrl: "https://nobff.example.com",
    });
    expect(project.bff).toBe(false);
    const loaded = await loadProject(project.slnPath);
    expect(loaded.bff).toBe(false);
  });

  it("rejects creation when targetUrl is missing", async () => {
    await expect(
      createProject({
        solutionName: "NoUrl",
        namespace: "NoUrl",
        language: "jmx",
      }),
    ).rejects.toThrow(/targetUrl is required/);
  });

  it("rejects creation when targetUrl is not a valid absolute URL", async () => {
    await expect(
      createProject({
        solutionName: "BadUrl",
        namespace: "BadUrl",
        language: "jmx",
        targetUrl: "not-a-url",
      }),
    ).rejects.toThrow(/not a valid absolute URL/);
  });
});

describe("JMX project listing and re-creation", () => {
  it("surfaces JMX projects in listAvailableProjects with the JMX marker as the slnPath", async () => {
    const project = await createProject({
      solutionName: "Listed",
      namespace: "Listed",
      language: "jmx",
      targetUrl: "https://x.test",
    });
    const items = await listAvailableProjects();
    const found = items.find((p) => p.solutionName === "Listed");
    expect(found).toBeTruthy();
    expect(found!.language).toBe("jmx");
    expect(found!.slnPath).toBe(project.slnPath);
  });

  it("loadProject re-detects an existing JMX project from disk", async () => {
    const created = await createProject({
      solutionName: "Reloaded",
      namespace: "Reloaded",
      language: "jmx",
      targetUrl: "https://y.test",
      jwtAuth: true,
    });
    const loaded = await loadProject(created.slnPath);
    expect(loaded.language).toBe("jmx");
    expect(loaded.solutionName).toBe("Reloaded");
  });

  it("clearProjectFiles wipes recorded artifacts but preserves the marker + sentinel, and resets jmxFiles", async () => {
    const project = await createProject({
      solutionName: "Wiped",
      namespace: "Wiped",
      language: "jmx",
      targetUrl: "https://z.test",
    });
    // Simulate emitted artifacts dropped by the recorder / emitter slices.
    await fs.writeFile(path.join(project.rootPath, "events.json"), "[]");
    await fs.mkdir(path.join(project.rootPath, "out"), { recursive: true });
    await fs.writeFile(
      path.join(project.rootPath, "out", "plan.jmx"),
      "<jmeter />",
    );
    // Stamp jmxFiles so we can prove the clearer resets it.
    const markerPath = path.join(project.rootPath, PROJECT_MARKER_FILE);
    const raw = await fs.readFile(markerPath, "utf8");
    const parsed = JSON.parse(raw) as ProjectMarker;
    parsed.jmxFiles = ["out/plan.jmx"];
    await fs.writeFile(markerPath, JSON.stringify(parsed, null, 2));

    await clearProjectFiles(project.slnPath);

    expect(await exists(path.join(project.rootPath, JMX_PROJECT_FILE))).toBe(
      true,
    );
    expect(await exists(markerPath)).toBe(true);
    expect(await exists(path.join(project.rootPath, "events.json"))).toBe(
      false,
    );
    expect(await exists(path.join(project.rootPath, "out"))).toBe(false);

    const after = await readMarker(project.rootPath);
    expect(after.jmxFiles).toEqual([]);
    expect(after.targetUrl).toBe("https://z.test");
  });

  it("delete then re-create the same JMX project name succeeds", async () => {
    const first = await createProject({
      solutionName: "Recycle",
      namespace: "Recycle",
      language: "jmx",
      targetUrl: "https://a.test",
    });
    await deleteProject(first.slnPath);
    expect(await exists(first.rootPath)).toBe(false);

    const second = await createProject({
      solutionName: "Recycle",
      namespace: "Recycle",
      language: "jmx",
      targetUrl: "https://b.test",
      jwtAuth: true,
    });
    const marker = await readMarker(second.rootPath);
    expect(marker.targetUrl).toBe("https://b.test");
    expect(marker.jwtAuth).toBe(true);
  });
});
