import type { ParsedMethod } from "../../domain/types";

/**
 * Strip block + line comments so commented-out tests don't show up.
 * Strings are left alone — the parser only looks at JS/TS source
 * structure, never inside string literals beyond the title arg.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const TAG_RE = /@(\w+)/g;

function extractTagsFromTitle(title: string): string[] {
  const out: string[] = [];
  for (const m of title.matchAll(TAG_RE)) out.push(m[1]!);
  return out;
}

/**
 * Parse a Playwright `*.spec.ts` (or `.test.ts/.js`) file. Walks
 * `test.describe(title, fn)` and `test(title, fn)` calls, tracking
 * the describe stack so the method id can be reconstructed as
 * `describe > inner > test`. Tags are scraped from any `@word`
 * occurrence in the describe or test title (Playwright convention).
 */
export function parseNodeJsFile(rawSource: string): {
  methods: ParsedMethod[];
  isFixture: boolean;
} {
  const src = stripComments(rawSource);
  const methods: ParsedMethod[] = [];
  // A spec is "fixture-like" if it contains at least one `test(` or
  // `test.describe(` call. We surface fixture-only files (e.g. a
  // suite that only wires `test.describe(...)` blocks or that ships
  // hooks but no top-level `test(...)` yet) so the AI Agent's
  // "Add method to existing suite" dropdown can target them — the
  // exact requirement from task #102.
  let isFixture = false;

  // Single regex finds either `test.describe('…',` (with optional
  // .only/.skip/.serial chaining) or `test('…',` (also chainable).
  // Brace tracking is done separately so we can pop describe frames.
  const callRe =
    /\b(test|it)(?:\.(?:describe|skip|only|fixme|serial|parallel))*\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2\s*,/g;
  // We also need to detect `}` that close describe blocks; do a
  // unified scan with both patterns.
  const tokens: Array<{ idx: number; kind: "call" | "open" | "close"; data?: { isDescribe: boolean; title: string } }> = [];

  let m: RegExpExecArray | null;
  while ((m = callRe.exec(src)) !== null) {
    const fullCall = m[0]!;
    const isDescribe = /\.describe\b/.test(fullCall);
    const title = m[3]!;
    tokens.push({
      idx: m.index,
      kind: "call",
      data: { isDescribe, title },
    });
  }

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") tokens.push({ idx: i, kind: "open" });
    else if (ch === "}") tokens.push({ idx: i, kind: "close" });
  }
  tokens.sort((a, b) => a.idx - b.idx);

  // Track describe frames: when we see a describe call, the next
  // `{` starts a new frame; the matching `}` pops it.
  const frameStack: Array<{ depth: number; describe: string }> = [];
  let braceDepth = 0;
  let pendingDescribe: string | null = null;

  for (const t of tokens) {
    if (t.kind === "open") {
      braceDepth += 1;
      if (pendingDescribe !== null) {
        frameStack.push({ depth: braceDepth, describe: pendingDescribe });
        pendingDescribe = null;
      }
    } else if (t.kind === "close") {
      while (frameStack.length > 0 && frameStack[frameStack.length - 1]!.depth === braceDepth) {
        frameStack.pop();
      }
      braceDepth -= 1;
    } else if (t.kind === "call") {
      pendingDescribe = null;
      const data = t.data!;
      // Any `test(` or `test.describe(` call qualifies this file as
      // a fixture-like spec; the discovery service uses this to keep
      // describe-only suites in the AI Agent dropdown even when the
      // file has zero top-level `test(...)` methods.
      isFixture = true;
      if (data.isDescribe) {
        pendingDescribe = data.title;
      } else {
        const path = [...frameStack.map((f) => f.describe), data.title];
        const id = path.join(" > ");
        const tags = path.flatMap(extractTagsFromTitle);
        methods.push({ id, name: data.title, tags });
      }
    }
  }

  return { methods, isFixture };
}
