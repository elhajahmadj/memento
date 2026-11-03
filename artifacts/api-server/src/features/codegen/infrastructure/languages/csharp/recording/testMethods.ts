/**
 * Recording-time emitter for `[Test]` methods on the C# test-suite class.
 * Inserts new methods before the class's closing brace, replaces existing
 * methods in place when `options.overwrite` is set, and ensures the
 * required `using` directives are present.
 */
import fs from "node:fs/promises";
import type { Project } from "@/features/projects/domain/types";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type {
  AddTestMethodOptions,
  AddTestMethodResult,
} from "@/features/codegen/domain/types";
import {
  buildCodeMask,
  collectMethodNames,
  computeLineStarts,
  detectClassInfo,
  findMethodLineRange,
} from "./codeMask";
import { ensureAsyncSuffix } from "./naming";
import { suiteTestCategoriesClassName } from "./identifiers";
import { migrateUrlReferencesToTestConfig } from "./testConfig";

/**
 * Check whether a `[Test]`-style method with the given name already exists in
 * the target test class. Returns a suggested unique name (the same name when
 * there is no collision) so callers can offer it to the user.
 */
export async function checkTestMethodExists(
  project: Project,
  fileRelPath: string,
  methodName: string,
): Promise<{ exists: boolean; suggestedName: string }> {
  // C# convention: every async test method ends in `Async`. Apply the
  // suffix here so collision detection compares the final on-disk name
  // (`RecordedFlowAsync`) against existing methods (`FooAsync`,
  // `FooAsync2`, …) — keeping the suggested-name path in lock-step with
  // `addTestMethod`'s collision suffixing.
  const finalName = ensureAsyncSuffix(methodName);
  const abs = safeJoin(project.rootPath, fileRelPath);
  let text: string;
  try {
    text = await fs.readFile(abs, "utf8");
  } catch {
    return { exists: false, suggestedName: finalName };
  }
  const mask = buildCodeMask(text);
  const existing = collectMethodNames(text, mask);
  if (!existing.has(finalName)) {
    return { exists: false, suggestedName: finalName };
  }
  let suffix = 2;
  while (existing.has(`${finalName}${suffix}`)) suffix++;
  return { exists: true, suggestedName: `${finalName}${suffix}` };
}

/**
 * Build the NUnit attribute lines (`[Ignore("…")]`, `[Category(...)]`)
 * that should be prepended above `[Test]` for the given metadata.
 * Returns an empty array when no metadata-driven attributes apply.
 */
function buildTestMethodMetadataAttrs(
  memberIndent: string,
  suiteName: string | undefined,
  metadata: AddTestMethodOptions["metadata"],
): string[] {
  const out: string[] = [];
  if (!metadata) return out;
  const reason = metadata.ignoreReason;
  if (reason && reason.length > 0) {
    const escaped = reason.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    out.push(`${memberIndent}[Ignore("${escaped}")]`);
  }
  const constName = metadata.categoryConstantName;
  const value = metadata.categoryValue;
  if (
    constName &&
    constName.length > 0 &&
    value !== null &&
    value !== undefined &&
    `${value}`.length > 0 &&
    suiteName
  ) {
    const cls = suiteTestCategoriesClassName(suiteName);
    out.push(`${memberIndent}[Category(${cls}.${constName})]`);
  }
  return out;
}

export async function addTestMethod(
  project: Project,
  fileRelPath: string,
  methodName: string,
  bodyLines: string[] = [],
  pageObjectsUsed: string[] = [],
  options: AddTestMethodOptions = {},
): Promise<AddTestMethodResult> {
  const abs = safeJoin(project.rootPath, fileRelPath);
  let original = await fs.readFile(abs, "utf8");
  // Migrate any pre-task-#206 `Configuration["Urls:Name"]!` references in
  // the existing class body to the new `TestConfig.Name` form so older
  // recordings pick up the typed accessor on their next finalize.
  original = migrateUrlReferencesToTestConfig(original);
  const wantsTestConfig =
    /\bTestConfig\.[A-Za-z_]\w*\b/.test(original) ||
    bodyLines.some((l) => /\bTestConfig\.[A-Za-z_]\w*\b/.test(l));
  const usings = [
    `using ${project.namespace}.Tests.PageObjects;`,
    `using ${project.namespace}.Tests.PageObjects.Actions;`,
    `using ${project.namespace}.Tests.PageObjects.Interfaces;`,
    `using ${project.namespace}.Tests.PageObjects.Selectors;`,
  ];
  if (wantsTestConfig) {
    usings.push(`using ${project.namespace}.Shared.Configuration;`);
  }
  // When a category attribute will be emitted, ensure the TestCategories
  // namespace is imported so the `{Suite}TestCategories.X` reference compiles.
  const wantCategory =
    !!(options.metadata?.categoryConstantName &&
      options.metadata?.categoryValue &&
      options.suiteName);
  if (wantCategory) {
    usings.push(`using ${project.namespace}.Tests.TestCategories;`);
  }
  // When the body references a per-suite `{Stem}Constants.X` symbol (hoisted
  // typed values produced by writeRecordedConstants), import the per-suite
  // constants namespace so the reference compiles. The `Constants` suffix is
  // unique enough that a simple identifier-boundary regex is safe — it won't
  // match string literals like `"Constants/Foo.cs"` because we look for a
  // following `.Identifier`.
  const wantConstants = bodyLines.some((l) =>
    /\b[A-Za-z_]\w*Constants\.[A-Za-z_]\w*/.test(l),
  );
  if (wantConstants) {
    usings.push(`using ${project.namespace}.Tests.Constants;`);
  }
  for (const u of usings) {
    if (!original.includes(u)) {
      const baseUsing = `using ${project.namespace}.Infrastructure.Fixtures;`;
      if (original.includes(baseUsing)) {
        original = original.replace(baseUsing, `${baseUsing}\n${u}`);
      } else {
        original = `${u}\n${original}`;
      }
    }
  }
  const text = original;
  const lines = text.split(/\r?\n/);
  const mask = buildCodeMask(text);
  const lineStarts = computeLineStarts(text);

  const classInfo = detectClassInfo(text, mask, lines, lineStarts);
  const memberIndent = classInfo?.memberIndent ?? "        ";
  const unit = classInfo?.unit ?? "    ";
  const bodyIndent = memberIndent + unit;

  const existingNames = collectMethodNames(text, mask);
  const requestedName = methodName;
  // C# convention: every async test method ends in `Async`. Apply the
  // suffix BEFORE collision detection so the on-disk name and the
  // collision-incremented suggestion both end in `Async` (e.g.
  // `FooAsync` → `FooAsync2`, never `Foo2Async`). Idempotent: callers
  // that already pass `FooAsync` keep that exact name.
  const baseName = ensureAsyncSuffix(methodName);
  let finalName = baseName;
  let renamed = false;
  let overwriting = false;
  if (existingNames.has(finalName)) {
    if (options.overwrite) {
      overwriting = true;
    } else {
      // Disambiguate the method name to keep the project compiling. C# would
      // otherwise refuse to compile two methods with the same signature.
      let suffix = 2;
      while (existingNames.has(`${baseName}${suffix}`)) suffix++;
      finalName = `${baseName}${suffix}`;
      renamed = true;
    }
  }

  const metadataAttrs = buildTestMethodMetadataAttrs(
    memberIndent,
    options.suiteName,
    options.metadata,
  );

  if (overwriting) {
    const range = findMethodLineRange(
      text,
      mask,
      lines,
      lineStarts,
      finalName,
    );
    if (!range) {
      throw new Error(
        `Cannot overwrite ${finalName}: method not located in ${fileRelPath}`,
      );
    }
    const body =
      bodyLines.length > 0
        ? bodyLines.map((l) => `${bodyIndent}${l}`).join("\n")
        : `${bodyIndent}await Task.CompletedTask;`;
    const replacement = [
      ...metadataAttrs,
      `${memberIndent}[Test]`,
      `${memberIndent}public async Task ${finalName}()`,
      `${memberIndent}{`,
      body,
      `${memberIndent}}`,
    ];
    lines.splice(
      range.startLine,
      range.endLine - range.startLine + 1,
      ...replacement,
    );
    await fs.writeFile(abs, lines.join("\n"));
    void pageObjectsUsed;
    return { methodName: finalName, renamed: false, requestedName };
  }

  // Find the class's closing brace using the mask so braces inside C# strings
  // or comments don't throw the count off.
  let classCloseIdx = -1;
  if (classInfo) {
    const openAbs =
      lineStarts[classInfo.openLine]! +
      lines[classInfo.openLine]!.indexOf("{");
    let depth = 0;
    for (let i = openAbs; i < text.length; i++) {
      if (mask[i] !== 1) continue;
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          for (let k = 1; k < lineStarts.length; k++) {
            if (lineStarts[k]! > i) {
              classCloseIdx = k - 1;
              break;
            }
            classCloseIdx = k;
          }
          break;
        }
      }
    }
  }
  if (classCloseIdx === -1) classCloseIdx = lines.length - 1;

  const body =
    bodyLines.length > 0
      ? bodyLines.map((l) => `${bodyIndent}${l}`).join("\n")
      : `${bodyIndent}await Task.CompletedTask;`;

  const insertion = [
    "",
    ...metadataAttrs,
    `${memberIndent}[Test]`,
    `${memberIndent}public async Task ${finalName}()`,
    `${memberIndent}{`,
    body,
    `${memberIndent}}`,
  ].join("\n");

  lines.splice(classCloseIdx, 0, insertion);
  await fs.writeFile(abs, lines.join("\n"));
  // pageObjectsUsed is informational for now; usings are added unconditionally
  // so any combination of page objects compiles.
  void pageObjectsUsed;
  return { methodName: finalName, renamed, requestedName };
}
