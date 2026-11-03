import path from "node:path";
import fs from "node:fs/promises";
import { escapeTs } from "./helpers";

/**
 * Idempotently seed/update `tests/config.ts` with the named URL
 * constants collected from a run. Returns true when the file changed
 * (or was created).
 */
export async function upsertNodeConfig(
  abs: string,
  fallbackUrl: string,
  named: Map<string, string>,
): Promise<boolean> {
  let txt = "";
  let pre = false;
  try {
    txt = await fs.readFile(abs, "utf8");
    pre = true;
  } catch {
    // missing
  }
  void fallbackUrl;
  const lines = txt.length > 0 ? txt.split("\n") : [];
  const present = new Set(
    lines
      .map((l) => l.match(/^export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => m[1]!),
  );
  let changed = false;
  // Only retain legacy `BASE_URL` if a previous version of the file
  // already declared one — never re-seed it when absent. New files
  // get only the named URL constants below.
  for (const [k, v] of named.entries()) {
    if (present.has(k)) continue;
    lines.push(`export const ${k} = "${escapeTs(v)}";`);
    present.add(k);
    changed = true;
  }
  if (!changed && pre) return false;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const out = lines.join("\n").replace(/\n+$/, "") + "\n";
  await fs.writeFile(abs, out);
  return true;
}
