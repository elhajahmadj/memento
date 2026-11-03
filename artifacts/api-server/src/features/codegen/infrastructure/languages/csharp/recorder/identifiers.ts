/**
 * Identifier / string helpers shared across the recorder-side C#
 * emitter sections. Split out of the original
 * `csharpRecorderEmitter.ts` monolith (task #36).
 */

/**
 * Case-preserving PascalCase: splits on non-alphanumeric, capitalizes
 * the first letter of each word, and leaves internal characters alone.
 * Unlike `pascal()` from the parser (which lowercases internals and
 * would mangle existing identifiers like "ClickSignIn" -> "Clicksignin"),
 * this preserves already-cased segments coming from the LLM or rule
 * parser.
 */
export function pascal(input: string): string {
  const words = (input ?? "").replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/);
  if (words.length === 0 || (words.length === 1 && !words[0])) return "";
  return words
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join("");
}

/**
 * Sanitize an LLM/parser-produced method name so it's a valid C#
 * identifier. Strips non-alphanumerics, ensures it starts with a
 * letter, and removes a trailing `Async` so the emitter can append
 * `Async` itself (avoiding `FooAsyncAsync`).
 */
export function safeIdentifier(input: string, fallback: string): string {
  let s = (input ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (!s) return fallback;
  if (/^[0-9]/.test(s)) s = `_${s}`;
  if (s.endsWith("Async")) s = s.slice(0, -5);
  return s || fallback;
}

export function lowerFirst(s: string): string {
  if (!s) return s;
  return s[0]!.toLowerCase() + s.slice(1);
}

export function escapeCs(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function stripSuiteSuffix(s: string): string {
  const t = (s ?? "").trim();
  if (!t) return "Generated";
  if (/Tests$/.test(t)) return t.replace(/Tests$/, "");
  if (/Test$/.test(t)) return t.replace(/Test$/, "");
  if (/TestSuite$/.test(t)) return t.replace(/TestSuite$/, "");
  return t;
}
