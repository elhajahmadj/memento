/**
 * Backwards-compatible barrel for the approvals feature.
 *
 * The actual logic lives in:
 *   - `domain/diff.ts`              pure diff primitives
 *   - `domain/approvalRules.ts`     pure state-transition rules
 *   - `domain/ports/*`              repository + workspace ports
 *   - `application/useCases/*`      one file per use case (returns `Result`)
 *   - `infrastructure/drizzleApprovalRepository.ts`  Drizzle adapter
 *   - `infrastructure/fsApprovalWorkspace.ts`        Filesystem adapter
 *
 * This module wires the default production adapters once and re-exports
 * the historical function-based API so route modules + existing tests
 * keep working unchanged. The downstream "wire composition roots" task
 * will replace the imports of this barrel with container-injected use
 * cases — at which point this file (and its module-level singletons)
 * can be deleted.
 */

import fs from "node:fs/promises";
import type {
  ApprovalStatus,
  ApprovalSubmission,
  Fork,
} from "@workspace/db";

import { DrizzleApprovalRepository } from "@/features/approvals/infrastructure/drizzleApprovalRepository";
import { FsApprovalWorkspace } from "@/features/approvals/infrastructure/fsApprovalWorkspace";
import {
  ListApprovalsUseCase,
  ListApprovalsForUserUseCase,
  HasPendingSubmissionForForkUseCase,
} from "@/features/approvals/application/useCases/listApprovals";
import { GetApprovalByIdUseCase } from "@/features/approvals/application/useCases/getApprovalById";
import {
  computeChangedFiles as computeChangedFilesUC,
  computeChangedFilesWithConflictCount as computeChangedFilesWithConflictCountUC,
  computeFileDiff as computeFileDiffUC,
} from "@/features/approvals/application/useCases/computeApprovalDiff";
import { CreateSubmissionFromForkUseCase } from "@/features/approvals/application/useCases/createSubmissionFromFork";
import { ApproveSubmissionUseCase } from "@/features/approvals/application/useCases/approveSubmission";
import { RejectSubmissionUseCase } from "@/features/approvals/application/useCases/rejectSubmission";

import type { ApprovalRow } from "@/features/approvals/domain/ports/approvalRepository";
import type {
  FileChangeDetail,
  FileChangeSummary,
} from "@/features/approvals/domain/diff";

// Re-export diff primitives + types previously declared here.
export {
  diffLines,
  type DiffLine,
  type FileChangeKind,
  type FileChangeSummary,
  type FileChangeDetail,
} from "@/features/approvals/domain/diff";
export type { ApprovalRow } from "@/features/approvals/domain/ports/approvalRepository";

// ---------------------------------------------------------------------------
// Default (production) wiring.
// ---------------------------------------------------------------------------

const repo = new DrizzleApprovalRepository();
const workspace = new FsApprovalWorkspace();

const listUC = new ListApprovalsUseCase(repo);
const listForUserUC = new ListApprovalsForUserUseCase(repo);
const hasPendingUC = new HasPendingSubmissionForForkUseCase(repo);
const getByIdUC = new GetApprovalByIdUseCase(repo);
const createUC = new CreateSubmissionFromForkUseCase(
  repo,
  workspace,
  async (p) => {
    await fs.mkdir(p, { recursive: true });
  },
);
const approveUC = new ApproveSubmissionUseCase(repo, workspace);
const rejectUC = new RejectSubmissionUseCase(repo);

// Composition-root accessors. The container in `composition/container.ts`
// pulls these singletons so the route handlers can resolve use cases
// from one place instead of importing the throw-wrappers below.
export const approvalsComposition = {
  workspace,
  listApprovals: listUC,
  listApprovalsForUser: listForUserUC,
  hasPendingSubmissionForFork: hasPendingUC,
  getApprovalById: getByIdUC,
  createSubmissionFromFork: createUC,
  approveSubmission: approveUC,
  rejectSubmission: rejectUC,
} as const;

// ---------------------------------------------------------------------------
// Helpers to keep the legacy throw-based API working until routes are rewired.
// ---------------------------------------------------------------------------

function unwrapOrThrow<T>(r:
  | { kind: "ok"; value: T }
  | { kind: "err"; error: { message: string } }): T {
  if (r.kind === "ok") return r.value;
  throw new Error(r.error.message);
}

// ---------------------------------------------------------------------------
// Public API (matches the original module surface).
// ---------------------------------------------------------------------------

export async function listApprovals(filter?: {
  status?: ApprovalStatus | undefined;
}): Promise<ApprovalRow[]> {
  return unwrapOrThrow(await listUC.execute(filter));
}

export async function getApprovalById(
  id: string,
): Promise<ApprovalRow | null> {
  const result = await getByIdUC.execute(id);
  return result.kind === "ok" ? result.value : null;
}

export async function listApprovalsForUser(
  userId: string,
): Promise<ApprovalRow[]> {
  return unwrapOrThrow(await listForUserUC.execute(userId));
}

export async function hasPendingSubmissionForFork(
  forkId: string,
): Promise<boolean> {
  return unwrapOrThrow(await hasPendingUC.execute(forkId));
}

export async function createSubmissionFromFork(args: {
  fork: Fork;
  submittedBy: string;
  submitterComment?: string | null;
}): Promise<ApprovalSubmission> {
  return unwrapOrThrow(await createUC.execute(args));
}

export async function approveSubmission(args: {
  id: string;
  decidedBy: string;
  comment?: string | null | undefined;
  selectedFiles?: string[] | undefined;
  acknowledgeConflicts?: boolean | undefined;
}): Promise<{
  row: ApprovalRow;
  applied: {
    written: number;
    deleted: number;
    selectedFiles: string[] | null;
    conflictCount: number;
  };
}> {
  const result = await approveUC.execute(args);
  if (result.kind === "err") throw new Error(result.error.message);
  return result.value;
}

export async function rejectSubmission(args: {
  id: string;
  decidedBy: string;
  comment?: string | null;
}): Promise<ApprovalRow> {
  const result = await rejectUC.execute(args);
  if (result.kind === "err") throw new Error(result.error.message);
  return result.value;
}

export function mainDirForApproval(row: ApprovalRow): string {
  return workspace.mainProjectDir(row.projectName);
}

export async function diffBaseDirForApproval(
  row: ApprovalRow,
): Promise<string> {
  return workspace.diffBaseDir(
    row.snapshotPath,
    workspace.mainProjectDir(row.projectName),
  );
}

export async function computeChangedFiles(args: {
  snapshotDir: string;
  mainDir: string;
}): Promise<FileChangeSummary[]> {
  return computeChangedFilesUC(workspace, args);
}

export async function computeChangedFilesWithConflictCount(args: {
  snapshotDir: string;
  mainDir: string;
}): Promise<{ files: FileChangeSummary[]; conflictCount: number }> {
  return computeChangedFilesWithConflictCountUC(workspace, args);
}

export async function computeFileDiff(args: {
  snapshotDir: string;
  mainDir: string;
  relPath: string;
}): Promise<FileChangeDetail | null> {
  return computeFileDiffUC(workspace, args);
}
