/**
 * Persistence port for approval submissions. Implemented by
 * `infrastructure/drizzleApprovalRepository.ts`; unit-tested with a
 * hand-rolled stub.
 */
import type {
  ApprovalStatus,
  ApprovalSubmission,
} from "@workspace/db";

/** Submission joined with the fork + submitter columns the UI needs. */
export interface ApprovalRow extends ApprovalSubmission {
  username: string;
  projectName: string;
  forkPath: string;
}

export interface ApprovalRepository {
  listAll(filter?: {
    status?: ApprovalStatus;
  }): Promise<ApprovalRow[]>;
  findById(id: string): Promise<ApprovalRow | null>;
  listForUser(userId: string): Promise<ApprovalRow[]>;
  hasPendingForFork(forkId: string): Promise<boolean>;
  /** Insert a row in the `pending` state with an empty `snapshotPath`. */
  createPending(args: {
    forkId: string;
    submittedBy: string;
    submitterComment: string | null;
  }): Promise<ApprovalSubmission>;
  /** Backfill the snapshot path once the directory has been written. */
  setSnapshotPath(
    id: string,
    snapshotPath: string,
  ): Promise<ApprovalSubmission | null>;
  /** Mark a submission as approved/rejected. */
  recordDecision(args: {
    id: string;
    status: "approved" | "rejected";
    decidedBy: string;
    comment: string | null;
  }): Promise<ApprovalSubmission | null>;
}
