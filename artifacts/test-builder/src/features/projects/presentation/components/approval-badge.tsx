import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { ApprovalDto } from "@workspace/api-client-react";

export function ApprovalBadge({ status }: { status: ApprovalDto["status"] }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
        <CheckCircle2 className="h-3 w-3" /> Approved
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-destructive/10 text-destructive px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
        <XCircle className="h-3 w-3" /> Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      <Clock className="h-3 w-3" /> Pending
    </span>
  );
}
