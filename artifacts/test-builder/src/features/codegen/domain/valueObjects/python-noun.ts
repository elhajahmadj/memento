// Python noun normalizer/decorator pair — domain value object for the
// codegen feature. Pure, framework-agnostic. See csharp-noun.ts for the
// parity-with-backend rationale; the backend mirror lives in
// artifacts/api-server/src/lib/recorder/pythonCodegen.ts.

const PYTHON_KNOWN_VERBS = ["click", "fill", "check", "select"] as const;

export type PythonActionType = string;

/** PascalCase / camelCase / mixed → snake_case (`UserName` → `user_name`). */
function toSnake(s: string): string {
  if (!s) return "";
  // Insert underscores before runs of caps, lower-case everything, and
  // collapse runs of non-identifier chars into a single underscore.
  let out = s.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  out = out.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
  out = out.toLowerCase();
  out = out.replace(/[^a-z0-9_]+/g, "_");
  out = out.replace(/_+/g, "_");
  out = out.replace(/^_+|_+$/g, "");
  return out;
}

/**
 * Strip the Python-naming-convention decorations (leading `${verb}_`)
 * from a user-typed action name so we always store the bare snake_case
 * noun. Tolerant of mixed-case input — converts PascalCase /
 * camelCase to snake_case first so the user can type `LoginButton`,
 * `loginButton`, `login_button`, or `click_login_button` and end up
 * with the same stored noun.
 */
export function normalizeNounForPython(name: string): string {
  let s = (name ?? "").trim();
  if (!s) return s;
  s = toSnake(s);
  for (const v of PYTHON_KNOWN_VERBS) {
    const prefix = `${v}_`;
    if (s.length > prefix.length && s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  return s;
}

export function pythonVerbForActionType(type: PythonActionType): string {
  switch (type) {
    case "fill":
      return "fill";
    case "check":
      return "check";
    case "select":
      return "select";
    default:
      return "click";
  }
}

export function pythonMethodNameFromNoun(
  type: PythonActionType,
  noun: string,
): string {
  if (!noun) return pythonVerbForActionType(type);
  return `${pythonVerbForActionType(type)}_${noun}`;
}
