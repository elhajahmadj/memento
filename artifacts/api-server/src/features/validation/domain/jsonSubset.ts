/**
 * Recursive subset matcher: returns null if `actual` contains every
 * key/value pair of `expected` (objects), every element of `expected`
 * (arrays, by index), or strict equality (scalars). Returns a
 * human-readable mismatch message otherwise.
 */
export function jsonSubsetMismatch(
  expected: unknown,
  actual: unknown,
  path: string,
): string | null {
  if (expected === null) {
    return actual === null
      ? null
      : `${path}: expected null, got ${JSON.stringify(actual)}`;
  }
  if (typeof expected !== typeof actual) {
    return `${path}: expected ${typeof expected}, got ${typeof actual}`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path}: expected array`;
    for (let i = 0; i < expected.length; i++) {
      const m = jsonSubsetMismatch(expected[i], actual[i], `${path}[${i}]`);
      if (m) return m;
    }
    return null;
  }
  if (typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      return `${path}: expected object`;
    }
    for (const k of Object.keys(expected as Record<string, unknown>)) {
      if (!(k in (actual as Record<string, unknown>))) {
        return `${path}.${k}: missing`;
      }
      const m = jsonSubsetMismatch(
        (expected as Record<string, unknown>)[k],
        (actual as Record<string, unknown>)[k],
        `${path}.${k}`,
      );
      if (m) return m;
    }
    return null;
  }
  return expected === actual
    ? null
    : `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}
