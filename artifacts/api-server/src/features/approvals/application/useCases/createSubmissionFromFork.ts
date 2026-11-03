import path from "node:path";
import type { ApprovalSubmission, Fork } from "@workspace/db";
import { err, ok, type Result } from "@workspace/kernel/result";
import {
  infrastructureError,
  type InfrastructureError,
  type ValidationError,
} from "@workspace/kernel/errors";
import { ensureForkActive } from "@/features/approvals/domain/approvalRules";
import type { ApprovalRepository } from "@/features/approvals/domain/ports/approvalRepository";
import type { ApprovalWorkspace } from "@/features/approvals/domain/ports/approvalWorkspace";

export class CreateSubmissionFromForkUseCase {
  constructor(
    private readonly repo: ApprovalRepository,
    private readonly workspace: ApprovalWorkspace,
    private readonly ensureDir: (p: string) => Promise<void>,
  ) {}

  async execute(args: {
    fork: Fork;
    submittedBy: string;
    submitterComment?: string | null;
  }): Promise<
    Result<ApprovalSubmission, ValidationError | InfrastructureError>
  > {
    const gate = ensureForkActive(args.fork.status);
    if (gate.kind === "err") return gate;

    try {
      await this.ensureDir(this.workspace.approvalsRoot());
      const row = await this.repo.createPending({
        forkId: args.fork.id,
        submittedBy: args.submittedBy,
        submitterComment: args.submitterComment ?? null,
      });
      const snapshotDir = path.join(this.workspace.approvalsRoot(), row.id);
      await this.workspace.snapshotFork(args.fork.forkPath, snapshotDir);
      const mainDir = this.workspace.mainProjectDir(args.fork.projectName);
      if (await this.workspace.exists(mainDir)) {
        await this.workspace.snapshotMainBase(mainDir, snapshotDir);
      }
      const updated = await this.repo.setSnapshotPath(row.id, snapshotDir);
      return ok(updated ?? row);
    } catch (e) {
      return err(infrastructureError("Failed to create submission", e));
    }
  }
}
