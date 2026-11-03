/**
 * Backwards-compatible facade for the projects feature.
 *
 * The implementation has been split across:
 *  - `domain/`                        — pure types, naming, validation, paths, ports
 *  - `application/useCases/`          — one `execute()` per public operation, each
 *                                       returning `Result<T, AppError>`
 *  - `infrastructure/scaffolders/`    — per-language project scaffolders
 *  - `infrastructure/clearers/`       — per-language clear-files handlers
 *  - `infrastructure/repositories/`   — `ProjectRepository` filesystem adapter,
 *                                       current-project in-memory store
 *
 * This file keeps the original throw-style API so the 70+ existing
 * importers (route handlers, recording / forks / validation services,
 * tests) compile unchanged. The downstream "Wire composition roots
 * across every migrated feature" task will switch presentation layers
 * over to consuming the `Result`-returning use cases directly.
 */
import {
  unwrap,
  type AppError,
  type Result,
} from "@workspace/kernel";
import { makeCreateProject } from "../application/useCases/createProject";
import { makeDetectProjectInfo } from "../application/useCases/detectProjectInfo";
import { makeLoadProject } from "../application/useCases/loadProject";
import { makeListAvailableProjects } from "../application/useCases/listAvailableProjects";
import { makeSetProjectDisabled } from "../application/useCases/setProjectDisabled";
import { makeDeleteProject } from "../application/useCases/deleteProject";
import { makeClearProjectFiles } from "../application/useCases/clearProjectFiles";
import { makeGetProjectTree } from "../application/useCases/getProjectTree";
import { makeListTestClasses } from "../application/useCases/listTestClasses";
import { makeListApiBaseUrls } from "../application/useCases/listApiBaseUrls";
import { fsProjectRepository } from "./repositories/fsProjectRepository";
import type { Project, TreeNode, SolutionType } from "../domain/types";
import type { Language } from "@/features/architectures/infrastructure/architectureService";

// ---------------------------------------------------------------------------
// Re-exported domain surface
// ---------------------------------------------------------------------------
export type { Project, TreeNode, SolutionType } from "../domain/types";
export { normalizeSolutionType } from "../domain/types";
export { FORKS_SUBDIR } from "../domain/paths";
export { solutionNameFromMainProjectPath } from "../domain/paths";
export {
  infrastructureProjectName,
  sharedProjectName,
  testsProjectName,
  pythonPackageName,
  pythonTestPackageName,
  nodejsPackageName,
  javaPackageName,
  javaTestsModuleName,
} from "../domain/naming";
export {
  getCurrentProject,
  setCurrentProject,
  clearCurrentProjectIfSolution,
  clearCurrentProjectForUser,
  currentProjectCacheSize,
  resetCurrentProjectsForTests,
} from "./repositories/currentProjectStore";

// ---------------------------------------------------------------------------
// Wired use cases (default composition: filesystem repository)
// ---------------------------------------------------------------------------
const repo = fsProjectRepository;
const createProjectUC = makeCreateProject({ repo });
const detectProjectInfoUC = makeDetectProjectInfo({ repo });
const loadProjectUC = makeLoadProject({ repo });
const listAvailableProjectsUC = makeListAvailableProjects({ repo });
const setProjectDisabledUC = makeSetProjectDisabled({ repo });
const deleteProjectUC = makeDeleteProject({ repo });
const clearProjectFilesUC = makeClearProjectFiles({ repo });
const getProjectTreeUC = makeGetProjectTree({ repo });
const listTestClassesUC = makeListTestClasses({ repo });
const listApiBaseUrlsUC = makeListApiBaseUrls({ repo });

// Composition-root accessors. Consumed by `composition/container.ts`.
export const projectsComposition = {
  createProject: createProjectUC,
  detectProjectInfo: detectProjectInfoUC,
  loadProject: loadProjectUC,
  listAvailableProjects: listAvailableProjectsUC,
  setProjectDisabled: setProjectDisabledUC,
  deleteProject: deleteProjectUC,
  clearProjectFiles: clearProjectFilesUC,
  getProjectTree: getProjectTreeUC,
  listTestClasses: listTestClassesUC,
  listApiBaseUrls: listApiBaseUrlsUC,
} as const;

/** Convert a use-case Result into the throw-style API existing callers rely on. */
async function unwrapAsync<T>(p: Promise<Result<T, AppError>>): Promise<T> {
  const r = await p;
  if (r.kind === "ok") return r.value;
  throw new Error(r.error.message);
}

// ---------------------------------------------------------------------------
// Public functions — same signatures as the legacy implementation.
// ---------------------------------------------------------------------------

export async function createProject(args: {
  solutionName: string;
  testProjectName?: string | undefined;
  namespace: string;
  architectureId?: string | undefined;
  language?: Language | undefined;
  solutionType?: SolutionType | undefined;
  targetUrl?: string | undefined;
  jwtAuth?: boolean | undefined;
  bff?: boolean | undefined;
  /** See `CreateProjectInput.ownerUserId` (audit finding M-4). */
  ownerUserId?: string | undefined;
}): Promise<Project> {
  return unwrapAsync(createProjectUC(args));
}

export async function detectProjectInfo(slnPath: string): Promise<Project> {
  return unwrapAsync(detectProjectInfoUC(slnPath));
}

export async function loadProject(
  slnPath: string,
  userId?: string | null,
): Promise<Project> {
  return unwrapAsync(loadProjectUC(slnPath, userId));
}

export async function listAvailableProjects(): Promise<
  Array<{
    slnPath: string;
    solutionName: string;
    disabled: boolean;
    language: Language;
    solutionType: SolutionType;
  }>
> {
  return unwrapAsync(listAvailableProjectsUC());
}

export async function setProjectDisabled(
  slnPath: string,
  disabled: boolean,
): Promise<{
  slnPath: string;
  solutionName: string;
  disabled: boolean;
  language: Language;
}> {
  return unwrapAsync(setProjectDisabledUC(slnPath, disabled));
}

export async function deleteProject(slnPath: string): Promise<void> {
  await unwrapAsync(deleteProjectUC(slnPath));
}

/**
 * Wipe everything a user has recorded into a project (test classes,
 * page objects, constants, categories, sidecar `.bak` files, named-URL
 * entries in `appsettings.json` / `.env`) while leaving the scaffolded
 * project structure (solution/project files, base classes,
 * `.testbuilder.json`, IDE config, empty folders) untouched.
 */
export async function clearProjectFiles(slnPath: string): Promise<void> {
  await unwrapAsync(clearProjectFilesUC(slnPath));
}

export async function getProjectTree(project: Project): Promise<TreeNode> {
  return unwrapAsync(getProjectTreeUC(project));
}

export async function listTestClasses(
  project: Project,
): Promise<Array<{ className: string; path: string }>> {
  return unwrapAsync(listTestClassesUC(project));
}

export async function listApiBaseUrls(
  project: Project,
): Promise<Array<{ name: string; baseUrl: string }>> {
  return unwrapAsync(listApiBaseUrlsUC(project));
}

// ---------------------------------------------------------------------------
// File-system CRUD operations. Tiny pass-throughs that don't merit their
// own use case; presentation-layer authorization is enforced by the
// surrounding route middlewares before these are called.
//
// The implementations live in `./projectFiles.ts` so the codegen feature
// can depend on them without pulling in this module (which would form a
// cycle via the wired-up use cases above).
// ---------------------------------------------------------------------------
export {
  readFile,
  writeFile,
  createFile,
  deleteFile,
  rename,
  createFolder,
} from "./projectFiles";

// Silence unused import in some build configurations.
void unwrap;
