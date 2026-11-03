/**
 * Core domain types for architectures.
 *
 * Pure types — no I/O, no validation, no framework imports. Used by
 * every layer above (application use cases, infrastructure repositories,
 * presentation routes).
 */

export interface ArchFile {
  name: string;
  content: string;
}

export interface ArchFolder {
  name: string;
  folders: ArchFolder[];
  files: ArchFile[];
}

export interface ArchProject {
  id: string;
  nameSuffix: string;
  isTestsProject: boolean;
  slnGuid: string;
  folders: ArchFolder[];
  files: ArchFile[];
}

/**
 * Programming language a project / architecture targets. Defaults to
 * `csharp` everywhere it is omitted so existing projects, architecture JSON
 * files, and API clients keep working unchanged.
 */
export type Language = "csharp" | "python" | "nodejs" | "java" | "jmx";

export const DEFAULT_LANGUAGE: Language = "csharp";

export function normalizeLanguage(value: unknown): Language {
  if (value === "python") return "python";
  if (value === "nodejs") return "nodejs";
  if (value === "java") return "java";
  if (value === "jmx") return "jmx";
  return DEFAULT_LANGUAGE;
}

/**
 * Solution flavor an architecture targets. Mirrors `SolutionType` in
 * `projectService`. Architectures default to `playwright` everywhere it
 * is omitted so existing custom JSON files keep working unchanged.
 */
export type ArchSolutionType = "playwright" | "api";

export const DEFAULT_ARCH_SOLUTION_TYPE: ArchSolutionType = "playwright";

export function normalizeArchSolutionType(value: unknown): ArchSolutionType {
  return value === "api" ? "api" : "playwright";
}

export interface Architecture {
  id: string;
  name: string;
  isBuiltIn: boolean;
  /** Language this architecture targets. Absent → `csharp` (legacy default). */
  language?: Language;
  /**
   * Solution flavor. Absent → `playwright` (legacy default). When `api`,
   * this architecture is offered in the New Project dialog only when
   * the user has chosen the "API (HTTP-only)" solution type.
   */
  solutionType?: ArchSolutionType;
  projects: ArchProject[];
}

// ---------------------------------------------------------------------------
// Built-in architecture identifiers
// ---------------------------------------------------------------------------

export const DEFAULT_ARCHITECTURE_ID = "default";
export const PYTHON_DEFAULT_ARCHITECTURE_ID = "python-default";
export const NODEJS_DEFAULT_ARCHITECTURE_ID = "nodejs-default";
export const JAVA_DEFAULT_ARCHITECTURE_ID = "java-default";

/**
 * Per-language built-in marker architectures for the API solution flavor.
 *
 * These have an empty `projects: []` array on purpose: their scaffolding
 * is delegated to the hardcoded per-language API scaffolders in
 * `apiTestScaffolderRegistry`. They exist so the New Project dialog can
 * offer them as options in the architecture dropdown, side-by-side with
 * any custom API architectures the user has authored.
 */
export const API_DEFAULT_CSHARP_ARCHITECTURE_ID = "api-default-csharp";
export const API_DEFAULT_PYTHON_ARCHITECTURE_ID = "api-default-python";
export const API_DEFAULT_NODEJS_ARCHITECTURE_ID = "api-default-nodejs";
export const API_DEFAULT_JAVA_ARCHITECTURE_ID = "api-default-java";

export const BUILTIN_API_ARCHITECTURE_IDS: ReadonlySet<string> = new Set([
  API_DEFAULT_CSHARP_ARCHITECTURE_ID,
  API_DEFAULT_PYTHON_ARCHITECTURE_ID,
  API_DEFAULT_NODEJS_ARCHITECTURE_ID,
  API_DEFAULT_JAVA_ARCHITECTURE_ID,
  // Legacy single id stamped on existing on-disk markers prior to the
  // per-language split. Treated as "use the built-in API scaffolder for
  // the project's recorded language".
  "api-default",
]);

export function isBuiltInApiArchitectureId(id: string): boolean {
  return BUILTIN_API_ARCHITECTURE_IDS.has(id);
}

export function builtInApiArchitectureIdFor(language: Language): string {
  switch (language) {
    case "python":
      return API_DEFAULT_PYTHON_ARCHITECTURE_ID;
    case "nodejs":
      return API_DEFAULT_NODEJS_ARCHITECTURE_ID;
    case "java":
      return API_DEFAULT_JAVA_ARCHITECTURE_ID;
    default:
      return API_DEFAULT_CSHARP_ARCHITECTURE_ID;
  }
}
