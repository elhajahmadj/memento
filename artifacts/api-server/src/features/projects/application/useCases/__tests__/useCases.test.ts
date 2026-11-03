import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import type { ProjectRepository } from "@/features/projects/domain/ports/projectRepository";
import type {
  Project,
  ProjectListing,
  ProjectMarker,
  TreeNode,
} from "@/features/projects/domain/types";
import { makeLoadProject } from "../loadProject";
import { makeDetectProjectInfo } from "../detectProjectInfo";
import { makeListAvailableProjects } from "../listAvailableProjects";
import { makeDeleteProject } from "../deleteProject";
import { makeSetProjectDisabled } from "../setProjectDisabled";
import { makeCreateProject } from "../createProject";
import {
  forEachCurrentProject,
  deleteCurrentProjectByKey,
  setCurrentProject,
} from "@/features/projects/infrastructure/repositories/currentProjectStore";

function stubRepo(overrides: Partial<ProjectRepository> = {}): ProjectRepository {
  const base: ProjectRepository = {
    readMarker: async () => null,
    writeMarker: async () => {},
    isDisabled: async () => false,
    setDisabled: async () => {},
    deleteProjectDir: async () => {},
    assertExists: async () => {},
    listAvailableProjects: async () => [],
    buildTree: async (rootPath): Promise<TreeNode> => ({
      name: path.basename(rootPath),
      path: ".",
      type: "folder",
      children: [],
    }),
    listTestClasses: async () => [],
    listApiBaseUrls: async () => [],
    detectLegacyCsharpNamespace: async (_root, solutionName) => solutionName,
    readMarkerLanguage: async () => null,
  };
  return { ...base, ...overrides };
}

describe("loadProject use case (port-mocked)", () => {
  it("rejects paths outside the workspace as validation errors", async () => {
    const repo = stubRepo({
      assertExists: vi.fn(async () => {}),
    });
    const loadProject = makeLoadProject({ repo });
    const result = await loadProject("/etc/passwd");
    expect(result.kind).toBe("err");
    if (result.kind === "err") {
      expect(result.error.kind).toBe("validation");
    }
  });

  it("returns not_found when the sln file is missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-uc-"));
    const original = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
    try {
      const repo = stubRepo({
        assertExists: vi.fn(async () => {
          throw new Error("ENOENT");
        }),
      });
      const loadProject = makeLoadProject({ repo });
      const result = await loadProject(path.join(tmp, "Acme", "Acme.sln"));
      expect(result.kind).toBe("err");
      if (result.kind === "err") {
        expect(result.error.kind).toBe("not_found");
      }
    } finally {
      recorderConfig.workspaceDir = original;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns a project assembled from the marker on success", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-uc-"));
    const original = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
    try {
      const marker: ProjectMarker = {
        architectureId: "default",
        testProjectName: "Acme.Tests",
        namespace: "Acme.QA",
        solutionName: "Acme",
        language: "csharp",
        solutionType: "playwright",
      };
      const repo = stubRepo({
        assertExists: vi.fn(async () => {}),
        readMarker: vi.fn(async () => marker),
      });
      const loadProject = makeLoadProject({ repo });
      const slnPath = path.join(tmp, "Acme", "Acme.sln");
      const result = await loadProject(slnPath);
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.value.solutionName).toBe("Acme");
        expect(result.value.namespace).toBe("Acme.QA");
        expect(result.value.language).toBe("csharp");
        expect(result.value.solutionType).toBe("playwright");
      }
    } finally {
      recorderConfig.workspaceDir = original;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("detectProjectInfo use case (port-mocked)", () => {
  it("falls back to per-language defaults when no marker is present", async () => {
    const repo = stubRepo({ readMarker: async () => null });
    const detect = makeDetectProjectInfo({ repo });
    const slnPath = "/tmp/MyApp/pyproject.toml";
    const result = await detect(slnPath);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.language).toBe("python");
      expect(result.value.solutionName).toBe("MyApp");
      expect(result.value.solutionType).toBe("playwright");
    }
  });

  it("uses the marker namespace/language when present", async () => {
    const marker: ProjectMarker = {
      architectureId: "py-default",
      testProjectName: "myapp_tests",
      namespace: "myapp",
      solutionName: "MyApp",
      language: "python",
      solutionType: "api",
    };
    const repo = stubRepo({ readMarker: async () => marker });
    const detect = makeDetectProjectInfo({ repo });
    const result = await detect("/tmp/MyApp/pyproject.toml");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.solutionType).toBe("api");
      expect(result.value.namespace).toBe("myapp");
    }
  });
});

describe("listAvailableProjects use case (port-mocked)", () => {
  it("returns the repository listing wrapped in ok()", async () => {
    const listing: ProjectListing[] = [
      {
        slnPath: "/ws/A/A.sln",
        solutionName: "A",
        disabled: false,
        language: "csharp",
        solutionType: "playwright",
      },
    ];
    const repo = stubRepo({ listAvailableProjects: async () => listing });
    const list = makeListAvailableProjects({ repo });
    const result = await list();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.value).toEqual(listing);
  });
});

describe("setProjectDisabled use case (port-mocked)", () => {
  it("delegates to the repository and returns the resolved listing entry", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-uc-"));
    const original = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
    try {
      const dir = path.join(tmp, "Acme");
      await fs.mkdir(dir, { recursive: true });
      const slnPath = path.join(dir, "Acme.sln");
      const setDisabled = vi.fn(async () => {});
      const repo = stubRepo({
        assertExists: async () => {},
        setDisabled,
        readMarker: async () => null,
      });
      const exec = makeSetProjectDisabled({ repo });
      const result = await exec(slnPath, true);
      expect(setDisabled).toHaveBeenCalledWith(dir, true);
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.value.solutionName).toBe("Acme");
        expect(result.value.disabled).toBe(true);
      }
    } finally {
      recorderConfig.workspaceDir = original;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("deleteProject use case (port-mocked)", () => {
  it("calls repo.deleteProjectDir and clears any matching cached current project", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-uc-"));
    const original = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
    try {
      const dir = path.join(tmp, "Acme");
      await fs.mkdir(dir, { recursive: true });
      const slnPath = path.join(dir, "Acme.sln");
      // Cache a current project for two distinct users — only the
      // matching one should be cleared.
      const cached: Project = {
        solutionName: "Acme",
        testProjectName: "Acme.Tests",
        namespace: "Acme",
        rootPath: dir,
        slnPath,
        language: "csharp",
        solutionType: "playwright",
      };
      setCurrentProject(cached, "alice");
      const other: Project = { ...cached, slnPath: "/ws/Other/Other.sln" };
      setCurrentProject(other, "bob");

      const deleteProjectDir = vi.fn(async () => {});
      const repo = stubRepo({ deleteProjectDir });
      const exec = makeDeleteProject({ repo });
      const result = await exec(slnPath);
      expect(deleteProjectDir).toHaveBeenCalledWith(dir);
      expect(result.kind).toBe("ok");

      const remainingKeys: string[] = [];
      forEachCurrentProject((k) => remainingKeys.push(k));
      expect(remainingKeys).toContain("bob");
      expect(remainingKeys).not.toContain("alice");
    } finally {
      // tidy up any leftover cached entries.
      forEachCurrentProject((k) => deleteCurrentProjectByKey(k));
      recorderConfig.workspaceDir = original;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("createProject use case (port-mocked)", () => {
  it("rejects invalid solution names with a validation error", async () => {
    const repo = stubRepo();
    const exec = makeCreateProject({ repo });
    const result = await exec({
      solutionName: "1bad-name",
      namespace: "Acme.QA",
    });
    expect(result.kind).toBe("err");
    if (result.kind === "err") expect(result.error.kind).toBe("validation");
  });

  it("rejects invalid namespaces with a validation error", async () => {
    const repo = stubRepo();
    const exec = makeCreateProject({ repo });
    const result = await exec({
      solutionName: "Acme",
      namespace: "1.bad",
    });
    expect(result.kind).toBe("err");
    if (result.kind === "err") expect(result.error.kind).toBe("validation");
  });
});
