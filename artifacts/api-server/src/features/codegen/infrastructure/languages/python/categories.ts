/**
 * Idempotent upsert of per-suite `{Suite}Categories` constants into
 * `test_categories/{snake}_categories.py`. The class is created if the
 * module is absent; the entry `{constantName}: str = "{value}"` is
 * inserted (or replaced when the constant already exists with a
 * different value) and entries are kept in sorted order.
 */
import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import { writeFile } from "@/features/projects/infrastructure/projectFiles";
import {
  categoriesClassNameForSuite,
  categoriesRelPathForSuite,
  escapePy,
} from "./naming";

export async function ensureCategoryFile(
  project: Project,
  suiteName: string,
  constantName: string,
  value: string,
): Promise<string> {
  const rel = categoriesRelPathForSuite(suiteName);
  const abs = safeJoin(project.rootPath, rel);
  const className = categoriesClassNameForSuite(suiteName);

  const entries = new Map<string, string>();
  let existing = "";
  try {
    existing = await fs.readFile(abs, "utf8");
  } catch {
    /* first write — fall through with empty entries */
  }
  if (existing) {
    // Permit PascalCase identifiers (e.g. `Smoke`) as well as
    // SCREAMING_SNAKE — categoryConstantName is documented as
    // PascalCase but we round-trip whatever was previously written.
    const re =
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*str\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(existing)) !== null) {
      entries.set(m[1]!, m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    }
  }
  entries.set(constantName, value);

  const sorted = Array.from(entries.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const body =
    sorted
      .map(([k, v]) => `    ${k}: str = "${escapePy(v)}"`)
      .join("\n") || "    pass";
  const content =
    `"""Test categories for the ${suiteName} suite."""


class ${className}:
${body}
`;
  await writeFile(project, rel, content);
  return rel;
}
