/**
 * Build the per-suite `Constants` mapping for `fill_*` actions so the
 * generated test body can reference `{Suite}Constants.USER_NAME` rather
 * than embedding literal fill values inline. Mirrors the C# variant.
 */
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

/**
 * Derive the Python `Constants` mapping name for a recorded `fill_*`
 * method, e.g. `fill_user_name` → `USER_NAME`. Tolerates the `_2`/`_3`
 * collision suffix added by `disambiguateMethodNamePython` so an earlier
 * recording's `fill_user_name_2` still maps to the same `USER_NAME`
 * constant. Returns null when the method name doesn't follow the
 * Python `fill_*` convention.
 */
export function deriveConstantNamePython(methodName: string): string | null {
  const m = methodName.match(/^fill_([a-z0-9_]+?)(?:_\d+)?$/);
  if (!m) return null;
  const base = m[1] ?? "";
  if (!base) return null;
  return base.toUpperCase();
}

/**
 * Build the `Constants` mapping for a sequence of recorded actions.
 */
export function buildFillConstantsPython(
  actions: RecordedAction[],
  methodNames: Map<RecordedAction, string>,
  existing: Map<string, string> = new Map(),
): { byMethod: Map<string, string>; byName: Map<string, string> } {
  const byMethod = new Map<string, string>();
  const byName = new Map<string, string>(existing);
  for (const a of actions) {
    if (a.deleted) continue;
    if (a.type !== "fill") continue;
    const value = a.value ?? "";
    if (!value) continue;
    const methodName = methodNames.get(a);
    if (!methodName) continue;
    if (byMethod.has(methodName)) continue;
    const base = deriveConstantNamePython(methodName);
    if (!base) continue;
    let chosen = base;
    let n = 2;
    while (byName.has(chosen) && byName.get(chosen) !== value) {
      chosen = `${base}_${n++}`;
    }
    byName.set(chosen, value);
    byMethod.set(methodName, chosen);
  }
  return { byMethod, byName };
}
