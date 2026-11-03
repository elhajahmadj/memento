import { and, desc, eq } from "drizzle-orm";
import {
  db as defaultDb,
  approvalSubmissionsTable,
  forksTable,
  usersTable,
  type ApprovalStatus,
  type ApprovalSubmission,
} from "@workspace/db";
import type {
  ApprovalRepository,
  ApprovalRow,
} from "@/features/approvals/domain/ports/approvalRepository";

type Db = typeof defaultDb;

export class DrizzleApprovalRepository implements ApprovalRepository {
  constructor(private readonly db: Db = defaultDb) {}

  private baseSelect() {
    return this.db
      .select({
        sub: approvalSubmissionsTable,
        username: usersTable.username,
        projectName: forksTable.projectName,
        forkPath: forksTable.forkPath,
      })
      .from(approvalSubmissionsTable)
      .innerJoin(forksTable, eq(forksTable.id, approvalSubmissionsTable.forkId))
      .innerJoin(
        usersTable,
        eq(usersTable.id, approvalSubmissionsTable.submittedBy),
      );
  }

  private static shape(rows: Array<{
    sub: ApprovalSubmission;
    username: string;
    projectName: string;
    forkPath: string;
  }>): ApprovalRow[] {
    return rows.map((r) => ({
      ...r.sub,
      username: r.username,
      projectName: r.projectName,
      forkPath: r.forkPath,
    }));
  }

  async listAll(filter?: {
    status?: ApprovalStatus;
  }): Promise<ApprovalRow[]> {
    const q = this.baseSelect();
    const rows = filter?.status
      ? await q
          .where(eq(approvalSubmissionsTable.status, filter.status))
          .orderBy(desc(approvalSubmissionsTable.submittedAt))
      : await q.orderBy(desc(approvalSubmissionsTable.submittedAt));
    return DrizzleApprovalRepository.shape(rows);
  }

  async findById(id: string): Promise<ApprovalRow | null> {
    const rows = await this.baseSelect()
      .where(eq(approvalSubmissionsTable.id, id))
      .limit(1);
    const shaped = DrizzleApprovalRepository.shape(rows);
    return shaped[0] ?? null;
  }

  async listForUser(userId: string): Promise<ApprovalRow[]> {
    const rows = await this.baseSelect()
      .where(eq(approvalSubmissionsTable.submittedBy, userId))
      .orderBy(desc(approvalSubmissionsTable.submittedAt));
    return DrizzleApprovalRepository.shape(rows);
  }

  async hasPendingForFork(forkId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: approvalSubmissionsTable.id })
      .from(approvalSubmissionsTable)
      .where(
        and(
          eq(approvalSubmissionsTable.forkId, forkId),
          eq(approvalSubmissionsTable.status, "pending"),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async createPending(args: {
    forkId: string;
    submittedBy: string;
    submitterComment: string | null;
  }): Promise<ApprovalSubmission> {
    const [row] = await this.db
      .insert(approvalSubmissionsTable)
      .values({
        forkId: args.forkId,
        submittedBy: args.submittedBy,
        snapshotPath: "",
        submitterComment: args.submitterComment,
      })
      .returning();
    if (!row) throw new Error("Failed to create submission");
    return row;
  }

  async setSnapshotPath(
    id: string,
    snapshotPath: string,
  ): Promise<ApprovalSubmission | null> {
    const [row] = await this.db
      .update(approvalSubmissionsTable)
      .set({ snapshotPath })
      .where(eq(approvalSubmissionsTable.id, id))
      .returning();
    return row ?? null;
  }

  async recordDecision(args: {
    id: string;
    status: "approved" | "rejected";
    decidedBy: string;
    comment: string | null;
  }): Promise<ApprovalSubmission | null> {
    const [row] = await this.db
      .update(approvalSubmissionsTable)
      .set({
        status: args.status,
        decidedAt: new Date(),
        decidedBy: args.decidedBy,
        comment: args.comment,
      })
      .where(eq(approvalSubmissionsTable.id, args.id))
      .returning();
    return row ?? null;
  }
}
