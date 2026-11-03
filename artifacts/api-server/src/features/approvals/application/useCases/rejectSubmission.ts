import { err, ok, type Result } from "@workspace/kernel/result";
import {
  infrastructureError,
  notFoundError,
  type ConflictError,
  type InfrastructureError,
  type NotFoundError,
} from "@workspace/kernel/errors";
import { ensurePending } from "@/features/approvals/domain/approvalRules";
import type {
  ApprovalRepository,
  ApprovalRow,
} from "@/features/approvals/domain/ports/approvalRepository";

export class RejectSubmissionUseCase {
  constructor(private readonly repo: ApprovalRepository) {}

  async execute(args: {
    id: string;
    decidedBy: string;
    comment?: string | null;
  }): Promise<
    Result<
      ApprovalRow,
      NotFoundError | ConflictError | InfrastructureError
    >
  > {
    const row = await this.repo.findById(args.id);
    if (!row) return err(notFoundError("ApprovalSubmission", args.id));

    const pending = ensurePending(row.status);
    if (pending.kind === "err") return pending;

    const updated = await this.repo.recordDecision({
      id: args.id,
      status: "rejected",
      decidedBy: args.decidedBy,
      comment: args.comment ?? null,
    });
    if (!updated) {
      return err(infrastructureError("Failed to update submission"));
    }
    return ok({ ...row, ...updated });
  }
}
