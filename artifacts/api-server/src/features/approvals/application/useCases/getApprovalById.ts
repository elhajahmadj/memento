import { err, ok, type Result } from "@workspace/kernel/result";
import {
  notFoundError,
  type NotFoundError,
} from "@workspace/kernel/errors";
import type {
  ApprovalRepository,
  ApprovalRow,
} from "@/features/approvals/domain/ports/approvalRepository";

export class GetApprovalByIdUseCase {
  constructor(private readonly repo: ApprovalRepository) {}

  async execute(id: string): Promise<Result<ApprovalRow, NotFoundError>> {
    const row = await this.repo.findById(id);
    if (!row) return err(notFoundError("ApprovalSubmission", id));
    return ok(row);
  }
}
