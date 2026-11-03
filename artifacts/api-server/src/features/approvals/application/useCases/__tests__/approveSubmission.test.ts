import { describe, it, expect, vi } from "vitest";
import type { ApprovalSubmission } from "@workspace/db";
import { ApproveSubmissionUseCase } from "@/features/approvals/application/useCases/approveSubmission";
import { RejectSubmissionUseCase } from "@/features/approvals/application/useCases/rejectSubmission";
import type {
  ApprovalRepository,
  ApprovalRow,
} from "@/features/approvals/domain/ports/approvalRepository";
import type { ApprovalWorkspace } from "@/features/approvals/domain/ports/approvalWorkspace";

function makeRow(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: "sub-1",
    forkId: "fork-1",
    submittedBy: "user-1",
    submittedAt: new Date(),
    status: "pending",
    decidedAt: null,
    decidedBy: null,
    comment: null,
    submitterComment: null,
    snapshotPath: "/snap/sub-1",
    username: "tester",
    projectName: "Proj",
    forkPath: "/forks/fork-1",
    ...overrides,
  } as ApprovalRow;
}

function makeRepoStub(initial: ApprovalRow | null): ApprovalRepository {
  let row = initial;
  return {
    listAll: vi.fn(),
    listForUser: vi.fn(),
    hasPendingForFork: vi.fn(),
    createPending: vi.fn(),
    setSnapshotPath: vi.fn(),
    findById: vi.fn(async () => row),
    recordDecision: vi.fn(async (args) => {
      if (!row) return null;
      const updated: ApprovalSubmission = {
        ...row,
        status: args.status,
        decidedAt: new Date(),
        decidedBy: args.decidedBy,
        comment: args.comment,
      } as ApprovalSubmission;
      row = { ...row, ...updated } as ApprovalRow;
      return updated;
    }),
  };
}

function makeWorkspaceStub(
  partial: Partial<ApprovalWorkspace> = {},
): ApprovalWorkspace {
  return {
    approvalsRoot: () => "/approvals",
    mainProjectDir: (n: string) => `/main/${n}`,
    exists: async () => true,
    snapshotFork: async () => {},
    snapshotMainBase: async () => {},
    loadMainBaseHashes: async () => null,
    diffBaseDir: async (_s, m) => m,
    listFilesRel: async () => [],
    readUtf8OrNull: async () => null,
    fileSha256: async () => null,
    applySnapshotToMain: async () => ({ written: 0, deleted: 0 }),
    ...partial,
  };
}

describe("ApproveSubmissionUseCase", () => {
  it("returns not_found when the submission is missing", async () => {
    const uc = new ApproveSubmissionUseCase(
      makeRepoStub(null),
      makeWorkspaceStub(),
    );
    const r = await uc.execute({ id: "missing", decidedBy: "u" });
    expect(r.kind).toBe("err");
    if (r.kind === "err") expect(r.error.kind).toBe("not_found");
  });

  it("returns conflict when the submission is already decided", async () => {
    const uc = new ApproveSubmissionUseCase(
      makeRepoStub(makeRow({ status: "approved" })),
      makeWorkspaceStub(),
    );
    const r = await uc.execute({ id: "sub-1", decidedBy: "u" });
    expect(r.kind).toBe("err");
    if (r.kind === "err") expect(r.error.kind).toBe("conflict");
  });

  it("returns infrastructure when main dir is missing", async () => {
    const uc = new ApproveSubmissionUseCase(
      makeRepoStub(makeRow()),
      makeWorkspaceStub({ exists: async () => false }),
    );
    const r = await uc.execute({ id: "sub-1", decidedBy: "u" });
    expect(r.kind).toBe("err");
    if (r.kind === "err") expect(r.error.kind).toBe("infrastructure");
  });

  it("rejects unknown selectedFiles with validation error", async () => {
    // diff is empty; "x.txt" is not in the set.
    const uc = new ApproveSubmissionUseCase(
      makeRepoStub(makeRow()),
      makeWorkspaceStub(),
    );
    const r = await uc.execute({
      id: "sub-1",
      decidedBy: "u",
      selectedFiles: ["x.txt"],
    });
    expect(r.kind).toBe("err");
    if (r.kind === "err") expect(r.error.kind).toBe("validation");
  });

  it("applies snapshot and records decision on success", async () => {
    const apply = vi.fn(async () => ({ written: 2, deleted: 1 }));
    const repo = makeRepoStub(makeRow());
    const uc = new ApproveSubmissionUseCase(
      repo,
      makeWorkspaceStub({ applySnapshotToMain: apply }),
    );
    const r = await uc.execute({ id: "sub-1", decidedBy: "admin" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.value.applied.written).toBe(2);
      expect(r.value.applied.deleted).toBe(1);
      expect(r.value.row.status).toBe("approved");
    }
    expect(apply).toHaveBeenCalledOnce();
    expect(repo.recordDecision).toHaveBeenCalledOnce();
  });
});

describe("RejectSubmissionUseCase", () => {
  it("rejects a pending submission", async () => {
    const repo = makeRepoStub(makeRow());
    const uc = new RejectSubmissionUseCase(repo);
    const r = await uc.execute({
      id: "sub-1",
      decidedBy: "admin",
      comment: "no",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.value.status).toBe("rejected");
  });

  it("conflicts when already decided", async () => {
    const uc = new RejectSubmissionUseCase(
      makeRepoStub(makeRow({ status: "rejected" })),
    );
    const r = await uc.execute({ id: "sub-1", decidedBy: "admin" });
    expect(r.kind).toBe("err");
    if (r.kind === "err") expect(r.error.kind).toBe("conflict");
  });
});
