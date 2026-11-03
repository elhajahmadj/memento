/**
 * Pure diff primitives used by the approvals feature.
 *
 * Nothing in this file performs I/O — callers (use cases / adapters) are
 * responsible for reading file bytes off disk and passing the strings
 * (or `null` for missing / binary content) into `summarizeOne` /
 * `diffLines`. Keeping the diff logic pure lets the domain tests run
 * without touching `fs`.
 */

export interface DiffLine {
  type: "context" | "add" | "del";
  text: string;
}

export type FileChangeKind = "added" | "modified" | "deleted";

export interface FileChangeSummary {
  path: string;
  kind: FileChangeKind;
  additions: number;
  deletions: number;
  binary: boolean;
  /**
   * True iff main currently differs from the recorded snapshot of main
   * that was taken when the submission was created. Indicates a
   * potential conflict where approve would silently overwrite changes
   * made to main since. Null when no main-base snapshot exists.
   */
  mainChangedSinceSnapshot: boolean | null;
}

export interface FileChangeDetail extends FileChangeSummary {
  lines: DiffLine[];
}

/**
 * Line-level diff using LCS dynamic programming. Produces a flat list of
 * change entries (context / add / del). The frontend renders these as a
 * unified-diff style list.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const aLines = a.split(/\r?\n/);
  const bLines = b.split(/\r?\n/);
  const m = aLines.length;
  const n = bLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      out.push({ type: "context", text: aLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: aLines[i] });
      i++;
    } else {
      out.push({ type: "add", text: bLines[j] });
      j++;
    }
  }
  while (i < m) out.push({ type: "del", text: aLines[i++] });
  while (j < n) out.push({ type: "add", text: bLines[j++] });
  return out;
}

/**
 * Build a `FileChangeSummary` from already-read file contents. Returns
 * `null` when a file is reported as present on both sides but the bytes
 * are byte-identical (a non-change that should be filtered out).
 *
 * `oldText` / `newText` semantics:
 *   - `undefined` — file absent on that side.
 *   - `null`      — file present but binary / oversized.
 *   - `string`    — utf8 contents.
 */
export function summarizeOne(
  rel: string,
  oldText: string | null | undefined,
  newText: string | null | undefined,
  mainChangedSinceSnapshot: boolean | null,
): FileChangeSummary | null {
  const presentInOld = oldText !== undefined;
  const presentInNew = newText !== undefined;
  if (!presentInOld && !presentInNew) return null;

  const kind: FileChangeKind = !presentInOld
    ? "added"
    : !presentInNew
      ? "deleted"
      : "modified";

  const binary =
    (presentInOld && oldText === null) || (presentInNew && newText === null);
  if (binary) {
    return {
      path: rel,
      kind,
      additions: 0,
      deletions: 0,
      binary: true,
      mainChangedSinceSnapshot,
    };
  }

  if (kind === "modified" && oldText === newText) return null;

  const lines = diffLines(
    (oldText ?? "") as string,
    (newText ?? "") as string,
  );
  let additions = 0;
  let deletions = 0;
  for (const l of lines) {
    if (l.type === "add") additions++;
    else if (l.type === "del") deletions++;
  }
  return {
    path: rel,
    kind,
    additions,
    deletions,
    binary: false,
    mainChangedSinceSnapshot,
  };
}

export function detailFromSummary(
  summary: FileChangeSummary,
  oldText: string | null | undefined,
  newText: string | null | undefined,
): FileChangeDetail {
  if (summary.binary) return { ...summary, lines: [] };
  return {
    ...summary,
    lines: diffLines(
      (oldText ?? "") as string,
      (newText ?? "") as string,
    ),
  };
}

/**
 * Decide whether a file's main-base hash differs from the current hash.
 * Pure: caller resolves both hashes (`null` = file absent now / then).
 *
 * Returns `null` when no baseline is available — callers surface that as
 * "unknown" in the UI.
 */
export function computeMainChanged(
  baseHash: string | undefined,
  currentHash: string | null,
  hasBaseline: boolean,
): boolean | null {
  if (!hasBaseline) return null;
  if (baseHash === undefined && currentHash === null) return false;
  if (baseHash === undefined && currentHash !== null) return true;
  if (baseHash !== undefined && currentHash === null) return true;
  return baseHash !== currentHash;
}
