import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import type { ValidationRunDto } from "@workspace/api-client-react";
import { Badge } from "@/shared/ui/badge";

export function StatusBadge({
  status,
}: {
  status: ValidationRunDto["status"];
}) {
  switch (status) {
    case "passed":
      return (
        <Badge
          variant="outline"
          className="text-emerald-600 border-emerald-600/40"
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Passed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="opacity-80">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Error
        </Badge>
      );
    case "running":
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-600/40">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Running
        </Badge>
      );
    case "queued":
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <Clock className="h-3 w-3 mr-1" />
          Queued
        </Badge>
      );
  }
}
