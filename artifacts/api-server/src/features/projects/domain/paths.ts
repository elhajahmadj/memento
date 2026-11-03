import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";

/** File that marks any project root — written by the scaffolder. */
export const PROJECT_MARKER_FILE = ".testbuilder.json";

/** File that marks a Python project root (acts like `.sln` for C#). */
export const PYTHON_PROJECT_FILE = "pyproject.toml";

/** File that marks a Node.js project root. */
export const NODEJS_PROJECT_FILE = "package.json";

/**
 * File that marks a Java project root. The Java scaffolder writes a
 * parent `pom.xml` at the workspace root; each Maven module also has
 * its own `pom.xml`, but project discovery only inspects the top level
 * of each project directory so it never mistakes a child module for the
 * project root.
 */
export const JAVA_PROJECT_FILE = "pom.xml";

/**
 * File that marks a JMX (JMeter) project root. JMX projects have no
 * compiled-language source tree — they are a per-project workspace for
 * recording HTTP traffic and emitting a JMeter `.jmx` test plan — so
 * the marker is just a plain sentinel file dropped alongside the
 * project's captured-events store and emitted plan.
 */
export const JMX_PROJECT_FILE = ".jmxproject";

export function isJmxProjectFilePath(slnPath: string): boolean {
  return path.basename(slnPath).toLowerCase() === JMX_PROJECT_FILE;
}

/** Marker placed alongside the solution file when a project is disabled. */
export const DISABLED_MARKER = ".disabled";

/** Reserved subdirectory inside the workspace that holds per-user forks. */
export const FORKS_SUBDIR = "forks";

export function isPythonProjectFilePath(slnPath: string): boolean {
  return path.basename(slnPath).toLowerCase() === PYTHON_PROJECT_FILE;
}

export function isNodejsProjectFilePath(slnPath: string): boolean {
  return path.basename(slnPath).toLowerCase() === NODEJS_PROJECT_FILE;
}

export function isJavaProjectFilePath(slnPath: string): boolean {
  return path.basename(slnPath).toLowerCase() === JAVA_PROJECT_FILE;
}

/**
 * Canonical solution-name resolver for *main-tree* project paths
 * (i.e. `<workspaceDir>/<solutionName>/<marker-file>`). Works for every
 * supported language: C# (`.sln`), Python (`pyproject.toml`), Node.js
 * (`package.json`), and Java (`pom.xml`). Authorization checks (org
 * scope, project assignments) MUST use this — `path.basename(p, ".sln")`
 * silently returns "pyproject.toml" / "package.json" / "pom.xml" for
 * non-C# projects and would deny org users access to their own data.
 *
 * Returns `null` when the path is outside the workspace root or is
 * nested deeper than one level (e.g. inside `forks/<user>/...`).
 */
export function solutionNameFromMainProjectPath(
  projectPath: string,
): string | null {
  const abs = path.resolve(projectPath);
  const wsRoot = path.resolve(recorderConfig.workspaceDir);
  if (!abs.startsWith(wsRoot + path.sep)) return null;
  const dir = path.dirname(abs);
  if (path.resolve(path.dirname(dir)) !== wsRoot) return null;
  return path.basename(dir);
}

/**
 * Resolve the project directory from a sln/marker file path, validating
 * that it lives one level under the workspace root. Throws when the
 * path is outside the workspace.
 */
export function projectDirFromSlnPath(slnPath: string): string {
  const resolved = path.resolve(slnPath);
  const dir = path.dirname(resolved);
  const wsRoot = path.resolve(recorderConfig.workspaceDir);
  const rel = path.relative(wsRoot, dir);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    throw new Error("Project path is outside the workspace");
  }
  return dir;
}
