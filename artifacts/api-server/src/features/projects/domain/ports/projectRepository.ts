import type { Language } from "@/features/architectures/infrastructure/architectureService";
import type {
  Project,
  ProjectListing,
  ProjectMarker,
  TreeNode,
} from "../types";

/**
 * Port describing the persistence operations the project use cases
 * need from the workspace. Today the only adapter is filesystem-backed
 * (`FsProjectRepository`); the port exists so use cases can be unit
 * tested with in-memory stubs.
 *
 * Note: in this codebase there is no DB-backed project table — the
 * source of truth for projects is the workspace directory tree. The
 * task's "Drizzle adapter" wording is a template carry-over; we model
 * the filesystem the same way other features model their stores.
 */
export interface ProjectRepository {
  /** Read the marker file at `<rootPath>/.testbuilder.json` or null. */
  readMarker(rootPath: string): Promise<ProjectMarker | null>;
  /** Write the marker file (overwrites if present). */
  writeMarker(rootPath: string, marker: ProjectMarker): Promise<void>;
  /** Has the `.disabled` flag-file been written next to the marker. */
  isDisabled(rootPath: string): Promise<boolean>;
  /** Create/delete the `.disabled` flag-file. */
  setDisabled(rootPath: string, disabled: boolean): Promise<void>;
  /** Recursively delete the project directory. */
  deleteProjectDir(rootPath: string): Promise<void>;
  /** Confirm a path exists; throws on absent. */
  assertExists(filePath: string): Promise<void>;
  /** Enumerate every available main-tree project. */
  listAvailableProjects(): Promise<ProjectListing[]>;
  /** Build a recursive file/folder tree for the project. */
  buildTree(rootPath: string): Promise<TreeNode>;
  /** Discover test class files for the given language/layout. */
  listTestClasses(
    project: Project,
  ): Promise<Array<{ className: string; path: string }>>;
  /** Read `ApiTest:Urls:{name}:BaseUrl` from appsettings.json. */
  listApiBaseUrls(
    project: Project,
  ): Promise<Array<{ name: string; baseUrl: string }>>;
  /** Read namespace heuristics for legacy markerless C# projects. */
  detectLegacyCsharpNamespace(
    rootPath: string,
    solutionName: string,
  ): Promise<string>;
  /** Detect the project language from its marker file (no fallback). */
  readMarkerLanguage(rootPath: string): Promise<Language | null>;
}
