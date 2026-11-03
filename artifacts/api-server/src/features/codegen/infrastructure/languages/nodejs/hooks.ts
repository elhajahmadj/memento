import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import type { HookKind } from "@/features/codegen/infrastructure/codegen";
import { NODEJS_HOOK_INFO } from "./naming";

export interface HookSpan {
  defLine: number;
  endLine: number;
  defIndent: string;
  bodyIndent: string;
}

/**
 * Locate a hook fixture inside a `<suite>.spec.ts` file.
 */
export function findHookSpan(text: string, hook: HookKind): HookSpan | null {
  const lines = text.split(/\r?\n/);
  const api = NODEJS_HOOK_INFO[hook].api;
  const escapedApi = api.replace(/\./g, "\\.");
  const defRe = new RegExp(
    String.raw`^(\s*)` + escapedApi + String.raw`\s*\(\s*async\s*\(`,
  );
  let defLine = -1;
  let defIndent = "";
  for (let i = 0; i < lines.length; i++) {
    const m = defRe.exec(lines[i]!);
    if (m) {
      defLine = i;
      defIndent = m[1]!;
      break;
    }
  }
  if (defLine === -1) return null;

  const closeRe = new RegExp(String.raw`^${defIndent}\}\s*\)\s*;\s*$`);
  let endLine = -1;
  for (let i = defLine + 1; i < lines.length; i++) {
    if (closeRe.test(lines[i]!)) {
      endLine = i;
      break;
    }
  }
  if (endLine === -1) return null;
  return {
    defLine,
    endLine,
    defIndent,
    bodyIndent: `${defIndent}  `,
  };
}

export async function readHookBody(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(safeJoin(project.rootPath, fileRelPath), "utf8");
  } catch {
    return null;
  }
  const span = findHookSpan(text, hook);
  if (!span) return null;
  const lines = text.split(/\r?\n/);
  return lines.slice(span.defLine + 1, span.endLine).join("\n");
}

export async function isHookDefaultStub(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
): Promise<boolean> {
  const body = await readHookBody(project, fileRelPath, hook);
  if (body === null) return true;
  const meaningful = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//"));
  return meaningful.length === 0;
}

export interface ReplaceHookBodyResult {
  backupPath: string | null;
}

export async function replaceHookBody(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
  bodyLines: string[],
): Promise<ReplaceHookBodyResult> {
  const abs = safeJoin(project.rootPath, fileRelPath);
  const original = await fs.readFile(abs, "utf8");
  const span = findHookSpan(original, hook);
  if (!span) {
    throw new Error(
      `Hook '${NODEJS_HOOK_INFO[hook].method}' not found in ${fileRelPath}`,
    );
  }
  const lines = original.split(/\r?\n/);
  const newBody =
    bodyLines.length > 0 ? bodyLines.map((l) => `${span.bodyIndent}${l}`) : [];
  const next = [
    ...lines.slice(0, span.defLine + 1),
    ...newBody,
    ...lines.slice(span.endLine),
  ];
  await fs.writeFile(abs, next.join("\n"));
  return { backupPath: null };
}
