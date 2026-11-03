// Test-method add / collision-check / overwrite path for Java suites.
import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import type {
  AddTestMethodOptions,
  AddTestMethodResult,
} from "@/features/codegen/infrastructure/codegen";
import { javaQuotedArg } from "./naming";
import { pkgPath, suiteTestCategoriesClassName } from "./paths";
import { ensureTestImports } from "./testMethodImports";
import { upsertTestCategoryConstantJava } from "./recordedConstants";

// Collect every `@Test void <Name>()` method name in the test file.
function collectTestMethodNames(text: string): Set<string> {
  const names = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    const m = /^\s*(?:public\s+|private\s+|protected\s+)?void\s+([A-Za-z_]\w*)\s*\(/.exec(ln);
    if (!m) continue;
    let j = i - 1;
    while (j >= 0 && lines[j]!.trim() === "") j--;
    if (j < 0) continue;
    const prev = lines[j]!.trim();
    if (prev === "@Test" || /^@Test\s*\(/.test(prev)) {
      names.add(m[1]!);
    }
  }
  return names;
}

export async function checkTestMethodExists(
  project: Project,
  fileRelPath: string,
  methodName: string,
): Promise<{ exists: boolean; suggestedName: string }> {
  const abs = safeJoin(project.rootPath, fileRelPath);
  let text: string;
  try {
    text = await fs.readFile(abs, "utf8");
  } catch {
    return { exists: false, suggestedName: methodName };
  }
  const existing = collectTestMethodNames(text);
  if (!existing.has(methodName)) {
    return { exists: false, suggestedName: methodName };
  }
  let suffix = 2;
  while (existing.has(`${methodName}${suffix}`)) suffix++;
  return { exists: true, suggestedName: `${methodName}${suffix}` };
}

// Append a new `@Test void <name>() { ... }` method. On collision:
// overwrite when options.overwrite is set, otherwise append a numeric suffix.
export async function addTestMethod(
  project: Project,
  fileRelPath: string,
  methodName: string,
  bodyLines: string[] = [],
  pageObjectsUsed: string[] = [],
  options: AddTestMethodOptions = {},
): Promise<AddTestMethodResult> {
  const abs = safeJoin(project.rootPath, fileRelPath);
  await ensureTestImports(abs, pkgPath(project), pageObjectsUsed, bodyLines, options);
  const original = await fs.readFile(abs, "utf8");

  const existing = collectTestMethodNames(original);
  const requestedName = methodName;

  let finalName = methodName;
  let renamed = false;
  let overwriting = false;
  if (existing.has(methodName)) {
    if (options.overwrite) {
      overwriting = true;
    } else {
      let suffix = 2;
      while (existing.has(`${methodName}${suffix}`)) suffix++;
      finalName = `${methodName}${suffix}`;
      renamed = true;
    }
  }

  // Side-effect: when the recorder picked a TestCategories constant for
  // this method, idempotently upsert the corresponding `<Suite>TestCategories`
  // file so the `@Tag(<Suite>TestCategories.NAME)` annotation we're about
  // to emit resolves at compile time.
  const meta = options.metadata ?? undefined;
  if (
    meta?.categoryConstantName &&
    meta.categoryValue &&
    options.suiteName
  ) {
    await upsertTestCategoryConstantJava(
      project,
      options.suiteName,
      meta.categoryConstantName,
      meta.categoryValue,
    );
  }

  const lines = original.split(/\r?\n/);

  const memberIndent = "    ";
  const bodyIndent = "        ";
  const renderedBody =
    bodyLines.length > 0
      ? bodyLines.map((l) => `${bodyIndent}${l}`).join("\n")
      : "";
  const annotationLines: string[] = [];
  if (meta?.ignoreReason) {
    annotationLines.push(
      `${memberIndent}@Disabled(${javaQuotedArg(meta.ignoreReason)})`,
    );
  }
  if (
    meta?.categoryConstantName &&
    meta.categoryValue &&
    options.suiteName
  ) {
    const categoriesClass = suiteTestCategoriesClassName(options.suiteName);
    annotationLines.push(
      `${memberIndent}@Tag(${categoriesClass}.${meta.categoryConstantName})`,
    );
  }
  annotationLines.push(`${memberIndent}@Test`);
  const newTestBlock =
    annotationLines.join("\n") +
    "\n" +
    `${memberIndent}void ${finalName}() {\n` +
    (renderedBody ? `${renderedBody}\n` : "") +
    `${memberIndent}}`;

  if (overwriting) {
    // Find the existing `void <name>()` line that follows a `@Test` annotation.
    const escapedName = finalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const defRe = new RegExp(
      String.raw`^${memberIndent}(?:public\s+|private\s+|protected\s+)?void\s+` +
        escapedName +
        String.raw`\s*\(`,
    );
    let defLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (defRe.test(lines[i]!)) {
        // Confirm previous non-blank line is @Test
        let j = i - 1;
        while (j >= 0 && lines[j]!.trim() === "") j--;
        if (j >= 0 && (lines[j]!.trim() === "@Test" || /^@Test\s*\(/.test(lines[j]!.trim()))) {
          // Walk further back to swallow any leading @Disabled / @Tag
          // annotations from a previous recording so the replacement
          // block doesn't leave dangling annotations behind.
          let k = j - 1;
          while (
            k >= 0 &&
            (lines[k]!.trim() === "" ||
              /^@(?:Disabled|Tag)\b/.test(lines[k]!.trim()))
          ) {
            if (lines[k]!.trim() !== "") j = k;
            k--;
          }
          defLine = j; // include the annotation line(s)
          break;
        }
      }
    }
    if (defLine === -1) {
      throw new Error(`addTestMethod: existing test ${finalName} not found`);
    }
    // Walk forward to the closing `}` at exactly `memberIndent`.
    const closeRe = new RegExp(String.raw`^${memberIndent}\}\s*$`);
    let endLine = -1;
    for (let i = defLine + 1; i < lines.length; i++) {
      if (closeRe.test(lines[i]!)) {
        endLine = i;
        break;
      }
    }
    if (endLine === -1) {
      throw new Error(`addTestMethod: end of test ${finalName} not found`);
    }
    const replacement = newTestBlock.split("\n");
    const next = [
      ...lines.slice(0, defLine),
      ...replacement,
      ...lines.slice(endLine + 1),
    ];
    await fs.writeFile(abs, next.join("\n"));
  } else {
    // Append: insert before the final `}` of the class (column 0).
    let classCloseIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\}\s*$/.test(lines[i]!)) {
        classCloseIdx = i;
        break;
      }
    }
    if (classCloseIdx === -1) {
      throw new Error(
        `addTestMethod: class close brace not found in ${fileRelPath}`,
      );
    }
    let insertAt = classCloseIdx;
    while (insertAt > 0 && lines[insertAt - 1]!.trim() === "") insertAt--;
    const prefix = lines.slice(0, insertAt);
    const suffixLines = lines.slice(insertAt);
    const next = [...prefix, "", ...newTestBlock.split("\n"), ...suffixLines];
    await fs.writeFile(abs, next.join("\n"));
  }

  return { methodName: finalName, renamed, requestedName };
}
