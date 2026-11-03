import { AlertTriangle, FileEdit, FileMinus2, FilePlus2 } from "lucide-react";
import type { ApprovalFileSummary } from "@workspace/api-client-react";
import { Checkbox } from "@/shared/ui/checkbox";

export function FileItem({
  file,
  active,
  selectable,
  included,
  onToggle,
  onClick,
}: {
  file: ApprovalFileSummary;
  active: boolean;
  selectable: boolean;
  included: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  const Icon =
    file.kind === "added" ? FilePlus2 : file.kind === "deleted" ? FileMinus2 : FileEdit;
  const colorCls =
    file.kind === "added"
      ? "text-green-500"
      : file.kind === "deleted"
        ? "text-red-500"
        : "text-yellow-500";
  const conflict = file.mainChangedSinceSnapshot === true;
  return (
    <li
      className={`w-full rounded-sm flex items-center gap-2 text-sm pr-1 ${
        active ? "bg-primary/10" : "hover-elevate"
      } ${!included ? "opacity-50" : ""}`}
    >
      {selectable && (
        <span className="pl-2" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={included}
            onCheckedChange={onToggle}
            data-testid={`diff-file-toggle-${file.path}`}
            aria-label={`Include ${file.path} in approval`}
          />
        </span>
      )}
      <button
        type="button"
        onClick={onClick}
        data-testid={`diff-file-${file.path}`}
        className="flex-1 text-left px-2 py-2 flex items-center gap-2 min-w-0"
      >
        <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${colorCls}`} />
        <span className="font-mono text-xs truncate flex-1">{file.path}</span>
        {conflict && (
          <span
            title="Main has changed since this submission was created"
            data-testid={`diff-file-conflict-${file.path}`}
            className="text-amber-500"
          >
            <AlertTriangle className="h-3 w-3" />
          </span>
        )}
        {!file.binary && (
          <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
            <span className="text-green-500">+{file.additions}</span>{" "}
            <span className="text-red-500">-{file.deletions}</span>
          </span>
        )}
        {file.binary && (
          <span className="text-[10px] text-muted-foreground">binary</span>
        )}
      </button>
    </li>
  );
}
