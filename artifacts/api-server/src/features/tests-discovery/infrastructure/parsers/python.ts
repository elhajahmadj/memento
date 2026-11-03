import type { ParsedMethod } from "../../domain/types";

const PYTESTMARK_RE = /^\s*pytestmark\s*=\s*(.+)$/m;
const MARK_RE = /pytest\.mark\.([a-zA-Z_][\w]*)/g;

function extractMarksFromString(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(MARK_RE)) out.push(m[1]!);
  return out;
}

function moduleMarks(src: string): string[] {
  const m = PYTESTMARK_RE.exec(src);
  if (!m) return [];
  return extractMarksFromString(m[1]!);
}

interface PyClass {
  name: string;
  classMarks: string[];
  /** Lines (with leading indentation) that belong to this class body. */
  bodyStartLine: number;
  bodyEndLine: number;
}

/**
 * Parse a pytest test file. Returns leaf records keyed by the pytest
 * node id (`relative/path/file.py::Class::test_method`, omitting the
 * class segment for module-level functions). Caller is responsible
 * for prefixing the file path.
 *
 * We work line-by-line so we can track decorator stacks and indentation
 * (Python's structure is whitespace-sensitive, and regex-only parsing
 * would mis-attribute decorators).
 */
export function parsePythonFile(rawSource: string): { methods: ParsedMethod[] } {
  const lines = rawSource.split(/\r?\n/);
  const moduleLevelMarks = moduleMarks(rawSource);
  const classes: PyClass[] = [];

  // First pass — find class declarations and their decorator marks.
  let pendingDecoratorMarks: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const stripped = line.trimStart();
    const indent = line.length - stripped.length;
    if (stripped.startsWith("@")) {
      pendingDecoratorMarks.push(...extractMarksFromString(stripped));
      continue;
    }
    const cls = stripped.match(/^class\s+([A-Za-z_]\w*)\s*[\(:]/);
    // Pytest only collects methods on classes whose name starts with
    // `Test` (and that don't define an `__init__`). Mirror that here so
    // helper classes don't pollute the discovery tree.
    if (cls && indent === 0 && cls[1]!.startsWith("Test")) {
      // class body runs until next top-level statement
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j += 1) {
        const l = lines[j]!;
        if (l.trim() === "") continue;
        const ind = l.length - l.trimStart().length;
        if (ind === 0) {
          end = j;
          break;
        }
      }
      classes.push({
        name: cls[1]!,
        classMarks: pendingDecoratorMarks.slice(),
        bodyStartLine: i + 1,
        bodyEndLine: end,
      });
      pendingDecoratorMarks = [];
      continue;
    }
    if (stripped.length > 0) pendingDecoratorMarks = [];
  }

  const methods: ParsedMethod[] = [];

  function findFunctions(
    fromLine: number,
    toLine: number,
    requiredIndent: number | null,
    enclosingClass: PyClass | null,
  ): void {
    let pending: string[] = [];
    for (let i = fromLine; i < toLine; i += 1) {
      const line = lines[i]!;
      const stripped = line.trimStart();
      const indent = line.length - stripped.length;
      if (stripped.startsWith("@")) {
        pending.push(...extractMarksFromString(stripped));
        continue;
      }
      if (stripped.startsWith("async def ") || stripped.startsWith("def ")) {
        const m = stripped.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)/);
        if (
          m &&
          (requiredIndent === null || indent === requiredIndent) &&
          m[1]!.startsWith("test_")
        ) {
          const name = m[1]!;
          const tags = [
            ...moduleLevelMarks,
            ...(enclosingClass?.classMarks ?? []),
            ...pending,
          ];
          const id = enclosingClass
            ? `${enclosingClass.name}::${name}`
            : name;
          methods.push({ id, name, tags });
        }
        pending = [];
        continue;
      }
      if (stripped.length > 0) pending = [];
    }
  }

  // Module-level test functions (indent 0).
  // Skip lines that fall inside any class body.
  const inClassRanges = classes.map((c) => [c.bodyStartLine, c.bodyEndLine] as const);
  function isInsideClass(lineIdx: number): boolean {
    return inClassRanges.some(([s, e]) => lineIdx >= s && lineIdx < e);
  }
  let pending: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const stripped = line.trimStart();
    const indent = line.length - stripped.length;
    if (isInsideClass(i)) {
      pending = [];
      continue;
    }
    if (stripped.startsWith("@")) {
      pending.push(...extractMarksFromString(stripped));
      continue;
    }
    if ((stripped.startsWith("def ") || stripped.startsWith("async def ")) && indent === 0) {
      const m = stripped.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)/);
      if (m && m[1]!.startsWith("test_")) {
        const name = m[1]!;
        methods.push({
          id: name,
          name,
          tags: [...moduleLevelMarks, ...pending],
        });
      }
      pending = [];
      continue;
    }
    if (stripped.length > 0) pending = [];
  }

  // Class-method tests — find at the inner indent level (first
  // non-blank line of the class body sets the expected indent).
  for (const cls of classes) {
    let inner: number | null = null;
    for (let i = cls.bodyStartLine; i < cls.bodyEndLine; i += 1) {
      const l = lines[i]!;
      if (l.trim() === "") continue;
      inner = l.length - l.trimStart().length;
      break;
    }
    findFunctions(cls.bodyStartLine, cls.bodyEndLine, inner, cls);
  }

  return { methods };
}
