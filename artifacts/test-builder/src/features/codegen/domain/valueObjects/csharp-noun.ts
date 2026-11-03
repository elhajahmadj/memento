// C# noun normalizer/decorator pair — domain value object for the
// codegen feature. Pure, framework-agnostic. The backend
// (artifacts/api-server/src/lib/recorder/codegen.ts → `normalizeNounForCsharp`,
// `csharpMethodNameFromNoun`) keeps an independent copy because the
// api-server package cannot import from artifacts/test-builder. Both
// sides MUST stay in lock-step so the live preview the user sees
// matches the value the server stores. A parity test in
// `__tests__/csharp-noun.test.ts` covers the documented contract.

const CSHARP_KNOWN_VERBS = ["Click", "Fill", "Check", "Select"] as const;

// Action-type strings the workbench may pass in. The backend's RecordedAction
// type is wider (`navigate`, `assert`, etc.) — anything outside the four known
// C# verbs falls through to `Click`, matching the backend default.
export type CSharpActionType = string;

export function normalizeNounForCsharp(name: string): string {
  let s = (name ?? "").trim();
  for (const v of CSHARP_KNOWN_VERBS) {
    if (
      s.length > v.length &&
      s.startsWith(v) &&
      /[A-Z]/.test(s.charAt(v.length))
    ) {
      s = s.slice(v.length);
      break;
    }
  }
  if (s.length > "Async".length && s.endsWith("Async")) {
    s = s.slice(0, -"Async".length);
  }
  return s;
}

export function csharpVerbForActionType(type: CSharpActionType): string {
  switch (type) {
    case "fill":
      return "Fill";
    case "check":
      return "Check";
    case "select":
      return "Select";
    default:
      return "Click";
  }
}

export function csharpMethodNameFromNoun(
  type: CSharpActionType,
  noun: string,
): string {
  return `${csharpVerbForActionType(type)}${noun}Async`;
}

/**
 * Append the `Async` suffix to a C# test-method name if it isn't already
 * present. Mirror of the server-side `ensureAsyncSuffix` in
 * `artifacts/api-server/src/features/codegen/infrastructure/codegen.ts`
 * — both sides MUST stay in lock-step so the dialog's live preview
 * matches the value the server stores.
 *
 * Case-sensitive (matches existing convention) and idempotent.
 * Whitespace is trimmed first.
 */
export function ensureAsyncSuffix(name: string): string {
  const s = (name ?? "").trim();
  if (s === "") return s;
  if (s.endsWith("Async")) return s;
  return `${s}Async`;
}
