import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import type {
  AddTestMethodOptions,
  AddTestMethodResult,
} from "@/features/codegen/infrastructure/codegen";
import { ensureSpecImports } from "./specImports";
import { upsertTestCategory } from "./constants";

/**
 * Walk a TypeScript spec file and collect every `test("Name", ...)` test
 * name declared inside the file.
 */
function collectTestMethodNames(text: string): Set<string> {
  const names = new Set<string>();
  const re = /(?:^|\s)test(?:\.skip)?\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    names.add(m[2]!);
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

/**
 * Append a new `test("<name>", async ({ page }) => { ... })` block.
 */
export async function addTestMethod(
  project: Project,
  fileRelPath: string,
  methodName: string,
  bodyLines: string[] = [],
  pageObjectsUsed: string[] = [],
  options: AddTestMethodOptions = {},
): Promise<AddTestMethodResult> {
  const abs = safeJoin(project.rootPath, fileRelPath);
  const suiteName = options.suiteName;
  const ignoreReason = options.metadata?.ignoreReason ?? null;
  const categoryConstantName = options.metadata?.categoryConstantName ?? null;
  const categoryValue = options.metadata?.categoryValue ?? null;
  const hasCategory =
    !!suiteName &&
    typeof categoryConstantName === "string" &&
    categoryConstantName.length > 0 &&
    typeof categoryValue === "string" &&
    categoryValue.length > 0;
  if (hasCategory) {
    await upsertTestCategory(
      project,
      suiteName,
      categoryConstantName,
      categoryValue,
    );
  }
  await ensureSpecImports(
    abs,
    pageObjectsUsed,
    bodyLines,
    suiteName,
    hasCategory,
  );
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

  const lines = original.split(/\r?\n/);

  const memberIndent = "  ";
  const bodyIndent = "    ";
  const renderedBody =
    bodyLines.length > 0
      ? bodyLines.map((l) => `${bodyIndent}${l}`).join("\n")
      : "";
  const testFn = ignoreReason ? "test.skip" : "test";
  const optionsObj = hasCategory
    ? `, { tag: [${suiteName}Categories.${categoryConstantName}] }`
    : "";
  const ignoreCommentLine = ignoreReason
    ? `${memberIndent}// Ignored: ${ignoreReason.replace(/\r?\n/g, " ")}\n`
    : "";
  const newTestBlock =
    ignoreCommentLine +
    `${memberIndent}${testFn}("${finalName.replace(/"/g, '\\"')}"${optionsObj}, async ({ page }) => {\n` +
    (renderedBody ? `${renderedBody}\n` : "") +
    `${memberIndent}});`;

  if (overwriting) {
    const escapedName = finalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const defRe = new RegExp(
      String.raw`^${memberIndent}test(?:\.skip)?\s*\(\s*["']` +
        escapedName +
        String.raw`["']\s*,`,
    );
    let defLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (defRe.test(lines[i]!)) {
        defLine = i;
        break;
      }
    }
    if (defLine === -1) {
      throw new Error(`addTestMethod: existing test ${finalName} not found`);
    }
    let ignoreCommentStart = defLine;
    const ignoreCommentRe = new RegExp(
      String.raw`^${memberIndent}// Ignored:`,
    );
    while (
      ignoreCommentStart > 0 &&
      ignoreCommentRe.test(lines[ignoreCommentStart - 1]!)
    ) {
      ignoreCommentStart--;
    }
    const closeRe = new RegExp(String.raw`^${memberIndent}\}\s*\)\s*;\s*$`);
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
      ...lines.slice(0, ignoreCommentStart),
      ...replacement,
      ...lines.slice(endLine + 1),
    ];
    await fs.writeFile(abs, next.join("\n"));
  } else {
    let describeCloseIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\}\s*\)\s*;\s*$/.test(lines[i]!)) {
        describeCloseIdx = i;
        break;
      }
    }
    if (describeCloseIdx === -1) {
      throw new Error(
        `addTestMethod: describe close brace not found in ${fileRelPath}`,
      );
    }
    let insertAt = describeCloseIdx;
    while (insertAt > 0 && lines[insertAt - 1]!.trim() === "") insertAt--;
    const prefix = lines.slice(0, insertAt);
    const suffixLines = lines.slice(insertAt);
    const next = [...prefix, "", ...newTestBlock.split("\n"), ...suffixLines];
    await fs.writeFile(abs, next.join("\n"));
  }

  return { methodName: finalName, renamed, requestedName };
}
