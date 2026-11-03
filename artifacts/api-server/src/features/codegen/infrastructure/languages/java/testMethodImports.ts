// Import-header maintenance for recorded test methods.
import fs from "node:fs/promises";
import type { AddTestMethodOptions } from "@/features/codegen/infrastructure/codegen";
import { suiteConstantsClassName, suiteTestCategoriesClassName } from "./paths";

// Build the set of import statements a recorded test body needs.
// Returns a stable, sorted, de-duplicated list.
export function requiredJavaImports(
  pkg: string,
  pageObjectsUsed: string[],
  bodyLines: string[],
  options: AddTestMethodOptions = {},
): string[] {
  const imports = new Set<string>();
  for (const symbol of pageObjectsUsed) {
    if (!symbol.endsWith("Actions")) continue;
    imports.add(`import ${pkg}.pages.actions.${symbol};`);
    // Generated suite headers reference the page-object via its interface
    // (`I<Suite>Actions actions = new <Suite>Actions(page);`), so pull in
    // the interface from the shared module too.
    imports.add(`import ${pkg}.pages.interfaces.I${symbol};`);
  }
  // Per-suite recorded `<Suite>Constants` references — the codegen emits
  // calls like `LoginConstants.userName`, so import the dedicated
  // per-suite class from the new `constants/` package when one is referenced.
  const constantsClass = options.suiteName
    ? suiteConstantsClassName(options.suiteName)
    : null;
  if (
    constantsClass &&
    bodyLines.some((l) => new RegExp(`\\b${constantsClass}\\.`).test(l))
  ) {
    imports.add(`import ${pkg}.constants.${constantsClass};`);
  }
  if (bodyLines.some((l) => /\bAssertions\./.test(l))) {
    imports.add(`import org.junit.jupiter.api.Assertions;`);
  }
  if (bodyLines.some((l) => /\bAppConfiguration\./.test(l))) {
    imports.add(`import ${pkg}.AppConfiguration;`);
  }
  // Recorded suite headers reference URLs through the typed
  // `TestConfig.<NAME>` accessor (mirroring the C# pattern). Pull the
  // class in from the shared module whenever the body uses it.
  if (bodyLines.some((l) => /\bTestConfig\./.test(l))) {
    imports.add(`import ${pkg}.TestConfig;`);
  }
  // T001 — wait/sync codegen emits `page.waitForLoadState(LoadState.NETWORKIDLE)`
  // for `networkidle` waits. Without this import the generated test
  // class fails Java compilation.
  if (bodyLines.some((l) => /\bLoadState\./.test(l))) {
    imports.add(`import com.microsoft.playwright.options.LoadState;`);
  }
  // Annotation imports for the optional Ignore + TestCategories features.
  const meta = options.metadata ?? undefined;
  if (meta?.ignoreReason) {
    imports.add(`import org.junit.jupiter.api.Disabled;`);
  }
  if (meta?.categoryConstantName && meta.categoryValue && options.suiteName) {
    imports.add(`import org.junit.jupiter.api.Tag;`);
    const categoriesClass = suiteTestCategoriesClassName(options.suiteName);
    imports.add(`import ${pkg}.testcategories.${categoriesClass};`);
  }
  return Array.from(imports).sort();
}

const IMPORT_LINE_RE = /^\s*import\s+/;

// Idempotently insert needed import lines after the existing import header.
export async function ensureTestImports(
  abs: string,
  pkg: string,
  pageObjectsUsed: string[],
  bodyLines: string[],
  options: AddTestMethodOptions = {},
): Promise<void> {
  const needed = requiredJavaImports(pkg, pageObjectsUsed, bodyLines, options);
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
    } else if (trimmed === "" || /^package\s+/.test(trimmed)) {
      // tolerate blank lines / package decl above the import header
      continue;
    } else {
      break;
    }
  }
  const insertAt = insertAfter + 1;
  const next = [...lines.slice(0, insertAt), ...toInsert, ...lines.slice(insertAt)];
  await fs.writeFile(abs, next.join("\n"));
}
