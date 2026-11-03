// Per-suite recorded `<Suite>Constants` + `<Suite>TestCategories` files.
import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import { writeFile } from "@/features/projects/infrastructure/projectFiles";
import {
  pkgPath,
  suiteConstantsClassName,
  suiteConstantsRelPath,
  suiteTestCategoriesClassName,
  suiteTestCategoriesRelPath,
} from "./paths";
import { escapeJava } from "./suiteHelpers";

// Read the per-suite recorded `<Suite>Constants` mapping. Returns an empty
// Map when the file is absent, unparseable, or `suiteName` is omitted.
// `suiteName` is required in practice for Java recordings; the optional
// signature exists so the language-pluggable adapter can pass through
// without forcing C#/Python/Node.js callers to supply a Java-only field.
export async function readRecordedConstants(
  project: Project,
  suiteName?: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!suiteName) return out;
  let text: string;
  try {
    text = await fs.readFile(
      safeJoin(project.rootPath, suiteConstantsRelPath(project, suiteName)),
      "utf8",
    );
  } catch {
    return out;
  }
  // Match `public static final String userName = "value";`.
  const re = /^\s*public\s+static\s+final\s+String\s+([A-Za-z_]\w*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.set(m[1]!, m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return out;
}

// Persist `byName` as `public static final String` declarations in the
// per-suite `<Suite>Constants.java` (under `tests/<pkg>/constants/`).
// Returns the relative path. The previous shared `Constants.java` is no
// longer written.
export async function writeRecordedConstants(
  project: Project,
  byName: Map<string, string>,
  suiteName?: string,
): Promise<string> {
  if (!suiteName) {
    throw new Error(
      "writeRecordedConstants (java) requires a suiteName — per-suite " +
        "Constants files are no longer shared across suites",
    );
  }
  const rel = suiteConstantsRelPath(project, suiteName);
  const pkg = pkgPath(project);
  const cls = suiteConstantsClassName(suiteName);
  const sortedEntries = Array.from(byName.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const body = sortedEntries
    .map(([k, v]) => `    public static final String ${k} = "${escapeJava(v)}";`)
    .join("\n");
  const content = `package ${pkg}.constants;

/** Recorded constants for the ${suiteName} test suite. */
public final class ${cls} {
    private ${cls}() {}

${body}
}
`;
  await writeFile(project, rel, content);
  return rel;
}

/**
 * Idempotently upsert a single `public static final String NAME = "value";`
 * constant into the per-suite `<Suite>TestCategories.java` file.
 * Creates the file (with the right `package …testcategories;` header and
 * `private` constructor) when it doesn't yet exist; replaces the value
 * in place when the constant already exists. Returns the relative path
 * of the written file.
 */
export async function upsertTestCategoryConstantJava(
  project: Project,
  suiteName: string,
  constantName: string,
  value: string,
): Promise<string> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(constantName)) {
    throw new Error(
      `TestCategories constant name must be a valid Java identifier: ${constantName}`,
    );
  }
  const rel = suiteTestCategoriesRelPath(project, suiteName);
  const abs = safeJoin(project.rootPath, rel);
  const pkg = pkgPath(project);
  const cls = suiteTestCategoriesClassName(suiteName);
  const escapedName = constantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declLine = `    public static final String ${constantName} = "${escapeJava(value)}";`;
  const declRe = new RegExp(
    `^[\\t ]*public\\s+static\\s+final\\s+String\\s+${escapedName}\\s*=\\s*"(?:[^"\\\\]|\\\\.)*"\\s*;[\\t ]*$`,
    "m",
  );

  let existing: string | null;
  try {
    existing = await fs.readFile(abs, "utf8");
  } catch {
    existing = null;
  }

  if (existing === null) {
    const content = `package ${pkg}.testcategories;

/** TestCategories tag constants for the ${suiteName} test suite. */
public final class ${cls} {
    private ${cls}() {}

${declLine}
}
`;
    await writeFile(project, rel, content);
    return rel;
  }

  if (declRe.test(existing)) {
    const next = existing.replace(declRe, declLine);
    await fs.writeFile(abs, next);
    return rel;
  }

  // Insert before the final `}` of the class. Match the trailing `}` at
  // column 0 so we don't accidentally land inside the private ctor body.
  const lines = existing.split(/\r?\n/);
  let classCloseIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\}\s*$/.test(lines[i]!)) {
      classCloseIdx = i;
      break;
    }
  }
  if (classCloseIdx === -1) {
    throw new Error(
      `upsertTestCategoryConstantJava: class close brace not found in ${rel}`,
    );
  }
  let insertAt = classCloseIdx;
  while (insertAt > 0 && lines[insertAt - 1]!.trim() === "") insertAt--;
  const next = [
    ...lines.slice(0, insertAt),
    "",
    declLine,
    ...lines.slice(insertAt),
  ];
  await fs.writeFile(abs, next.join("\n"));
  return rel;
}
