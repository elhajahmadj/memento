import path from "node:path";
import {
  computeMainChanged,
  detailFromSummary,
  summarizeOne,
  type FileChangeDetail,
  type FileChangeSummary,
} from "@/features/approvals/domain/diff";
import type { ApprovalWorkspace } from "@/features/approvals/domain/ports/approvalWorkspace";

/**
 * Compute the per-file diff summary between current main (old) and the
 * submission's snapshot (new). Implemented as a stateless helper rather
 * than an `execute()` class so callers can compose it with `withConflictCount`
 * cheaply. All I/O goes through the injected workspace port.
 */
export async function computeChangedFiles(
  workspace: ApprovalWorkspace,
  args: { snapshotDir: string; mainDir: string },
): Promise<FileChangeSummary[]> {
  const oldRoot = args.mainDir;
  const newRoot = args.snapshotDir;
  const [oldList, newList, base] = await Promise.all([
    workspace.listFilesRel(oldRoot),
    workspace.listFilesRel(newRoot),
    workspace.loadMainBaseHashes(args.snapshotDir),
  ]);
  const oldSet = new Set(oldList);
  const newSet = new Set(newList);
  const all = new Set<string>([...oldList, ...newList]);
  const out: FileChangeSummary[] = [];
  for (const rel of Array.from(all).sort()) {
    const inOld = oldSet.has(rel);
    const inNew = newSet.has(rel);
    const oldText = inOld
      ? await workspace.readUtf8OrNull(path.join(oldRoot, rel))
      : undefined;
    const newText = inNew
      ? await workspace.readUtf8OrNull(path.join(newRoot, rel))
      : undefined;
    const currentHash = await workspace.fileSha256(path.join(oldRoot, rel));
    const conflict = computeMainChanged(
      base?.[rel],
      currentHash,
      base !== null,
    );
    const summary = summarizeOne(rel, oldText, newText, conflict);
    if (summary) out.push(summary);
  }
  return out;
}

export async function computeChangedFilesWithConflictCount(
  workspace: ApprovalWorkspace,
  args: { snapshotDir: string; mainDir: string },
): Promise<{ files: FileChangeSummary[]; conflictCount: number }> {
  const files = await computeChangedFiles(workspace, args);
  const conflictCount = files.reduce(
    (n, f) => n + (f.mainChangedSinceSnapshot ? 1 : 0),
    0,
  );
  return { files, conflictCount };
}

export async function computeFileDiff(
  workspace: ApprovalWorkspace,
  args: { snapshotDir: string; mainDir: string; relPath: string },
): Promise<FileChangeDetail | null> {
  const oldRoot = args.mainDir;
  const newRoot = args.snapshotDir;
  const oldAbs = path.join(oldRoot, args.relPath);
  const newAbs = path.join(newRoot, args.relPath);
  const [inOld, inNew] = await Promise.all([
    workspace.exists(oldAbs),
    workspace.exists(newAbs),
  ]);
  if (!inOld && !inNew) return null;
  const base = await workspace.loadMainBaseHashes(args.snapshotDir);
  const currentHash = await workspace.fileSha256(oldAbs);
  const conflict = computeMainChanged(
    base?.[args.relPath],
    currentHash,
    base !== null,
  );
  const oldText = inOld ? await workspace.readUtf8OrNull(oldAbs) : undefined;
  const newText = inNew ? await workspace.readUtf8OrNull(newAbs) : undefined;
  const summary = summarizeOne(args.relPath, oldText, newText, conflict);
  if (!summary) return null;
  return detailFromSummary(summary, oldText, newText);
}
