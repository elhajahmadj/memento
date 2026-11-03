export const PY_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const HTTP_VERBS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export function ident(name: string, label: string): void {
  if (!PY_IDENT.test(name)) {
    throw new Error(`${label} must be a valid Python identifier: ${name}`);
  }
}

export function pyStr(s: string): string {
  return JSON.stringify(s);
}

/** Convert CamelCase / PascalCase to snake_case (used for file naming). */
export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/** Compute the per-suite assistant class name for a given test class. */
export function assistantClassNameFor(testClassName: string): string {
  return `${testClassName}APITestingAssistants`;
}

/**
 * Strip the `Async` suffix off helper method names (a C#-ism we keep at
 * the spec level for cross-language compatibility) before emitting the
 * Python method. Other names pass through unchanged.
 */
export function pyMethodName(name: string): string {
  return snakeCase(name.replace(/Async$/, ""));
}
