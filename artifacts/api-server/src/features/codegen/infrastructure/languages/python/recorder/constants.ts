import path from "node:path";
import fs from "node:fs/promises";
import type { AiRunReport, AiRunStep } from "@/features/ai-agent/domain/types";
import { deriveUrlName } from "@/features/ai-agent/infrastructure/urlNaming";
import { escapePy, inferFieldName, pyConstName, upperSnake } from "./helpers";

export function collectPyConstants(steps: AiRunStep[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const step of steps) {
    for (const c of step.playwrightCalls ?? []) {
      if (c.method === "page.fill" && c.value !== undefined) {
        const field = inferFieldName(step) ?? "value";
        out.set(upperSnake(field) || "VALUE", String(c.value));
      }
    }
  }
  return out;
}

export function renderPyConstants(consts: Map<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of consts.entries()) {
    lines.push(`${k} = "${escapePy(v)}"`);
  }
  return lines.join("\n") + "\n";
}

export function collectNamedUrlsPy(report: AiRunReport): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of report.steps ?? []) {
    for (const c of s.playwrightCalls ?? []) {
      if (c.method === "page.goto" && c.args?.[0]) {
        const url = String(c.args[0]);
        const hit = report.urlNames?.find((u) => u.url === url);
        const baseName = hit?.name ?? deriveUrlName(url);
        const key = pyConstName(baseName);
        if (!out.has(key)) out.set(key, url);
      }
    }
  }
  return out;
}

export async function upsertPyConfig(
  abs: string,
  _fallbackUrl: string,
  named: Map<string, string>,
): Promise<boolean> {
  let txt = "";
  let pre = false;
  try {
    txt = await fs.readFile(abs, "utf8");
    pre = true;
  } catch {
    // missing — we'll create it
  }
  const lines = txt.length > 0 ? txt.split("\n") : [];
  const present = new Set(
    lines
      .map((l) => l.match(/^([A-Z][A-Z0-9_]*)\s*=/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => m[1]!),
  );
  let changed = false;
  // Only retain legacy `BASE_URL` if a previous version of the file
  // already declared one — never re-seed it when absent.
  for (const [k, v] of named.entries()) {
    if (present.has(k)) continue;
    lines.push(`${k} = "${escapePy(v)}"`);
    present.add(k);
    changed = true;
  }
  if (!changed && pre) return false;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const out = lines.join("\n").replace(/\n+$/, "") + "\n";
  await fs.writeFile(abs, out);
  return true;
}
