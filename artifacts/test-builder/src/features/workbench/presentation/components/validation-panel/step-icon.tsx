import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { StepEvent } from "./types";

export function StepIcon({ status }: { status: StepEvent["status"] }) {
  if (status === "passed")
    return <CheckCircle2 className="h-3 w-3 text-emerald-600 mt-0.5" />;
  if (status === "failed")
    return <XCircle className="h-3 w-3 text-red-600 mt-0.5" />;
  if (status === "running")
    return <Loader2 className="h-3 w-3 animate-spin mt-0.5" />;
  if (status === "skipped")
    return <span className="h-3 w-3 mt-0.5 text-muted-foreground">›</span>;
  return <span className="h-3 w-3 mt-0.5 text-muted-foreground">·</span>;
}
