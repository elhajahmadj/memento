import type { ApprovalStatus } from "@workspace/api-client-react";
import { formatDateTime } from "@/shared/utils/format";

export function formatDate(s: string): string {
  return formatDateTime(s);
}

export function statusLabel(s: ApprovalStatus): { text: string; cls: string } {
  if (s === "pending")
    return { text: "Pending", cls: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" };
  if (s === "approved")
    return { text: "Approved", cls: "bg-green-500/10 text-green-500 border-green-500/20" };
  return { text: "Rejected", cls: "bg-red-500/10 text-red-500 border-red-500/20" };
}

export const APPROVALS_KEY = "approvals";
