/**
 * Append / overwrite `def test_<name>(self, page):` methods on the
 * generated test class, including pytest decorator + import management
 * for `Ignore` and `Categories` recording metadata.
 */
import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import type {
  AddTestMethodOptions,
  AddTestMethodResult,
} from "@/features/codegen/infrastructure/codegen";
import {
  categoriesClassNameForSuite,
  categoriesImportModuleForSuite,
  pyQuotedArg,
  pytestMarkerName,
  toPyIdent,
} from "./naming";

/**
 * Walk a Python source string and collect every `def test_<name>(` method
 * name declared inside a class block. Used both to detect collisions and
 * to suggest non-colliding alternatives.
 */
function collectTestMethodNames(text: string): Set<string> {
  const names = new Set<string>();
  const re = /^\s*def\s+(test_[A-Za-z_][\w]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    names.add(m[1]!);
  }
  return names;
}

/** Convert a user-facing method name to its on-disk Python identifier. */
function pythonTestMethodName(methodName: string): string {
  const snake = toPyIdent(methodName);
  return snake.startsWith("test_") ? snake : `test_${snake}`;
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
  const target = pythonTestMethodName(methodName);
  if (!existing.has(target)) {
    return { exists: false, suggestedName: methodName };
  }
  let suffix = 2;
  while (existing.has(`${target}${suffix}`)) suffix++;
  return { exists: true, suggestedName: `${methodName}${suffix}` };
}

/**
 * Append a new `def test_<name>(self, page):` method onto the class body.
 *
 * On a name collision: when `options.overwrite` is true the existing
 * method is replaced in-place (matching the C# behavior); otherwise a
 * numeric suffix is appended to keep both methods.
 */
export async function addTestMethod(
  project: Project,
  fileRelPath: string,
  methodName: string,
  bodyLines: string[] = [],
  _pageObjectsUsed: string[] = [],
  options: AddTestMethodOptions = {},
): Promise<AddTestMethodResult> {
  const abs = safeJoin(project.rootPath, fileRelPath);
  const original = await fs.readFile(abs, "utf8");

  const existing = collectTestMethodNames(original);
  const requestedName = methodName;
  const targetName = pythonTestMethodName(methodName);

  let finalDisplayName = methodName;
  let finalSnake = targetName;
  let renamed = false;
  let overwriting = false;
  if (existing.has(targetName)) {
    if (options.overwrite) {
      overwriting = true;
    } else {
      let suffix = 2;
      while (existing.has(`${targetName}${suffix}`)) suffix++;
      finalSnake = `${targetName}${suffix}`;
      finalDisplayName = `${methodName}${suffix}`;
      renamed = true;
    }
  }

  let lines = original.split(/\r?\n/);

  const memberIndent = "    ";
  const bodyIndent = "        ";
  const renderedBody =
    bodyLines.length > 0
      ? bodyLines.map((l) => `${bodyIndent}${l}`).join("\n")
      : `${bodyIndent}pass`;

  // RecordingMetadata-driven decorators. Order matters: skip first so it
  // is the outermost decorator (pytest reads them top-down). Categories
  // emit a `@pytest.mark.{slug}` so the test can be filtered with
  // `pytest -m {slug}`. The `{Suite}Categories` import is added to the
  // module top-level when the category is present, even though pytest
  // markers cannot use the constant in the decorator itself — it's the
  // documented dependency that explains where the marker name came from.
  const decoratorLines: string[] = [];
  const ignoreReason = options.metadata?.ignoreReason ?? null;
  const categoryConstantName = options.metadata?.categoryConstantName ?? null;
  const categoryValue = options.metadata?.categoryValue ?? null;
  const suiteName = options.suiteName ?? null;
  const hasCategory = !!(categoryConstantName && categoryValue);
  if (ignoreReason) {
    decoratorLines.push(
      `${memberIndent}@pytest.mark.skip(reason=${pyQuotedArg(ignoreReason)})`,
    );
  }
  if (hasCategory) {
    const slug = pytestMarkerName(categoryValue!);
    decoratorLines.push(`${memberIndent}@pytest.mark.${slug}`);
  }

  const decoratorBlock =
    decoratorLines.length > 0 ? `${decoratorLines.join("\n")}\n` : "";
  const newMethodBlock =
    `\n${decoratorBlock}${memberIndent}def ${finalSnake}(self, page):\n${renderedBody}\n`;

  if (overwriting) {
    const defRe = new RegExp(
      String.raw`^${memberIndent}def\s+${finalSnake}\s*\(`,
    );
    let defLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (defRe.test(lines[i]!)) {
        defLine = i;
        break;
      }
    }
    if (defLine === -1) {
      throw new Error(`addTestMethod: existing method ${finalSnake} not found`);
    }
    let startLine = defLine;
    while (startLine > 0) {
      const prev = lines[startLine - 1]!;
      if (/^\s*@/.test(prev)) {
        startLine--;
        continue;
      }
      break;
    }
    let endLine = lines.length;
    for (let i = defLine + 1; i < lines.length; i++) {
      const ln = lines[i]!;
      if (ln.trim() === "") continue;
      if (!ln.startsWith(`${memberIndent}    `)) {
        endLine = i;
        break;
      }
    }
    const replacement = newMethodBlock.replace(/^\n|\n$/g, "").split("\n");
    lines = [
      ...lines.slice(0, startLine),
      ...replacement,
      ...lines.slice(endLine),
    ];
  } else {
    let trailing = lines.length;
    while (trailing > 0 && lines[trailing - 1]!.trim() === "") trailing--;
    lines = [
      ...lines.slice(0, trailing),
      ...newMethodBlock.split("\n"),
    ];
  }

  // Idempotently add the `from shared.test_config import TestConfig`
  // import when the body references `TestConfig.<X>`.
  if (bodyLines.some((l) => /\bTestConfig\./.test(l))) {
    const importLine = `from shared.test_config import TestConfig`;
    if (!lines.some((l) => l.trim() === importLine)) {
      let insertAt = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^import\s+pytest\s*$/.test(lines[i]!.trim())) {
          insertAt = i + 1;
          break;
        }
      }
      if (insertAt === -1) insertAt = 0;
      lines = [
        ...lines.slice(0, insertAt),
        importLine,
        ...lines.slice(insertAt),
      ];
    }
  }

  if (hasCategory && suiteName) {
    const importLine =
      `from ${categoriesImportModuleForSuite(suiteName)} import ` +
      `${categoriesClassNameForSuite(suiteName)}`;
    if (!lines.some((l) => l.trim() === importLine)) {
      let insertAt = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^import\s+pytest\s*$/.test(lines[i]!.trim())) {
          insertAt = i + 1;
          break;
        }
      }
      if (insertAt === -1) insertAt = 0;
      lines = [
        ...lines.slice(0, insertAt),
        importLine,
        ...lines.slice(insertAt),
      ];
    }
  }

  await fs.writeFile(abs, lines.join("\n").replace(/\n+$/, "\n"));

  return { methodName: finalDisplayName, renamed, requestedName };
}
