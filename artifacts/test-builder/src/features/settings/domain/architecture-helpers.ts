import {
  Language,
  SolutionType,
  type Architecture,
  type ArchProject,
  type Language as LanguageT,
  type SolutionType as SolutionTypeT,
} from "@workspace/api-client-react";

export function newGuid(): string {
  const hex = (n: number) =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, "0")
      .toUpperCase();
  return `{${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}}`;
}

export function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function blankProject(suffix: string, isTests = false): ArchProject {
  return {
    id: newId(),
    nameSuffix: suffix,
    isTestsProject: isTests,
    slnGuid: newGuid(),
    folders: [],
    files: [],
  };
}

/**
 * Build a fresh blank Architecture record for "Create new architecture"
 * in Settings → Architectures. Defaults `language: csharp`. The caller
 * picks the `solutionType` (Playwright vs API) so the New Project dialog
 * can later filter by it.
 */
export function blankArchitecture(
  solutionType: SolutionTypeT = SolutionType.playwright,
  language: LanguageT = Language.csharp,
): Architecture {
  const isApi = solutionType === SolutionType.api;
  return {
    id: "",
    name: isApi ? "New API Architecture" : "New Architecture",
    isBuiltIn: false,
    language,
    solutionType,
    projects: [blankProject(isApi ? ".ApiTests" : ".Tests", true)],
  };
}

export function cloneArchitecture(
  arch: Architecture,
  newName: string,
): Architecture {
  const copy = JSON.parse(JSON.stringify(arch)) as Architecture;
  copy.id = "";
  copy.name = newName;
  copy.isBuiltIn = false;
  // `solutionType` and `language` are preserved by the JSON round-trip,
  // so duplicating an API architecture yields another API architecture.
  copy.projects = copy.projects.map((p) => ({
    ...p,
    id: newId(),
    slnGuid: newGuid(),
  }));
  return copy;
}

export type ImportResult =
  | {
      fileName: string;
      status: "success";
      architectureId: string;
      architectureName: string;
    }
  | { fileName: string; status: "error"; reason: string };
