import { Badge } from "@/shared/ui/badge";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { RunState } from "./types";

export function RunStatusBadge({ status }: { status: RunState["status"] }) {
  if (status === "passed")
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3 mr-1" /> Passed
      </Badge>
    );
  if (status === "failed" || status === "error")
    return (
      <Badge variant="destructive">
        <XCircle className="h-3 w-3 mr-1" /> {status === "failed" ? "Failed" : "Error"}
      </Badge>
    );
  if (status === "running")
    return (
      <Badge variant="secondary">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Running
      </Badge>
    );
  if (status === "queued" || status === "connecting")
    return (
      <Badge variant="outline">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />{" "}
        {status === "queued" ? "Queued" : "Connecting"}
      </Badge>
    );
  return <Badge variant="outline">{status}</Badge>;
}
