import fs from "node:fs/promises";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { toRelative } from "@/features/projects/infrastructure/paths";
import {
  normalizeLanguage,
  type Language,
} from "@/features/architectures/infrastructure/architectureService";
import type { ProjectRepository } from "../../domain/ports/projectRepository";
import {
  DISABLED_MARKER,
  FORKS_SUBDIR,
  JAVA_PROJECT_FILE,
  JMX_PROJECT_FILE,
  NODEJS_PROJECT_FILE,
  PROJECT_MARKER_FILE,
  PYTHON_PROJECT_FILE,
} from "../../domain/paths";
import {
  infrastructureProjectName,
  testsProjectName,
} from "../../domain/naming";
import {
  normalizeSolutionType,
  type Project,
  type ProjectListing,
  type ProjectMarker,
  type TreeNode,
} from "../../domain/types";

async function readMarker(rootPath: string): Promise<ProjectMarker | null> {
  try {
    const txt = await fs.readFile(
      path.join(rootPath, PROJECT_MARKER_FILE),
      "utf8",
    );
    return JSON.parse(txt) as ProjectMarker;
  } catch {
    return null;
  }
}

async function writeMarker(
  rootPath: string,
  marker: ProjectMarker,
): Promise<void> {
  await fs.writeFile(
    path.join(rootPath, PROJECT_MARKER_FILE),
    JSON.stringify(marker, null, 2),
  );
}

async function isDisabled(rootPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootPath, DISABLED_MARKER));
    return true;
  } catch {
    return false;
  }
}

async function setDisabled(
  rootPath: string,
  disabled: boolean,
): Promise<void> {
  const marker = path.join(rootPath, DISABLED_MARKER);
  if (disabled) {
    await fs.writeFile(marker, "");
  } else {
    try {
      await fs.unlink(marker);
    } catch {
      // already enabled
    }
  }
}

async function deleteProjectDir(rootPath: string): Promise<void> {
  await fs.rm(rootPath, { recursive: true, force: true });
}

async function assertExists(filePath: string): Promise<void> {
  await fs.access(filePath);
}

async function listAvailableProjects(): Promise<ProjectListing[]> {
  await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  const out: ProjectListing[] = [];
  const entries = await fs.readdir(recorderConfig.workspaceDir, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name === FORKS_SUBDIR) continue;
    const dir = path.join(recorderConfig.workspaceDir, entry.name);
    try {
      const inner = await fs.readdir(dir);
      const sln = inner.find((f) => f.endsWith(".sln"));
      const hasPyproject = inner.includes(PYTHON_PROJECT_FILE);
      const hasPackageJson = inner.includes(NODEJS_PROJECT_FILE);
      const hasPom = inner.includes(JAVA_PROJECT_FILE);
      const hasJmxMarker = inner.includes(JMX_PROJECT_FILE);
      const marker = await readMarker(dir);
      const inferred: Language = sln
        ? "csharp"
        : hasPyproject
          ? "python"
          : hasPackageJson
            ? "nodejs"
            : hasPom
              ? "java"
              : hasJmxMarker
                ? "jmx"
                : "csharp";
      const language: Language = normalizeLanguage(
        marker?.language ?? inferred,
      );
      const solutionType = normalizeSolutionType(marker?.solutionType);
      if (sln && language === "csharp") {
        out.push({
          slnPath: path.join(dir, sln),
          solutionName: marker?.solutionName ?? path.basename(sln, ".sln"),
          disabled: await isDisabled(dir),
          language: "csharp",
          solutionType,
        });
      } else if (hasPyproject && language === "python") {
        out.push({
          slnPath: path.join(dir, PYTHON_PROJECT_FILE),
          solutionName: marker?.solutionName ?? entry.name,
          disabled: await isDisabled(dir),
          language: "python",
          solutionType,
        });
      } else if (hasPackageJson && language === "nodejs") {
        out.push({
          slnPath: path.join(dir, NODEJS_PROJECT_FILE),
          solutionName: marker?.solutionName ?? entry.name,
          disabled: await isDisabled(dir),
          language: "nodejs",
          solutionType,
        });
      } else if (hasPom && language === "java") {
        out.push({
          slnPath: path.join(dir, JAVA_PROJECT_FILE),
          solutionName: marker?.solutionName ?? entry.name,
          disabled: await isDisabled(dir),
          language: "java",
          solutionType,
        });
      } else if (hasJmxMarker && language === "jmx") {
        out.push({
          slnPath: path.join(dir, JMX_PROJECT_FILE),
          solutionName: marker?.solutionName ?? entry.name,
          disabled: await isDisabled(dir),
          language: "jmx",
          solutionType: "playwright",
        });
      }
    } catch {
      // ignore
    }
  }
  return out;
}

async function buildTreeInternal(
  rootPath: string,
  dirAbs: string,
): Promise<TreeNode> {
  const stat = await fs.stat(dirAbs);
  const name = path.basename(dirAbs);
  const rel = toRelative(rootPath, dirAbs) || ".";
  if (!stat.isDirectory()) {
    return { name, path: rel, type: "file" };
  }
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  const filtered = entries
    .filter((e) => !recorderConfig.ignoreDirs.has(e.name))
    .filter((e) => e.name !== ".gitkeep")
    .filter((e) => e.name !== PROJECT_MARKER_FILE)
    // Hide the AI Agent's hidden `{ClassName}Setup` sidecars.
    .filter(
      (e) =>
        !(e.isFile() && !e.name.includes(".") && e.name.endsWith("Setup")),
    )
    // Hide `.setup` sidecars dropped beside a suite by Build with AI.
    .filter((e) => !(e.isFile() && e.name.endsWith(".setup")))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
  const children: TreeNode[] = [];
  for (const e of filtered) {
    children.push(await buildTreeInternal(rootPath, path.join(dirAbs, e.name)));
  }
  return { name, path: rel, type: "folder", children };
}

async function buildTree(rootPath: string): Promise<TreeNode> {
  return buildTreeInternal(rootPath, rootPath);
}

async function listTestClasses(
  project: Project,
): Promise<Array<{ className: string; path: string }>> {
  if (project.language === "python") {
    const testsDir =
      (project.solutionType ?? "playwright") === "api"
        ? path.join(project.rootPath, "tests", "tests")
        : path.join(project.rootPath, "tests");
    try {
      const files = await fs.readdir(testsDir);
      return files
        .filter((f) => f.startsWith("test_") && f.endsWith(".py"))
        .map((f) => ({
          className: path.basename(f, ".py").replace(/^test_/, ""),
          path: toRelative(project.rootPath, path.join(testsDir, f)),
        }));
    } catch {
      return [];
    }
  }

  if (project.language === "nodejs") {
    const isApi = (project.solutionType ?? "playwright") === "api";
    const testsDir = isApi
      ? path.join(project.rootPath, "tests", "tests")
      : path.join(project.rootPath, "tests");
    try {
      const files = await fs.readdir(testsDir);
      return files
        .filter((f) => f.endsWith(".spec.ts"))
        .map((f) => ({
          className: isApi
            ? f
                .replace(/\.spec\.ts$/, "")
                .split("-")
                .map((p) =>
                  p.length === 0 ? "" : p[0].toUpperCase() + p.slice(1),
                )
                .join("")
            : f.replace(/\.spec\.ts$/, ""),
          path: isApi
            ? toRelative(
                path.join(project.rootPath, "tests"),
                path.join(testsDir, f),
              )
            : toRelative(project.rootPath, path.join(testsDir, f)),
        }));
    } catch {
      return [];
    }
  }

  if (project.language === "java") {
    if ((project.solutionType ?? "playwright") === "api") {
      const { javaApiPackageSegment } = await import(
        "@/features/projects/infrastructure/apiJavaScaffolder"
      );
      const pkg = javaApiPackageSegment(project.solutionName);
      const testsDir = path.join(
        project.rootPath,
        project.testProjectName,
        "src",
        "test",
        "java",
        "com",
        pkg,
        "automation",
        "api",
        "tests",
        "tests",
      );
      try {
        const files = await fs.readdir(testsDir);
        return files
          .filter((f) => f.endsWith(".java"))
          .map((f) => ({
            className: path.basename(f, ".java"),
            path: toRelative(project.rootPath, path.join(testsDir, f)),
          }));
      } catch {
        return [];
      }
    }

    const testsDir = path.join(
      project.rootPath,
      project.testProjectName,
      "src",
      "test",
      "java",
      project.namespace,
      "tests",
    );
    try {
      const files = await fs.readdir(testsDir);
      return files
        .filter((f) => f.startsWith("Test") && f.endsWith(".java"))
        .map((f) => ({
          className: path.basename(f, ".java").replace(/^Test/, ""),
          path: toRelative(project.rootPath, path.join(testsDir, f)),
        }));
    } catch {
      return [];
    }
  }

  const testsDir = path.join(
    project.rootPath,
    project.testProjectName,
    "Tests",
  );
  try {
    const files = await fs.readdir(testsDir);
    return files
      .filter((f) => f.endsWith(".cs"))
      .map((f) => ({
        className: path.basename(f, ".cs"),
        path: toRelative(project.rootPath, path.join(testsDir, f)),
      }));
  } catch {
    return [];
  }
}

async function listApiBaseUrls(
  project: Project,
): Promise<Array<{ name: string; baseUrl: string }>> {
  if ((project.solutionType ?? "playwright") !== "api") return [];
  const appsettingsAbs = path.join(
    project.rootPath,
    project.testProjectName,
    "appsettings.json",
  );
  let raw: string;
  try {
    raw = await fs.readFile(appsettingsAbs, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const apiTest = (parsed as Record<string, unknown>).ApiTest;
  if (!apiTest || typeof apiTest !== "object") return [];
  const urls = (apiTest as Record<string, unknown>).Urls;
  if (!urls || typeof urls !== "object") return [];
  const out: Array<{ name: string; baseUrl: string }> = [];
  for (const [name, entry] of Object.entries(urls as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const baseUrl = (entry as Record<string, unknown>).BaseUrl;
    if (typeof baseUrl === "string" && baseUrl.length > 0) {
      out.push({ name, baseUrl });
    }
  }
  return out;
}

async function detectLegacyCsharpNamespace(
  rootPath: string,
  solutionName: string,
): Promise<string> {
  const tests = testsProjectName(solutionName);
  const infra = infrastructureProjectName(solutionName);
  const candidates = [
    {
      file: path.join(rootPath, infra, "Fixtures", "TestFixtureBase.cs"),
      regex: /namespace\s+([A-Za-z0-9_.]+)\.Infrastructure\.Fixtures/,
    },
    {
      file: path.join(rootPath, infra, "Fixtures", "TestFixture.cs"),
      regex: /namespace\s+([A-Za-z0-9_.]+)\.Infrastructure\.Fixtures/,
    },
    {
      file: path.join(rootPath, tests, "Base", "TestFixture.cs"),
      regex: /namespace\s+([A-Za-z0-9_.]+)\.Base/,
    },
  ];
  for (const c of candidates) {
    try {
      const txt = await fs.readFile(c.file, "utf8");
      const m = txt.match(c.regex);
      if (m?.[1]) return m[1];
    } catch {
      // try next candidate
    }
  }
  return solutionName;
}

async function readMarkerLanguage(rootPath: string): Promise<Language | null> {
  const marker = await readMarker(rootPath);
  return marker?.language ? normalizeLanguage(marker.language) : null;
}

export const fsProjectRepository: ProjectRepository = {
  readMarker,
  writeMarker,
  isDisabled,
  setDisabled,
  deleteProjectDir,
  assertExists,
  listAvailableProjects,
  buildTree,
  listTestClasses,
  listApiBaseUrls,
  detectLegacyCsharpNamespace,
  readMarkerLanguage,
};
