import fs from "node:fs/promises";
import { suiteKebab } from "./naming";

const IMPORT_LINE_RE = /^\s*import\s+/;

/**
 * Build the set of import statements a recorded test body needs.
 */
export function requiredSpecImports(
  pageObjectsUsed: string[],
  bodyLines: string[],
  suiteName?: string,
  needsCategoriesImport?: boolean,
): string[] {
  const imports: string[] = [];
  const seenActions = new Set<string>();
  for (const symbol of pageObjectsUsed) {
    if (!symbol.endsWith("Actions")) continue;
    if (seenActions.has(symbol)) continue;
    seenActions.add(symbol);
    imports.push(`import { ${symbol} } from "../pages/actions/${symbol}";`);
  }
  imports.sort();
  if (suiteName) {
    const suiteConstantsName = `${suiteName}Constants`;
    const re = new RegExp(`\\b${suiteConstantsName}\\.`);
    if (bodyLines.some((l) => re.test(l))) {
      imports.push(
        `import { ${suiteConstantsName} } from "../constants/${suiteKebab(suiteName)}.constants";`,
      );
    }
  } else {
    const usesConstants = bodyLines.some((l) => /\bConstants\./.test(l));
    if (usesConstants) {
      imports.push(`import { Constants } from "../shared/constants";`);
    }
  }
  if (bodyLines.some((l) => /\bTestConfig\./.test(l))) {
    imports.push(`import { TestConfig } from "../shared/testConfig";`);
  }
  if (suiteName && needsCategoriesImport) {
    const suiteCategoriesName = `${suiteName}Categories`;
    imports.push(
      `import { ${suiteCategoriesName} } from "../test-categories/${suiteKebab(suiteName)}.categories";`,
    );
  }
  return imports;
}

/**
 * Idempotently insert `requiredSpecImports(...)` lines into the spec
 * file at `abs`. New ones are appended immediately after the last
 * contiguous import line at the top of the file.
 */
export async function ensureSpecImports(
  abs: string,
  pageObjectsUsed: string[],
  bodyLines: string[],
  suiteName?: string,
  needsCategoriesImport?: boolean,
): Promise<void> {
  const needed = requiredSpecImports(
    pageObjectsUsed,
    bodyLines,
    suiteName,
    needsCategoriesImport,
  );
  if (needed.length === 0) return;
  const original = await fs.readFile(abs, "utf8");
  const lines = original.split(/\r?\n/);
  const present = new Set(
    lines.filter((l) => IMPORT_LINE_RE.test(l)).map((l) => l.trim()),
  );
  const toInsert = needed.filter((l) => !present.has(l.trim()));
  if (toInsert.length === 0) return;
  let insertAfter = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (IMPORT_LINE_RE.test(lines[i]!)) {
      insertAfter = i;
    } else if (trimmed === "") {
      continue;
    } else {
      break;
    }
  }
  const insertAt = insertAfter + 1;
  const next = [...lines.slice(0, insertAt), ...toInsert, ...lines.slice(insertAt)];
  await fs.writeFile(abs, next.join("\n"));
}
