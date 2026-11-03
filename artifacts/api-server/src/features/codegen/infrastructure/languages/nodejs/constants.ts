import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import { writeFile } from "@/features/projects/infrastructure/projectFiles";
import { escapeTs } from "./naming";
import {
  CONSTANTS_REL_PATH,
  readIfExists,
  suiteCategoriesRelPath,
  suiteConstantsRelPath,
} from "./paths";

/**
 * Read the per-suite Constants file back into a `name -> value` map.
 */
export async function readSuiteConstants(
  project: Project,
  suiteName: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rel = suiteConstantsRelPath(suiteName);
  const raw = await readIfExists(safeJoin(project.rootPath, rel));
  if (!raw) return out;
  const re = /^\s*([A-Za-z_][\w]*)\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.set(m[1]!, m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return out;
}

export async function writeSuiteConstants(
  project: Project,
  suiteName: string,
  byName: Map<string, string>,
): Promise<string> {
  const rel = suiteConstantsRelPath(suiteName);
  const sortedEntries = Array.from(byName.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const body = sortedEntries
    .map(([k, v]) => `  ${k}: "${escapeTs(v)}",`)
    .join("\n");
  const content = `/** Recorded constants for the ${suiteName} suite. */
export const ${suiteName}Constants = {
${body}
} as const;
`;
  await writeFile(project, rel, content);
  return rel;
}

/**
 * Idempotently upsert a single `{name}: "{value}"` entry into the
 * per-suite Test Categories file.
 */
export async function upsertTestCategory(
  project: Project,
  suiteName: string,
  constantName: string,
  value: string,
): Promise<{ path: string; created: boolean }> {
  if (!/^[A-Za-z_][\w]*$/.test(constantName)) {
    throw new Error(
      `Test category constant name must be a TypeScript identifier: ${constantName}`,
    );
  }
  const rel = suiteCategoriesRelPath(suiteName);
  const abs = safeJoin(project.rootPath, rel);
  const existing = await readIfExists(abs);
  const entries = new Map<string, string>();
  if (existing) {
    const re = /^\s*([A-Za-z_][\w]*)\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(existing)) !== null) {
      entries.set(m[1]!, m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    }
  }
  entries.set(constantName, value);
  const sorted = Array.from(entries.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const body = sorted.map(([k, v]) => `  ${k}: "${escapeTs(v)}",`).join("\n");
  const content = `/** Recorded test categories for the ${suiteName} suite. */
export const ${suiteName}Categories = {
${body}
} as const;
`;
  await writeFile(project, rel, content);
  return { path: rel, created: existing === null };
}

export async function readRecordedConstants(
  project: Project,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let text: string;
  try {
    text = await fs.readFile(
      safeJoin(project.rootPath, CONSTANTS_REL_PATH),
      "utf8",
    );
  } catch {
    return out;
  }
  const re = /^\s*([A-Za-z_][\w]*)\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.set(m[1]!, m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return out;
}

export async function writeRecordedConstants(
  project: Project,
  byName: Map<string, string>,
): Promise<string> {
  const sortedEntries = Array.from(byName.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const body =
    sortedEntries
      .map(([k, v]) => `  ${k}: "${escapeTs(v)}",`)
      .join("\n");
  const content =
    `/** Recorded constants for the test suite. */
export const Constants = {
${body}
} as const;
`;
  await writeFile(project, CONSTANTS_REL_PATH, content);
  return CONSTANTS_REL_PATH;
}
