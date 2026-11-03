/**
 * Recording-time emitter for the C# test-class hooks
 * (`BeforeEachAsync` / `OneTimeSetUpAsync`). Replaces an existing hook
 * in-place or appends it when missing, stashes the previous body to a
 * sibling `.bak` file when overwriting non-default content, and exposes
 * helpers used by the API to preview / classify hook bodies.
 */
import fs from "node:fs/promises";
import type { Project } from "@/features/projects/domain/types";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type {
  HookKind,
  ReplaceHookBodyResult,
} from "@/features/codegen/domain/types";
import {
  ATTRIBUTE_LINE_RE,
  buildCodeMask,
  computeLineStarts,
  detectClassInfo,
  leadingWhitespace,
} from "./codeMask";
import { writeHookBackup } from "./hookBackups";
import { migrateUrlReferencesToTestConfig } from "./testConfig";

export const HOOK_INFO: Record<
  HookKind,
  { method: string; attribute: string }
> = {
  beforeEach: { method: "BeforeEachAsync", attribute: "[SetUp]" },
  oneTimeSetup: { method: "OneTimeSetUpAsync", attribute: "[OneTimeSetUp]" },
};

export function hookMethodName(hook: HookKind): string {
  return HOOK_INFO[hook].method;
}

/**
 * Replace the body of the named hook in the given test class file with the
 * supplied recorded lines. If the hook does not yet exist, it is appended.
 * Required `using` directives for page objects are ensured at the top.
 */
export async function replaceHookBody(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
  bodyLines: string[],
): Promise<ReplaceHookBodyResult> {
  const abs = safeJoin(project.rootPath, fileRelPath);
  let original = await fs.readFile(abs, "utf8");
  // Migrate any pre-task-#206 `Configuration["Urls:Name"]!` references to
  // the new `TestConfig.Name` form so older hook bodies pick up the typed
  // accessor on their next replace.
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

  const { method, attribute } = HOOK_INFO[hook];
  const text = original;
  const mask = buildCodeMask(text);
  const lineStarts = computeLineStarts(text);
  const lines = text.split(/\r?\n/);
  const inCode = (lineIdx: number, charIdx: number) =>
    mask[lineStarts[lineIdx]! + charIdx] === 1;

  const classInfo = detectClassInfo(text, mask, lines, lineStarts);
  const fallbackMember =
    classInfo?.memberIndent ?? "        ";
  const fallbackUnit = classInfo?.unit ?? "    ";

  let backupPath: string | null = null;

  const sigRe = new RegExp(
    String.raw`^\s*public\s+(?:async\s+)?Task\s+` + method + String.raw`\s*\(`,
  );
  let sigIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!sigRe.test(lines[i]!)) continue;
    const firstNonWs = lines[i]!.search(/\S/);
    if (firstNonWs >= 0 && inCode(i, firstNonWs)) {
      sigIdx = i;
      break;
    }
  }

  // Method indent: prefer the existing signature's indentation so we don't
  // rewrite a hook with different leading whitespace than the rest of the class.
  const methodIndent =
    sigIdx !== -1 ? leadingWhitespace(lines[sigIdx]!) : fallbackMember;
  const bodyIndent = methodIndent + fallbackUnit;

  const body =
    bodyLines.length > 0
      ? bodyLines.map((l) => `${bodyIndent}${l}`).join("\n")
      : `${bodyIndent}await Task.CompletedTask;`;
  const replacement = [
    `${methodIndent}${attribute}`,
    `${methodIndent}public async Task ${method}()`,
    `${methodIndent}{`,
    body,
    `${methodIndent}}`,
  ];

  if (sigIdx !== -1) {
    // Walk forward to the opening `{` of this method (skipping braces inside
    // strings/comments via the mask), then count braces to find its match.
    let openLine = -1;
    let openCol = -1;
    for (let i = sigIdx; i < lines.length && openLine === -1; i++) {
      const ln = lines[i]!;
      for (let j = 0; j < ln.length; j++) {
        if (ln[j] === "{" && inCode(i, j)) {
          openLine = i;
          openCol = j;
          break;
        }
      }
    }
    if (openLine === -1) {
      throw new Error(`Could not find opening brace for ${method}`);
    }
    let depth = 0;
    let closeLine = -1;
    let closeCol = -1;
    outer: for (let i = openLine; i < lines.length; i++) {
      const ln = lines[i]!;
      const startCol = i === openLine ? openCol : 0;
      for (let j = startCol; j < ln.length; j++) {
        if (!inCode(i, j)) continue;
        const ch = ln[j];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            closeLine = i;
            closeCol = j;
            break outer;
          }
        }
      }
    }
    if (closeLine === -1) {
      throw new Error(`Could not find closing brace for ${method}`);
    }
    // Capture the previous body so we can stash it into a sibling `.bak`
    // file when it is anything other than the default empty stub. The
    // body excludes the surrounding braces.
    const prevBodyStartAbs = lineStarts[openLine]! + openCol + 1;
    const prevBodyEndAbs = lineStarts[closeLine]! + closeCol;
    const prevBodyRaw = text.slice(prevBodyStartAbs, prevBodyEndAbs);
    const prevBodyTrimmed = prevBodyRaw.trim();
    const isDefaultStub =
      prevBodyTrimmed === "" ||
      prevBodyTrimmed === "return Task.CompletedTask;" ||
      prevBodyTrimmed === "await Task.CompletedTask;";
    if (!isDefaultStub) {
      backupPath = await writeHookBackup(
        project,
        fileRelPath,
        method,
        prevBodyRaw,
      );
    }
    // Walk back over any preceding attribute lines (including `[SetUp(Order = 1)]`
    // or trailing `// comment`) so we replace the whole hook cleanly.
    let startIdx = sigIdx;
    while (
      startIdx > 0 &&
      ATTRIBUTE_LINE_RE.test(lines[startIdx - 1]!) &&
      inCode(startIdx - 1, lines[startIdx - 1]!.search(/\S/))
    ) {
      startIdx--;
    }
    lines.splice(startIdx, closeLine - startIdx + 1, ...replacement);
  } else {
    // Append before the class's closing brace, found via the same mask-aware
    // brace count so braces in strings/comments don't fool us.
    let classCloseLine = -1;
    if (classInfo) {
      let depth = 0;
      const openAbs = lineStarts[classInfo.openLine]! +
        lines[classInfo.openLine]!.indexOf("{");
      for (let i = openAbs; i < text.length; i++) {
        if (mask[i] !== 1) continue;
        const ch = text[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            for (let k = 1; k < lineStarts.length; k++) {
              if (lineStarts[k]! > i) {
                classCloseLine = k - 1;
                break;
              }
              classCloseLine = k;
            }
            break;
          }
        }
      }
    }
    if (classCloseLine === -1) classCloseLine = lines.length - 1;
    lines.splice(classCloseLine, 0, "", ...replacement);
  }

  await fs.writeFile(abs, lines.join("\n"));
  return { backupPath };
}

/**
 * Locate the named hook in the given file and return the raw text between its
 * braces (without the braces themselves). Returns `null` when the file or the
 * hook can't be read, or the braces can't be matched. Used by both
 * `isHookDefaultStub` and the API endpoint that previews the hook body.
 */
export async function readHookBody(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
): Promise<string | null> {
  try {
    const abs = safeJoin(project.rootPath, fileRelPath);
    const text = await fs.readFile(abs, "utf8");
    const { method } = HOOK_INFO[hook];
    const lines = text.split(/\r?\n/);
    const mask = buildCodeMask(text);
    const lineStarts = computeLineStarts(text);
    const sigRe = new RegExp(
      String.raw`^\s*public\s+(?:async\s+)?Task\s+` +
        method +
        String.raw`\s*\(\s*\)`,
    );
    let sigIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!sigRe.test(lines[i]!)) continue;
      const firstNonWs = lines[i]!.search(/\S/);
      if (firstNonWs >= 0 && mask[lineStarts[i]! + firstNonWs] === 1) {
        sigIdx = i;
        break;
      }
    }
    if (sigIdx === -1) return null;
    let openLine = -1;
    let openCol = -1;
    for (let i = sigIdx; i < lines.length && openLine === -1; i++) {
      const ln = lines[i]!;
      for (let j = 0; j < ln.length; j++) {
        if (ln[j] === "{" && mask[lineStarts[i]! + j] === 1) {
          openLine = i;
          openCol = j;
          break;
        }
      }
    }
    if (openLine === -1) return null;
    let depth = 0;
    let closeLine = -1;
    let closeCol = -1;
    outer: for (let i = openLine; i < lines.length; i++) {
      const ln = lines[i]!;
      const startCol = i === openLine ? openCol : 0;
      for (let j = startCol; j < ln.length; j++) {
        if (mask[lineStarts[i]! + j] !== 1) continue;
        const ch = ln[j];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            closeLine = i;
            closeCol = j;
            break outer;
          }
        }
      }
    }
    if (closeLine === -1) return null;
    const bodyStart = lineStarts[openLine]! + openCol + 1;
    const bodyEnd = lineStarts[closeLine]! + closeCol;
    return text.slice(bodyStart, bodyEnd);
  } catch {
    return null;
  }
}

/**
 * Returns true if the named hook in the given file is still the default empty
 * stub (a single `return Task.CompletedTask;` line). Used to warn when a real
 * recording would be overwritten.
 */
export async function isHookDefaultStub(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
): Promise<boolean> {
  const body = await readHookBody(project, fileRelPath, hook);
  if (body === null) return true;
  const trimmed = body.trim();
  return trimmed === "return Task.CompletedTask;" || trimmed === "";
}

/**
 * Strip the common leading-whitespace indent from the lines of a hook body so
 * the preview shown in the UI doesn't drag along the class/method indentation.
 * Blank lines at the very top and bottom are removed; interior blank lines
 * are preserved.
 */
export function dedentHookBody(body: string): string {
  const rawLines = body.split(/\r?\n/);
  let start = 0;
  let end = rawLines.length;
  while (start < end && rawLines[start]!.trim() === "") start++;
  while (end > start && rawLines[end - 1]!.trim() === "") end--;
  if (start >= end) return "";
  const lines = rawLines.slice(start, end);
  let common = Infinity;
  for (const ln of lines) {
    if (ln.trim() === "") continue;
    const m = ln.match(/^[\t ]*/);
    const w = m ? m[0].length : 0;
    if (w < common) common = w;
    if (common === 0) break;
  }
  if (!Number.isFinite(common) || common === 0) return lines.join("\n");
  return lines.map((ln) => (ln.length >= common ? ln.slice(common) : ln)).join("\n");
}
