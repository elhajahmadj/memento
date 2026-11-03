export function serializeLifecycleRequest(r: {
  id: string;
  projectName: string;
  kind: "create" | "delete" | "clear_files";
  status: "pending" | "approved" | "rejected";
  requestedByUserId: string;
  requestedByUsername: string;
  requestedByRole: string;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
  organizationId: string | null;
  language?: string | null;
  solutionType?: string | null;
}): Record<string, unknown> {
  return {
    id: r.id,
    projectName: r.projectName,
    kind: r.kind,
    status: r.status,
    requestedByUserId: r.requestedByUserId,
    requestedByUsername: r.requestedByUsername,
    requestedByRole: r.requestedByRole,
    requestedAt: r.requestedAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decidedByUserId: r.decidedByUserId ?? null,
    decisionNote: r.decisionNote ?? null,
    organizationId: r.organizationId ?? null,
    language: r.language ?? null,
    solutionType: r.solutionType ?? null,
  };
}
