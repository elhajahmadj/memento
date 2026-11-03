// Node.js noun normalizer/decorator pair — domain value object for the
// codegen feature. Pure, framework-agnostic. See csharp-noun.ts for the
// parity-with-backend rationale; the backend mirror lives in
// artifacts/api-server/src/lib/recorder/nodejsCodegen.ts.

const NODEJS_KNOWN_VERBS = ["click", "fill", "check", "select"] as const;

export type NodejsActionType = string;

/** PASCAL/anything → `lowerCamel` (`user_name` / `UserName` → `userName`). */
function toCamel(s: string): string {
  const parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  // Match backend nodejsCodegen.ts:`toCamel` — when the input contains no
  // identifier characters at all the helper falls back to the literal
  // `"x"` (a legal JS identifier) so the wrapping normalizer always
  // produces a usable noun even for pathological input. Returning `""`
  // here would cause the FE preview and BE-stored value to drift.
  if (parts.length === 0) return "x";
  const head = parts[0]!;
  const rest = parts
    .slice(1)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const camel = head.charAt(0).toLowerCase() + head.slice(1) + rest.join("");
  return /^[A-Za-z_]/.test(camel) ? camel : `x${camel}`;
}

/**
 * Strip the Node.js-naming-convention decorations (leading verb prefix
 * before an uppercase letter) from a user-typed action name so we always
 * store the bare camelCase noun. Tolerant of mixed-case input — converts
 * snake_case / PascalCase to camelCase first so the user can type
 * `LoginButton`, `loginButton`, `click_login_button`, or `clickLoginButton`
 * and end up with the same stored noun.
 */
export function normalizeNounForNodejs(name: string): string {
  let s = (name ?? "").trim();
  if (!s) return s;
  s = toCamel(s);
  for (const v of NODEJS_KNOWN_VERBS) {
    if (
      s.length > v.length &&
      s.startsWith(v) &&
      /[A-Z]/.test(s.charAt(v.length))
    ) {
      const rest = s.slice(v.length);
      s = rest.charAt(0).toLowerCase() + rest.slice(1);
      break;
    }
  }
  return s;
}

export function nodejsVerbForActionType(type: NodejsActionType): string {
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

export function nodejsMethodNameFromNoun(
  type: NodejsActionType,
  noun: string,
): string {
  if (!noun) return nodejsVerbForActionType(type);
  const cap = noun.charAt(0).toUpperCase() + noun.slice(1);
  return `${nodejsVerbForActionType(type)}${cap}`;
}
