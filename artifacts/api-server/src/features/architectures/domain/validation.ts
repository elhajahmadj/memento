/**
 * Pure domain rules for architectures: identity, language/solution-type
 * resolution, and structural validation. No I/O, no framework imports.
 */
import { randomUUID } from "node:crypto";
import {
  type Architecture,
  type ArchSolutionType,
  type Language,
  DEFAULT_LANGUAGE,
  normalizeArchSolutionType,
} from "./types";
import { ArchitectureSchema } from "./schemas";

/** Resolve the language an architecture targets, defaulting to csharp. */
export function architectureLanguage(arch: Architecture): Language {
  return arch.language ?? DEFAULT_LANGUAGE;
}

/**
 * Resolve the solution flavor an architecture targets, defaulting to
 * `playwright`. Used by the New Project dialog to filter the dropdown
 * and by `createProject` to decide whether to mark the on-disk project
 * as an API solution.
 */
export function architectureSolutionType(arch: Architecture): ArchSolutionType {
  return normalizeArchSolutionType(arch.solutionType);
}

/**
 * Recursive structural validation. Throws when the architecture is
 * structurally invalid or missing the single tests-project marker.
 */
export function validateArchitecture(arch: Architecture): void {
  const parsed = ArchitectureSchema.safeParse(arch);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid architecture");
  }
  if (parsed.data.projects.length === 0) {
    throw new Error("Architecture must have at least one project");
  }
  const testsCount = parsed.data.projects.filter((p) => p.isTestsProject).length;
  if (testsCount !== 1) {
    throw new Error(
      "Architecture must designate exactly one project as the tests project",
    );
  }
}

export function newArchitectureId(): string {
  return randomUUID();
}
