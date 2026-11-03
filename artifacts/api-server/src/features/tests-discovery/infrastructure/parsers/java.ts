import type { ParsedMethod } from "../../domain/types";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const TAG_ANNOTATION_RE = /@Tag\s*\(\s*"([^"]+)"\s*\)/g;

function extractTagAnnotations(attrBlock: string): string[] {
  const out: string[] = [];
  for (const m of attrBlock.matchAll(TAG_ANNOTATION_RE)) out.push(m[1]!);
  return out;
}

interface JavaClass {
  name: string;
  classTags: string[];
  body: string;
}

function sliceBracedBody(src: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

function extractClasses(src: string): JavaClass[] {
  const out: JavaClass[] = [];
  const re =
    /((?:@[\w.]+(?:\s*\([^)]*\))?\s*)*)((?:public|protected|private|static|abstract|final|sealed|\s)*)class\s+([A-Za-z_]\w*)[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const attrBlock = m[1] ?? "";
    const modifiers = m[2] ?? "";
    const name = m[3]!;
    // Skip `abstract class …` declarations. Abstract base fixtures
    // (e.g. `BaseTest`) are scaffolding that subclasses inherit from;
    // they never run as a JUnit test fixture themselves, so the
    // discovery tree should not surface them in the "Add method to
    // existing suite" dropdown.
    if (/\babstract\b/.test(modifiers)) continue;
    const openIdx = re.lastIndex - 1; // the `{` consumed above
    const body = sliceBracedBody(src, openIdx);
    if (body === null) continue;
    out.push({
      name,
      classTags: extractTagAnnotations(attrBlock),
      body,
    });
  }
  return out;
}

/**
 * Parse a JUnit 5 test file. Picks up `package …;`, every class with a
 * `@Test`-annotated method, and merges class-level `@Tag("…")` with
 * method-level `@Tag("…")`.
 *
 * IDs use JUnit's standard `com.pkg.ClassName#methodName` form.
 */
export function parseJavaFile(rawSource: string): {
  packageName: string | null;
  methods: ParsedMethod[];
} {
  const src = stripComments(rawSource);
  const pkgMatch = src.match(/^\s*package\s+([\w.]+)\s*;/m);
  const packageName = pkgMatch ? pkgMatch[1]! : null;

  const methods: ParsedMethod[] = [];
  for (const cls of extractClasses(src)) {
    // Find @Test-annotated methods in the class body.
    const methodRe =
      /((?:@[\w.]+(?:\s*\([^)]*\))?\s*)+)(?:public|private|protected|static|final|\s)+[\w<>?,\s.\[\]]+?\s+([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = methodRe.exec(cls.body)) !== null) {
      const attrBlock = m[1] ?? "";
      if (!/@Test\b/.test(attrBlock)) continue;
      const name = m[2]!;
      const id = packageName
        ? `${packageName}.${cls.name}#${name}`
        : `${cls.name}#${name}`;
      methods.push({
        id,
        name,
        tags: [...cls.classTags, ...extractTagAnnotations(attrBlock)],
      });
    }
  }
  return { packageName, methods };
}
