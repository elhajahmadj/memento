/**
 * `localStorage`-backed persistence for the tests-tree selection.
 *
 * Scoped per (user, project) so two people sharing a browser don't
 * see each other's picks and so each project keeps its own remembered
 * selection. Reads/writes are best-effort — any failure (quota,
 * privacy mode, missing keys) silently falls back to in-memory only.
 */

/**
 * Build the localStorage key. Returns `null` when either id is missing
 * — in that case persistence is skipped entirely.
 */
export function selectionStorageKey(
  userId: string | null | undefined,
  projectId: string | null,
): string | null {
  if (!userId || !projectId) return null;
  return `tests-tree:selected:v1:${userId}:${projectId}`;
}

export function readPersistedSelection(key: string | null): Set<string> {
  if (!key || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const v of parsed) {
      if (typeof v === "string") out.add(v);
    }
    return out;
  } catch {
    return new Set();
  }
}

export function writePersistedSelection(
  key: string | null,
  selected: ReadonlySet<string>,
): void {
  if (!key || typeof window === "undefined") return;
  try {
    if (selected.size === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(Array.from(selected)));
    }
  } catch {
    // best-effort — quota / privacy mode failures are non-fatal
  }
}
