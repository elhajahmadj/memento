import type { Project } from "@/features/projects/domain/types";
import type { SessionConfig } from "./sessionTypes";

/**
 * Trim a user-typed new-test-class name. C# (handled in codegen) /
 * Node.js / Python / Java return unchanged so the on-disk filename
 * matches what the user typed (e.g. `Login` → `tests/Login.spec.ts`
 * for Node.js).
 */
export function normalizeNewTestClassName(
  name: string | null | undefined,
  _language: Project["language"],
): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed;
}

export function targetClassName(config: SessionConfig): string | null {
  const p =
    config.existingTestClassPath ??
    (config.newTestClassName ? `Tests/${config.newTestClassName}.cs` : null);
  if (!p) return null;
  const base = p.split("/").pop() ?? p;
  return base.replace(/\.cs$/, "");
}

function snakeToPascal(s: string): string {
  return s
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Strip language-specific filename decorations off a test file basename
 * to recover the clean suite identifier the codegen layer expects.
 */
export function deriveSuiteNameFromConfig(
  config: SessionConfig,
  project: Project | null,
): string | null {
  if (config.newTestClassName) return config.newTestClassName;
  const p = config.existingTestClassPath;
  if (!p) return null;
  const base = p.split("/").pop() ?? p;
  const language = project?.language ?? "csharp";
  switch (language) {
    case "python": {
      const stem = base.replace(/\.py$/, "").replace(/^test_/, "");
      return snakeToPascal(stem) || stem;
    }
    case "nodejs": {
      return base
        .replace(/\.spec\.ts$/, "")
        .replace(/\.spec\.tsx$/, "")
        .replace(/\.test\.ts$/, "")
        .replace(/\.ts$/, "");
    }
    case "java": {
      return base.replace(/\.java$/, "").replace(/^Test/, "");
    }
    case "csharp":
    default: {
      const stem = base.replace(/\.cs$/, "");
      return stem.replace(/TestSuite$/, "") || stem;
    }
  }
}

/**
 * Resolve the test-suite name; falls back to a generic name only for
 * hook-only recordings where neither existing nor new class is set.
 */
export function resolveSuiteName(
  config: SessionConfig,
  project: Project | null,
): string {
  return deriveSuiteNameFromConfig(config, project) ?? "RecordedSuite";
}
