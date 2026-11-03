import type { ApprovalStatus } from "@workspace/db";
import { ok, type Result } from "@workspace/kernel/result";
import {
  infrastructureError,
  type InfrastructureError,
} from "@workspace/kernel/errors";
import { fromPromise } from "@workspace/kernel/result";
import type {
  ApprovalRepository,
  ApprovalRow,
} from "@/features/approvals/domain/ports/approvalRepository";

export class ListApprovalsUseCase {
  constructor(private readonly repo: ApprovalRepository) {}

  async execute(filter?: {
    status?: ApprovalStatus | undefined;
  }): Promise<Result<ApprovalRow[], InfrastructureError>> {
    const normalized: { status?: ApprovalStatus } | undefined =
      filter === undefined
        ? undefined
        : filter.status === undefined
        ? {}
        : { status: filter.status };
    return fromPromise(this.repo.listAll(normalized), (e) =>
      infrastructureError("Failed to list approvals", e),
    );
  }
}

export class ListApprovalsForUserUseCase {
  constructor(private readonly repo: ApprovalRepository) {}

  async execute(
    userId: string,
  ): Promise<Result<ApprovalRow[], InfrastructureError>> {
    return fromPromise(this.repo.listForUser(userId), (e) =>
      infrastructureError("Failed to list approvals", e),
    );
  }
}

export class HasPendingSubmissionForForkUseCase {
  constructor(private readonly repo: ApprovalRepository) {}

  async execute(
    forkId: string,
  ): Promise<Result<boolean, InfrastructureError>> {
    return fromPromise(this.repo.hasPendingForFork(forkId), (e) =>
      infrastructureError("Failed to read pending submissions", e),
    );
  }
}

export { ok };
