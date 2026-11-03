/**
 * Find the index of the matching `}` given an index *just after* the
 * opening `{`. Skips over string literals so `{` / `}` characters that
 * appear inside `"..."`, `'...'` or backtick template literals (without
 * `${...}` expressions — which our generated code never produces) do not
 * confuse the brace counter.
 */
export function findMatchingBrace(source: string, openBodyStart: number): number {
  let depth = 1;
  for (let i = openBodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) {
        i++;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function insertAtClose(
  source: string,
  outerClose: number,
  insertion: string,
): string {
  let cursor = outerClose;
  while (cursor > 0 && /[ \t]/.test(source[cursor - 1] ?? "")) cursor--;
  if (source[cursor - 1] === "\n") {
    return source.slice(0, cursor) + insertion + source.slice(cursor);
  }
  return source.slice(0, outerClose) + `\n${insertion}` + source.slice(outerClose);
}

export function replaceEntryIfPresent(
  source: string,
  bodyStart: number,
  bodyEnd: number,
  name: string,
  newLine: string,
): string | null {
  const re = new RegExp(`^[\\t ]*${name}\\s*:\\s*[^,\\n]*,?\\s*$`, "m");
  const region = source.slice(bodyStart, bodyEnd);
  const m = re.exec(region);
  if (!m) return null;
  const absStart = bodyStart + m.index;
  const absEnd = absStart + m[0].length;
  return source.slice(0, absStart) + newLine + source.slice(absEnd);
}
