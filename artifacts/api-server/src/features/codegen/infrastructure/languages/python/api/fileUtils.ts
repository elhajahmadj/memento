import fs from "node:fs/promises";
import path from "node:path";

export function relPosix(rootPath: string, abs: string): string {
  return path.relative(rootPath, abs).split(path.sep).join("/");
}

export async function readOrEmpty(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

export function insertBeforeLine(
  lines: string[],
  idx: number,
  line: string,
): string {
  return [...lines.slice(0, idx), line, ...lines.slice(idx)].join("\n");
}

export function insertBlockBeforeLine(
  lines: string[],
  idx: number,
  block: string[],
): string {
  return [...lines.slice(0, idx), ...block, ...lines.slice(idx)].join("\n");
}

export function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : s + "\n";
}
