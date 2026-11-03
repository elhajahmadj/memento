import type { Language } from "@/features/architectures/infrastructure/architectureService";

export type SolutionType = "playwright" | "api";

export interface Project {
  solutionName: string;
  /**
   * For C#: name (without `.csproj`) of the project that holds NUnit test
   * classes. For Python: kept for API compatibility; usually the snake_case
   * tests-package name (e.g. `mysolution_tests`) but is unused at runtime
   * because Python tests live at `<rootPath>/tests/`.
   */
  testProjectName: string;
  namespace: string;
  rootPath: string;
  /**
   * Path to the file that identifies the project on disk. For C# this is
   * the `.sln` file; for Python this is the root `pyproject.toml`. The
   * frontend uses this verbatim as a project identifier — never parse it
   * as a literal `.sln`. Use `project.language` to branch behavior.
   */
  slnPath: string;
  /** Default `csharp` for legacy/missing markers. */
  language: Language;
  /**
   * Default `playwright` for legacy/missing markers. Optional on the
   * type so existing test fixtures and call sites can omit it; runtime
   * code should always read `project.solutionType ?? "playwright"`.
   */
  solutionType?: SolutionType;
  /**
   * JMX-only: project-root-relative paths of emitted `.jmx` plans
   * (e.g. `jmx/login-flow.jmx`). Mirrors `.testbuilder.json#jmxFiles`
   * so the workbench file explorer can list and download them
   * without reading the marker itself. Absent for non-JMX projects.
   */
  jmxFiles?: string[];
  /**
   * JMX-only: `true` when the project's saved
   * `jmxExport.embedCredentials` flag is on. Surfaced on `Project`
   * so the workbench can show a "credentials in plaintext XML"
   * warning above the export action without re-reading the marker.
   * Absent for non-JMX projects.
   */
  jmxEmbedCredentials?: boolean;
  /**
   * JMX-only: target HTTP origin, mirrored from `.testbuilder.json#targetUrl`
   * so the workbench can auto-open the recording browser at the
   * project's URL without re-reading the marker. Absent for non-JMX
   * projects.
   */
  targetUrl?: string;
  /**
   * JMX-only: mirrored from `.testbuilder.json#jwtAuth`.
   */
  jwtAuth?: boolean;
  /**
   * JMX-only: mirrored from `.testbuilder.json#bff`. `true` when
   * the project was created with the BFF (Backend-for-Frontend)
   * auth toggle enabled. Downstream recording/IR/correlation
   * features branch on this to enable BFF-aware OAuth, CSRF, and
   * storageState capture. Absent for non-JMX projects.
   */
  bff?: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
}

export interface ProjectMarker {
  architectureId: string;
  testProjectName: string;
  namespace: string;
  solutionName: string;
  /** Optional — absent on legacy markers, treated as csharp. */
  language?: Language;
  /**
   * Optional — absent on legacy markers, treated as `playwright`.
   * `api` flips the workbench to the Build Test → AssistantBuilder
   * authoring flow (no browser recording).
   */
  solutionType?: SolutionType;
  /**
   * JMX-only: target HTTP origin captured traffic will be rewritten
   * against when the `.jmx` plan is emitted. Set by the New Project →
   * JMX tab and persisted on disk as the single source of truth (no
   * separate DB row).
   */
  targetUrl?: string;
  /**
   * JMX-only: when `true`, the emitter wires the captured login
   * response into a JWT-bearer header for subsequent samplers. Set
   * once at project creation and editable later from the workbench.
   */
  jwtAuth?: boolean;
  /**
   * JMX-only: when `true`, the project is marked as a BFF-style
   * (Backend-for-Frontend) auth project. Set at project creation
   * from the New Project → JMX dialog. Downstream recording / IR /
   * correlation features branch on this to enable BFF-aware OAuth,
   * CSRF, and storageState capture. Absent on legacy markers, treated
   * as `false`.
   */
  bff?: boolean;
  /**
   * JMX-only: list of emitted `.jmx` plan files belonging to this
   * project (relative to `rootPath`). Empty when the project has been
   * scaffolded but never exported. Maintained by the JMX emitter slice.
   */
  jmxFiles?: string[];
  /**
   * JMX-only: persisted export-mode + correlation knobs the emitter
   * reads at finalize time. Mirrors a subset of `JmxExportOptions`
   * (everything except `baseUrl`/`jwtAuth`, which already live on the
   * marker as `targetUrl`/`jwtAuth`). The New Project / Workbench UI
   * persists these here so the server-side finalize path honors the
   * user's chosen mode, login path, token JSONPath, and CSV mode
   * without depending on a separate request payload. Absent on legacy
   * markers — finalize falls back to conservative defaults
   * (`embedCredentials=false`, `csvMode="off"`).
   */
  jmxExport?: {
    embedCredentials?: boolean;
    loginPath?: string;
    tokenJsonPath?: string;
    csvMode?: "off" | "perRequest" | "global";
  };
}

export interface ProjectListing {
  slnPath: string;
  solutionName: string;
  disabled: boolean;
  language: Language;
  solutionType: SolutionType;
}

export function normalizeSolutionType(
  value: SolutionType | string | null | undefined,
): SolutionType {
  return value === "api" ? "api" : "playwright";
}
