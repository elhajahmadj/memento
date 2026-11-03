import { customFetch } from "./custom-fetch";
import type { Language, SolutionType } from "./generated/api.schemas";

export type ForkStatus = "pending" | "active";

export interface ForkDto {
  id: string;
  userId: string;
  username: string;
  projectName: string;
  forkPath: string;
  status: ForkStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface ForkAvailableProject {
  projectName: string;
  slnPath: string;
  forkStatus: "none" | "pending" | "active";
  forkId: string | null;
  forkPath: string | null;
  disabled: boolean;
  language?: Language;
  solutionType?: SolutionType;
}

export interface PublicUserDto {
  id: string;
  username: string;
  role: "admin" | "limited";
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  profileComplete: boolean;
}

export function listForks(): Promise<ForkDto[]> {
  return customFetch<ForkDto[]>("/api/forks", { method: "GET" });
}

export function listAvailableForkProjects(): Promise<ForkAvailableProject[]> {
  return customFetch<ForkAvailableProject[]>("/api/forks/available-projects", {
    method: "GET",
    responseType: "json",
  });
}

export function createForkAssignment(args: {
  userId: string;
  projectName: string;
}): Promise<ForkDto> {
  return customFetch<ForkDto>("/api/forks", {
    method: "POST",
    body: JSON.stringify(args),
  });
}

export function requestFork(projectName: string): Promise<ForkDto> {
  return customFetch<ForkDto>("/api/forks/request", {
    method: "POST",
    body: JSON.stringify({ projectName }),
  });
}

export function approveFork(id: string): Promise<ForkDto> {
  return customFetch<ForkDto>(`/api/forks/${encodeURIComponent(id)}/approve`, {
    method: "POST",
  });
}

export function denyFork(id: string): Promise<void> {
  return customFetch<void>(`/api/forks/${encodeURIComponent(id)}/deny`, {
    method: "POST",
    responseType: "auto",
  });
}

export function deleteFork(id: string): Promise<void> {
  return customFetch<void>(`/api/forks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    responseType: "auto",
  });
}

export interface ForkSubmissionDto {
  id: string;
  forkId: string;
  submittedBy: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  decidedAt: string | null;
  decidedBy: string | null;
  comment: string | null;
  submitterComment: string | null;
  snapshotPath: string;
}

export function submitForkForApproval(
  id: string,
  comment?: string,
): Promise<ForkSubmissionDto> {
  const body =
    comment && comment.trim().length > 0
      ? JSON.stringify({ comment: comment.trim() })
      : undefined;
  return customFetch<ForkSubmissionDto>(
    `/api/forks/${encodeURIComponent(id)}/submit`,
    { method: "POST", ...(body !== undefined ? { body } : {}) },
  );
}

export function listAdminUsers(): Promise<PublicUserDto[]> {
  return customFetch<PublicUserDto[]>("/api/users", { method: "GET" });
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalSummaryDto {
  id: string;
  forkId: string;
  submittedBy: string;
  submittedAt: string;
  status: ApprovalStatus;
  decidedAt: string | null;
  decidedBy: string | null;
  comment: string | null;
  submitterComment: string | null;
  snapshotPath: string;
  username: string;
  projectName: string;
  forkPath: string;
  changedFiles: number;
  conflictCount: number;
}

export interface ApprovalDto {
  id: string;
  forkId: string;
  submittedBy: string;
  submittedAt: string;
  status: ApprovalStatus;
  decidedAt: string | null;
  decidedBy: string | null;
  comment: string | null;
  submitterComment: string | null;
  snapshotPath: string;
  username: string;
  projectName: string;
  forkPath: string;
}

export type FileChangeKind = "added" | "modified" | "deleted";

export interface ApprovalFileSummary {
  path: string;
  kind: FileChangeKind;
  additions: number;
  deletions: number;
  binary: boolean;
  /**
   * True iff main has been edited since the submission was created.
   * Null when no main-base snapshot was recorded (older submissions).
   */
  mainChangedSinceSnapshot: boolean | null;
}

export interface ApprovalDiffLine {
  type: "context" | "add" | "del";
  text: string;
}

export interface ApprovalFileDiff extends ApprovalFileSummary {
  lines: ApprovalDiffLine[];
}

export interface ApprovalDiffResponse {
  files: ApprovalFileSummary[];
  conflictCount: number;
}

export function listApprovals(
  status?: ApprovalStatus,
): Promise<ApprovalSummaryDto[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return customFetch<ApprovalSummaryDto[]>(`/api/approvals${qs}`, {
    method: "GET",
  });
}

export function getApproval(id: string): Promise<ApprovalDto> {
  return customFetch<ApprovalDto>(`/api/approvals/${encodeURIComponent(id)}`, {
    method: "GET",
  });
}

export function getApprovalDiff(id: string): Promise<ApprovalDiffResponse> {
  return customFetch<ApprovalDiffResponse>(
    `/api/approvals/${encodeURIComponent(id)}/diff`,
    { method: "GET" },
  );
}

export function getApprovalFileDiff(
  id: string,
  filePath: string,
): Promise<ApprovalFileDiff> {
  return customFetch<ApprovalFileDiff>(
    `/api/approvals/${encodeURIComponent(id)}/diff?file=${encodeURIComponent(filePath)}`,
    { method: "GET" },
  );
}

export interface ApproveSubmissionOptions {
  comment?: string;
  selectedFiles?: string[];
  acknowledgeConflicts?: boolean;
}

export function approveSubmission(
  id: string,
  optsOrComment?: ApproveSubmissionOptions | string,
): Promise<ApprovalDto> {
  const opts: ApproveSubmissionOptions =
    typeof optsOrComment === "string"
      ? { comment: optsOrComment }
      : (optsOrComment ?? {});
  const body: Record<string, unknown> = {};
  if (opts.comment) body.comment = opts.comment;
  if (opts.selectedFiles && opts.selectedFiles.length > 0) {
    body.selectedFiles = opts.selectedFiles;
  }
  if (opts.acknowledgeConflicts) body.acknowledgeConflicts = true;
  return customFetch<ApprovalDto>(
    `/api/approvals/${encodeURIComponent(id)}/approve`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function rejectSubmission(
  id: string,
  comment?: string,
): Promise<ApprovalDto> {
  return customFetch<ApprovalDto>(
    `/api/approvals/${encodeURIComponent(id)}/reject`,
    {
      method: "POST",
      body: JSON.stringify(comment ? { comment } : {}),
    },
  );
}

/**
 * Fetch every submission the calling user has ever sent. The home page uses
 * this to render the "Approval pending / Approved / Rejected" badge on each
 * project card.
 */
export function listMyApprovals(): Promise<ApprovalDto[]> {
  return customFetch<ApprovalDto[]>("/api/approvals/mine", { method: "GET" });
}
