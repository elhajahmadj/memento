/**
 * Read and write the per-suite `{Suite}Constants` Python module under
 * `constants/{snake}_constants.py`. Each suite owns its own constants
 * file so re-recording one suite never clobbers another suite's fill
 * values. The historical `shared/constants.py` is no longer written;
 * legacy projects can keep the file around but new recordings ignore it.
 */
import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import { writeFile } from "@/features/projects/infrastructure/projectFiles";
import {
  constantsClassNameForSuite,
  constantsRelPathForSuite,
  escapePy,
} from "./naming";

/**
 * Read the existing recorded `{Suite}Constants` mapping. Returns an
 * empty Map when the file is absent or unparseable so callers can
 * treat "first recording" and "broken file" identically.
 */
export async function readRecordedConstants(
  project: Project,
  suiteName: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let text: string;
  try {
    text = await fs.readFile(
      safeJoin(project.rootPath, constantsRelPathForSuite(suiteName)),
      "utf8",
    );
  } catch {
    return out;
  }
  const re = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.set(m[1]!, m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return out;
}

/**
 * Persist `byName` as `class {Suite}Constants` in
 * `constants/{snake}_constants.py`. Returns the relative path so callers
 * can include it in the `generated[]` list.
 */
export async function writeRecordedConstants(
  project: Project,
  byName: Map<string, string>,
  suiteName: string,
): Promise<string> {
  const sortedEntries = Array.from(byName.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const className = constantsClassNameForSuite(suiteName);
  const body =
    sortedEntries
      .map(([k, v]) => `    ${k} = "${escapePy(v)}"`)
      .join("\n") || "    pass";
  const content =
    `"""Recorded constants for the ${suiteName} suite."""


class ${className}:
${body}
`;
  const rel = constantsRelPathForSuite(suiteName);
  await writeFile(project, rel, content);
  return rel;
}
