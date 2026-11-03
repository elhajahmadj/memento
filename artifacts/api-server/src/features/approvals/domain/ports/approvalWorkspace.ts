/**
 * Filesystem port for approval snapshots + diff base resolution.
 * Implemented by `infrastructure/fsApprovalWorkspace.ts`.
 */

export interface ApprovalWorkspace {
  /** Absolute path of the directory each submission's snapshot lives in. */
  approvalsRoot(): string;
  /** Absolute path of the active "main" tree for a given project. */
  mainProjectDir(projectName: string): string;

  exists(absPath: string): Promise<boolean>;

  /** Copy the fork's working tree into the per-submission snapshot dir. */
  snapshotFork(forkPath: string, snapshotDir: string): Promise<void>;
  /**
   * Persist both a hash sidecar and a full tree copy of main as it stood
   * at submit time. Best-effort: each side independently swallows errors
   * so a snapshot still completes if the workspace is degraded.
   */
  snapshotMainBase(mainDir: string, snapshotDir: string): Promise<void>;

  /** Load the per-file hash baseline written by `snapshotMainBase`. */
  loadMainBaseHashes(
    snapshotDir: string,
  ): Promise<Record<string, string> | null>;
  /**
   * Resolve the directory the diff should be computed against. Returns
   * the persisted historical main tree when it exists (decided
   * submissions), otherwise the live main dir.
   */
  diffBaseDir(snapshotDir: string, fallbackMainDir: string): Promise<string>;

  /** List utf8 files relative to `root`, skipping ignored dirs. */
  listFilesRel(root: string): Promise<string[]>;
  /** Read file as utf8; `null` for binary / oversized / missing. */
  readUtf8OrNull(absPath: string): Promise<string | null>;
  /** Sha256 of file contents; `null` if missing. */
  fileSha256(absPath: string): Promise<string | null>;

  /**
   * Mirror `snapshotDir` onto `mainDir`. When `selectedFiles` is given,
   * only those relative paths are written/deleted; otherwise the entire
   * snapshot tree is applied.
   */
  applySnapshotToMain(
    snapshotDir: string,
    mainDir: string,
    selectedFiles?: ReadonlySet<string>,
  ): Promise<{ written: number; deleted: number }>;
}
