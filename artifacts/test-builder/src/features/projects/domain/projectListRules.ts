/**
 * Pure list / filter / sort rules used by the Projects home views.
 *
 * Everything in this module is framework-free: no React, no fetch, no
 * api-client imports. Inputs are shaped as the bare minimum each rule
 * needs so the rules can be unit-tested with hand-built fixtures and
 * stay decoupled from the generated DTOs.
 */

export interface AvailableProjectLike {
  readonly disabled?: boolean | undefined;
  readonly hasAccess?: boolean | undefined;
  readonly pendingApproval?: boolean | undefined;
}

export interface LifecycleRequestLike {
  readonly id: string;
  readonly kind: string;
  readonly projectName: string;
}

export interface ApprovalLike {
  readonly projectName: string;
  readonly submittedAt: string | Date;
}

export interface RecordingStatusLike {
  readonly phase?: string | undefined;
  readonly methodName?: string | null | undefined;
  readonly targetClass?: string | null | undefined;
}

export interface PendingProjectResponseLike {
  readonly pending?: boolean | undefined;
}

/** Available projects minus the ones the server has hidden. */
export function visibleAvailableProjects<T extends AvailableProjectLike>(
  projects: readonly T[] | undefined | null,
): T[] {
  if (!projects) return [];
  return projects.filter((p) => !p.disabled);
}

/** Projects the limited user has direct, non-pending access to. */
export function approvedDirectProjects<T extends AvailableProjectLike>(
  projects: readonly T[] | undefined | null,
): T[] {
  if (!Array.isArray(projects)) return [];
  return projects.filter(
    (p) => p.hasAccess === true && p.pendingApproval !== true,
  );
}

/** The user's pending project-create requests. */
export function pendingCreateRequests<T extends LifecycleRequestLike>(
  requests: readonly T[] | undefined | null,
): T[] {
  if (!requests) return [];
  return requests.filter((r) => r.kind === "create");
}

/** projectName -> requestId map of the user's pending create requests. */
export function pendingCreateRequestIdsByProject(
  requests: readonly LifecycleRequestLike[] | undefined | null,
): Map<string, string> {
  return new Map(pendingCreateRequests(requests).map((r) => [r.projectName, r.id]));
}

/**
 * Group approvals by projectName, newest first within each project.
 * Stable for unit testing: input order does not affect the sort.
 */
export function groupApprovalsByProject<T extends ApprovalLike>(
  approvals: readonly T[] | undefined | null,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const a of approvals ?? []) {
    const list = map.get(a.projectName) ?? [];
    list.push(a);
    map.set(a.projectName, list);
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    );
  }
  return map;
}

/** Just the newest approval per project. */
export function latestApprovalByProject<T extends ApprovalLike>(
  byProject: Map<string, T[]>,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const [proj, list] of byProject) {
    const head = list[0];
    if (head) out.set(proj, head);
  }
  return out;
}

/**
 * `/recording/open-browser` puts the recorder in `phase==="recording"`
 * without a methodName or targetClass — that's how we tell a live
 * "open browser" session apart from a real test recording.
 */
export function isOpenBrowserActive(
  status: RecordingStatusLike | undefined | null,
): boolean {
  return (
    !!status &&
    status.phase === "recording" &&
    !status.methodName &&
    !status.targetClass
  );
}

/** The server signals "submitted for approval" with `{ pending: true }`. */
export function isPendingProjectResponse(resp: unknown): boolean {
  return (
    !!resp &&
    typeof resp === "object" &&
    (resp as PendingProjectResponseLike).pending === true
  );
}

/**
 * Best-effort extraction of a human-readable error message from a
 * mutation rejection. Handles Orval-style `{ data: { message } }`,
 * native `Error`, and falls back to the supplied default.
 */
export function extractMutationErrorMessage(
  err: unknown,
  fallback: string,
): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: unknown } }).data;
    if (data && typeof data.message === "string") return data.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
