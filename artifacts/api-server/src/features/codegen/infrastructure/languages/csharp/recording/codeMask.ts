/**
 * Low-level C# source-text helpers shared by the hook / test-method
 * editors. These functions parse C# only enough to skip strings,
 * comments, and char literals when counting braces or scanning lines —
 * a full parser would be overkill for the surgical edits the recorder
 * needs to do.
 */

/**
 * Build a per-character mask over a C# source string where `1` means the
 * character is "real code" (not inside a string, char literal, or comment).
 * Handles `//` line comments, `/* ... *\/` block comments, char literals,
 * regular `"..."` strings (with `\` escapes), verbatim `@"..."` strings
 * (with `""` escape), and interpolated `$"..."` / `$@"..."` strings
 * (with `{{`/`}}` escapes and brace-balanced interpolation expressions).
 * Used so brace-counting passes ignore syntactic noise inside literals.
 */
export function buildCodeMask(text: string): Uint8Array {
  const n = text.length;
  const mask = new Uint8Array(n);
  mask.fill(1);
  const markRange = (start: number, end: number) => {
    for (let k = start; k < end; k++) mask[k] = 0;
  };
  let i = 0;
  while (i < n) {
    const c = text[i]!;
    const c1 = i + 1 < n ? text[i + 1]! : "";
    const c2 = i + 2 < n ? text[i + 2]! : "";
    if (c === "/" && c1 === "/") {
      const start = i;
      while (i < n && text[i] !== "\n") i++;
      markRange(start, i);
      continue;
    }
    if (c === "/" && c1 === "*") {
      const start = i;
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      if (i < n) i += 2;
      markRange(start, i);
      continue;
    }
    if (c === "'") {
      const start = i;
      i++;
      while (i < n && text[i] !== "'") {
        if (text[i] === "\\" && i + 1 < n) i += 2;
        else i++;
      }
      if (i < n) i++;
      markRange(start, i);
      continue;
    }
    let prefixLen = 0;
    let isVerbatim = false;
    let isInterpolated = false;
    if (c === '"') {
      prefixLen = 1;
    } else if (c === "@" && c1 === '"') {
      prefixLen = 2;
      isVerbatim = true;
    } else if (c === "$" && c1 === '"') {
      prefixLen = 2;
      isInterpolated = true;
    } else if (
      ((c === "$" && c1 === "@") || (c === "@" && c1 === "$")) &&
      c2 === '"'
    ) {
      prefixLen = 3;
      isVerbatim = true;
      isInterpolated = true;
    }
    if (prefixLen > 0) {
      const start = i;
      i += prefixLen;
      let interpDepth = 0;
      while (i < n) {
        const ch = text[i]!;
        const nx = i + 1 < n ? text[i + 1]! : "";
        if (interpDepth > 0) {
          if (ch === "{") {
            interpDepth++;
            i++;
            continue;
          }
          if (ch === "}") {
            interpDepth--;
            i++;
            continue;
          }
          if (ch === '"') {
            i++;
            while (i < n && text[i] !== '"') {
              if (text[i] === "\\" && i + 1 < n) i += 2;
              else i++;
            }
            if (i < n) i++;
            continue;
          }
          i++;
          continue;
        }
        if (isVerbatim) {
          if (ch === '"' && nx === '"') {
            i += 2;
            continue;
          }
          if (ch === '"') {
            i++;
            break;
          }
        } else {
          if (ch === "\\" && i + 1 < n) {
            i += 2;
            continue;
          }
          if (ch === '"') {
            i++;
            break;
          }
          if (ch === "\n") {
            // unterminated string — bail out so we don't swallow the rest of the file
            i++;
            break;
          }
        }
        if (isInterpolated) {
          if (ch === "{" && nx === "{") {
            i += 2;
            continue;
          }
          if (ch === "}" && nx === "}") {
            i += 2;
            continue;
          }
          if (ch === "{") {
            interpDepth = 1;
            i++;
            continue;
          }
        }
        i++;
      }
      markRange(start, i);
      continue;
    }
    i++;
  }
  return mask;
}

export function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

export function leadingWhitespace(s: string): string {
  const m = s.match(/^[\t ]*/);
  return m ? m[0] : "";
}

export const ATTRIBUTE_LINE_RE =
  /^\s*\[[^\]]*\]\s*(?:\/\/.*|\/\*[\s\S]*?\*\/\s*)?$/;

export interface ClassInfo {
  /** Line index of the line containing the class's opening `{`. */
  openLine: number;
  /** Whitespace prefix of the class declaration line (e.g. `"    "`). */
  declIndent: string;
  /** Whitespace prefix to use for class members (attributes/methods). */
  memberIndent: string;
  /** One indentation unit (e.g. `"    "` or `"\t"`). */
  unit: string;
}

/**
 * Locate the test class's opening brace and infer the indentation style used
 * inside it so generated hooks visually match the surrounding code instead of
 * forcing 4-space indentation.
 */
export function detectClassInfo(
  text: string,
  mask: Uint8Array,
  lines: string[],
  lineStarts: number[],
): ClassInfo | null {
  // Walk the whole file with the mask; the position where depth reaches 2
  // for the first time is the class's opening brace (depth 1 = namespace).
  let depth = 0;
  let classOpenAbs = -1;
  for (let i = 0; i < text.length; i++) {
    if (mask[i] !== 1) continue;
    const ch = text[i];
    if (ch === "{") {
      depth++;
      if (depth === 2) {
        classOpenAbs = i;
        break;
      }
    } else if (ch === "}") {
      depth--;
    }
  }
  if (classOpenAbs === -1) return null;
  // Map the absolute index to a line index.
  let openLine = 0;
  for (let i = 1; i < lineStarts.length; i++) {
    if (lineStarts[i]! > classOpenAbs) {
      openLine = i - 1;
      break;
    }
    openLine = i;
  }
  // The class declaration line might be the brace line itself, or the line
  // above when the brace sits on its own line.
  let declIndent = leadingWhitespace(lines[openLine]!);
  if (lines[openLine]!.trim() === "{") {
    for (let k = openLine - 1; k >= 0; k--) {
      if (lines[k]!.trim()) {
        declIndent = leadingWhitespace(lines[k]!);
        break;
      }
    }
  }
  // First non-blank line after the opening brace gives us the member indent.
  let memberIndent: string | null = null;
  for (let k = openLine + 1; k < lines.length; k++) {
    const ln = lines[k]!;
    if (!ln.trim()) continue;
    memberIndent = leadingWhitespace(ln);
    break;
  }
  if (memberIndent === null) {
    memberIndent = declIndent + (declIndent.includes("\t") ? "\t" : "    ");
  }
  let unit: string;
  if (
    memberIndent.length > declIndent.length &&
    memberIndent.startsWith(declIndent)
  ) {
    unit = memberIndent.slice(declIndent.length);
  } else {
    unit = declIndent.includes("\t") ? "\t" : "    ";
  }
  return { openLine, declIndent, memberIndent, unit };
}

/**
 * Collect the names of every `public ... Task Name(...)` method declared in
 * the given C# source, ignoring matches inside strings or comments.
 */
export function collectMethodNames(text: string, mask: Uint8Array): Set<string> {
  const names = new Set<string>();
  const lines = text.split(/\r?\n/);
  const lineStarts = computeLineStarts(text);
  const re = /^\s*public\s+(?:async\s+)?Task\s+([A-Za-z_]\w*)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]!);
    if (!m) continue;
    const firstNonWs = lines[i]!.search(/\S/);
    if (firstNonWs < 0) continue;
    if (mask[lineStarts[i]! + firstNonWs] !== 1) continue;
    names.add(m[1]!);
  }
  return names;
}

/**
 * Find the line range covering an existing `[Test]` (or other-attribute)
 * method declaration so callers can replace it in place. Returns null when
 * the method is not declared in this file.
 */
export function findMethodLineRange(
  _text: string,
  mask: Uint8Array,
  lines: string[],
  lineStarts: number[],
  methodName: string,
): { startLine: number; endLine: number } | null {
  const inCode = (lineIdx: number, charIdx: number) =>
    mask[lineStarts[lineIdx]! + charIdx] === 1;
  const sigRe = new RegExp(
    String.raw`^\s*public\s+(?:async\s+)?Task\s+` +
      methodName +
      String.raw`\s*\(`,
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
  if (sigIdx === -1) return null;
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
  if (openLine === -1) return null;
  let depth = 0;
  let closeLine = -1;
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
          break outer;
        }
      }
    }
  }
  if (closeLine === -1) return null;
  // Walk back over preceding attribute lines (e.g. `[Test]`).
  let startIdx = sigIdx;
  while (
    startIdx > 0 &&
    ATTRIBUTE_LINE_RE.test(lines[startIdx - 1]!) &&
    inCode(startIdx - 1, lines[startIdx - 1]!.search(/\S/))
  ) {
    startIdx--;
  }
  return { startLine: startIdx, endLine: closeLine };
}
