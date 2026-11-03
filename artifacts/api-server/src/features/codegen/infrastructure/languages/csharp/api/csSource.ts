/**
 * Tiny C# source-manipulation primitives shared across the per-section
 * API codegen emitters (brace matching, in-place constant replacement,
 * idempotent `using` insertion). Split out so the section emitters can
 * import the same brace walker without circular references.
 */

export function findMatchingBrace(source: string, openBodyStart: number): number {
  // We were given the index *after* the `{`, so depth starts at 1.
  let depth = 1;
  for (let i = openBodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function replaceConstantIfPresent(
  source: string,
  bodyStart: number,
  bodyEnd: number,
  name: string,
  newLine: string,
): string | null {
  const re = new RegExp(
    `^[\\t ]*public const string ${name}\\s*=\\s*[^;]*;\\s*$`,
    "m",
  );
  const region = source.slice(bodyStart, bodyEnd);
  const m = re.exec(region);
  if (!m) return null;
  const absStart = bodyStart + m.index;
  const absEnd = absStart + m[0].length;
  return source.slice(0, absStart) + newLine + source.slice(absEnd);
}

export function ensureUsings(source: string, namespaces: string[]): string {
  let out = source;
  const missing: string[] = [];
  for (const ns of namespaces) {
    const re = new RegExp(
      `^\\s*using\\s+${ns.replace(/\./g, "\\.")}\\s*;`,
      "m",
    );
    if (!re.test(out)) missing.push(ns);
  }
  if (missing.length === 0) return out;
  // Insert after the last existing `using` line; otherwise at top of file.
  const lastUsing = /(^|\n)using\s+[^;]+;\s*\n/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = lastUsing.exec(out)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  const block = missing.map((ns) => `using ${ns};\n`).join("");
  if (lastEnd > 0) {
    return out.slice(0, lastEnd) + block + out.slice(lastEnd);
  }
  return block + out;
}
