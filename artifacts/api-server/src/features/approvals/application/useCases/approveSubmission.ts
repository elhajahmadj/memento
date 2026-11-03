import { err, ok, type Result } from "@workspace/kernel/result";
import {
  infrastructureError,
  notFoundError,
  type ConflictError,
  type InfrastructureError,
  type NotFoundError,
  type ValidationError,
} from "@workspace/kernel/errors";
import {
  ensureConflictsAcknowledged,
  ensurePending,
  resolveSelectedFiles,
} from "@/features/approvals/domain/approvalRules";
import type {
  ApprovalRepository,
  ApprovalRow,
} from "@/features/approvals/domain/ports/approvalRepository";
import type { ApprovalWorkspace } from "@/features/approvals/domain/ports/approvalWorkspace";
import { computeChangedFiles } from "@/features/approvals/application/useCases/computeApprovalDiff";

export interface AppliedSummary {
  written: number;
  deleted: number;
  selectedFiles: string[] | null;
  conflictCount: number;
}

export class ApproveSubmissionUseCase {
  constructor(
    private readonly repo: ApprovalRepository,
    private readonly workspace: ApprovalWorkspace,
  ) {}

  async execute(args: {
    id: string;
    decidedBy: string;
    comment?: string | null | undefined;
    selectedFiles?: string[] | undefined;
    acknowledgeConflicts?: boolean | undefined;
  }): Promise<
    Result<
      { row: ApprovalRow; applied: AppliedSummary },
      | NotFoundError
      | ConflictError
      | ValidationError
      | InfrastructureError
    >
  > {
    const row = await this.repo.findById(args.id);
    if (!row) return err(notFoundError("ApprovalSubmission", args.id));

    const pending = ensurePending(row.status);
    if (pending.kind === "err") return pending;

    const mainDir = this.workspace.mainProjectDir(row.projectName);
    if (!(await this.workspace.exists(mainDir))) {
      return err(
        infrastructureError(`Main project not found: ${row.projectName}`),
      );
    }

    const diff = await computeChangedFiles(this.workspace, {
      snapshotDir: row.snapshotPath,
      mainDir,
    });
    const allChangedPaths = new Set(diff.map((d) => d.path));

    const selectedResult = resolveSelectedFiles(
      args.selectedFiles,
      allChangedPaths,
    );
    if (selectedResult.kind === "err") return selectedResult;
    const selectedSet = selectedResult.value;
    const filesToApply = selectedSet ?? allChangedPaths;
    const conflictsAmongApplied = diff.filter(
      (d) => filesToApply.has(d.path) && d.mainChangedSinceSnapshot === true,
    );

    const ackResult = ensureConflictsAcknowledged(
      conflictsAmongApplied.length,
      args.acknowledgeConflicts,
    );
    if (ackResult.kind === "err") return ackResult;

    try {
      const applied = await this.workspace.applySnapshotToMain(
        row.snapshotPath,
        mainDir,
        selectedSet,
      );
      const updated = await this.repo.recordDecision({
        id: args.id,
        status: "approved",
        decidedBy: args.decidedBy,
        comment: args.comment ?? null,
      });
      if (!updated) {
        return err(infrastructureError("Failed to update submission"));
      }
      return ok({
        row: { ...row, ...updated },
        applied: {
          ...applied,
          selectedFiles: selectedSet
            ? Array.from(selectedSet).sort()
            : null,
          conflictCount: conflictsAmongApplied.length,
        },
      });
    } catch (e) {
      return err(infrastructureError("Failed to apply submission", e));
    }
  }
}
