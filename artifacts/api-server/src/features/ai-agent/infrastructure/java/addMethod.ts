import { renderJavaTest } from "./renderers";
import type { JavaMethodChunk, JavaTestArgs } from "./types";

/**
 * Render a single new test/hook method (annotations + signature +
 * body) plus the import lines it needs, by reusing the full-class
 * renderer and slicing the imports + method body out of it.
 */
export function renderJavaMethodChunk(args: JavaTestArgs): JavaMethodChunk {
  const full = renderJavaTest(args);
  const lines = full.split("\n");
  const imports = lines
    .filter((l) => /^\s*import\s+/.test(l))
    .map((l) => l.trim());
  // Method body lives between the first `public class … {` line and
  // the very last `}` line. The renderers always emit a single
  // top-level class per file, so this is well-defined.
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^public class [A-Za-z_]\w*\s*\{$/.test(lines[i]!)) {
      start = i + 1;
      break;
    }
  }
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]!.trim() === "}") {
      end = i;
      break;
    }
  }
  const method =
    start >= 0 && end > start ? lines.slice(start, end).join("\n").replace(/^\n+|\n+$/g, "") : "";
  return { imports, method };
}

/**
 * Inject a rendered method chunk into an existing Java source file:
 *  - extra imports (deduped against existing lines) inserted after the
 *    last `import …;` (or after the package statement if none yet),
 *  - method body inserted just before the closing `}` of the named
 *    class. The closing brace search is depth-counted from the
 *    declaration so nested classes don't trip it up.
 */
export function injectMethodIntoExistingJava(
  src: string,
  className: string,
  chunk: JavaMethodChunk,
): string {
  const existingImports = new Set(
    src
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^import\s+/.test(l)),
  );
  const newImports = chunk.imports.filter((l) => !existingImports.has(l));

  // Insert new imports after the last existing import line; fall back
  // to right after the package statement.
  let withImports = src;
  if (newImports.length > 0) {
    const lines = src.split("\n");
    let insertAt = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (/^\s*import\s+/.test(lines[i]!)) insertAt = i;
    }
    if (insertAt < 0) {
      for (let i = 0; i < lines.length; i += 1) {
        if (/^\s*package\s+[\w.]+\s*;/.test(lines[i]!)) {
          insertAt = i;
          break;
        }
      }
    }
    if (insertAt < 0) insertAt = 0;
    const before = lines.slice(0, insertAt + 1);
    const after = lines.slice(insertAt + 1);
    // Ensure a blank separator after imports for readability.
    const sep = after[0] === "" ? [] : [""];
    withImports = [...before, ...newImports, ...sep, ...after].join("\n");
  }

  // Find the named class declaration and its matching closing brace.
  const classRe = new RegExp(
    `\\bclass\\s+${className.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b[^{]*\\{`,
  );
  const m = classRe.exec(withImports);
  if (!m) {
    // Should never happen — caller validated declaredClass.
    return `${withImports}\n${chunk.method}\n`;
  }
  const openIdx = m.index + m[0].length; // first char inside class body
  let depth = 1;
  let closeIdx = -1;
  for (let i = openIdx; i < withImports.length; i += 1) {
    const ch = withImports[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx < 0) return `${withImports}\n${chunk.method}\n`;
  const before = withImports.slice(0, closeIdx);
  const after = withImports.slice(closeIdx);
  const trimmedBefore = before.replace(/\s+$/, "");
  return `${trimmedBefore}\n\n${chunk.method}\n${after}`;
}
