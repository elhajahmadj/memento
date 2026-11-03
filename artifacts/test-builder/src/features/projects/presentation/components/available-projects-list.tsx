import { ArrowRight, Clock, Download } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { LanguageBadge } from "./language-badge";
import { SolutionTypeBadge } from "./solution-type-badge";
import {
  exportButtonLabel,
  useExportProject,
} from "../hooks/use-export-project";

export interface AvailableProjectRow {
  solutionName: string;
  slnPath: string;
  language?: import("@workspace/api-client-react").Language;
  solutionType?: import("@workspace/api-client-react").SolutionType;
  hasAccess?: boolean;
  hasPendingRequest?: boolean;
  pendingApproval?: boolean;
  disabled?: boolean | null;
  pendingDeletion?: {
    requestId: string;
    requestedByUserId: string;
    requestedByUsername: string;
    requestedAt: string;
    isOwnRequest: boolean;
  } | null;
  pendingClearFiles?: {
    requestId: string;
    requestedByUserId: string;
    requestedByUsername: string;
    requestedAt: string;
    isOwnRequest: boolean;
  } | null;
}

interface Props {
  projects: AvailableProjectRow[];
  isAdmin: boolean;
  onLoad: (slnPath: string) => void;
  loadDisabled: boolean;
  onRequestAccess: (projectName: string) => void;
  requestPending: boolean;
  pendingApprovalRequestIdByProject?: Map<string, string>;
  onCancelPendingApproval?: (requestId: string) => void;
  cancelPending?: boolean;
}

export function AvailableProjectsList({
  projects,
  isAdmin,
  onLoad,
  loadDisabled,
  onRequestAccess,
  requestPending,
  pendingApprovalRequestIdByProject,
  onCancelPendingApproval,
  cancelPending,
}: Props) {
  const { exportProject, isExporting } = useExportProject();
  return (
    <ul className="space-y-2" data-testid="list-projects">
      {projects.map((p) => {
        const myPendingRequestId =
          pendingApprovalRequestIdByProject?.get(p.solutionName);
        const limitedNoAccess = !isAdmin && p.hasAccess === false;
        if (p.pendingApproval && myPendingRequestId) {
          return (
            <li key={p.slnPath}>
              <div
                className="w-full rounded-md border border-dashed border-border bg-card/60 px-4 py-3 flex items-center justify-between gap-3"
                data-testid={`row-pending-approval-${p.solutionName}`}
              >
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    <span className="truncate">{p.solutionName}</span>
                    <LanguageBadge language={p.language} />
                    <SolutionTypeBadge solutionType={p.solutionType} />
                    <span
                      className="text-xs rounded-full border border-border px-2 py-0.5 text-muted-foreground"
                      data-testid={`badge-pending-approval-${p.solutionName}`}
                    >
                      Pending approval
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate max-w-md">
                    {p.slnPath}
                  </div>
                </div>
                {onCancelPendingApproval && (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`button-cancel-pending-${p.solutionName}`}
                    onClick={() => onCancelPendingApproval(myPendingRequestId)}
                    disabled={cancelPending}
                  >
                    Cancel request
                  </Button>
                )}
              </div>
            </li>
          );
        }
        return (
          <li key={p.slnPath}>
            {limitedNoAccess ? (
              <div
                className="w-full rounded-md border border-border bg-card px-4 py-3 flex items-center justify-between gap-3"
                data-testid={`row-no-access-${p.solutionName}`}
              >
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    <span className="truncate">{p.solutionName}</span>
                    <LanguageBadge language={p.language} />
                    <SolutionTypeBadge solutionType={p.solutionType} />
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate max-w-md">
                    {p.slnPath}
                  </div>
                </div>
                {p.hasPendingRequest ? (
                  <span
                    className="text-xs text-muted-foreground"
                    data-testid={`text-access-pending-${p.solutionName}`}
                  >
                    Request pending
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`button-request-access-${p.solutionName}`}
                    onClick={() => onRequestAccess(p.solutionName)}
                    disabled={requestPending}
                  >
                    Request access
                  </Button>
                )}
              </div>
            ) : (
              // The row itself is the "load project" affordance, but we
              // also render a real <button> for export inline. Nesting two
              // <button>s is invalid HTML, so the outer element is a
              // <div role="button"> with explicit keyboard handling
              // instead of a <button>.
              <div
                role="button"
                tabIndex={loadDisabled ? -1 : 0}
                aria-disabled={loadDisabled}
                onClick={() => {
                  if (loadDisabled) return;
                  onLoad(p.slnPath);
                }}
                onKeyDown={(e) => {
                  if (loadDisabled) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onLoad(p.slnPath);
                  }
                }}
                className={`w-full text-left rounded-md border border-border bg-card hover-elevate active-elevate-2 px-4 py-3 flex items-center justify-between transition-colors ${
                  loadDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                }`}
                data-testid={`button-load-${p.solutionName}`}
              >
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    <span className="truncate">{p.solutionName}</span>
                    <LanguageBadge language={p.language} />
                    <SolutionTypeBadge solutionType={p.solutionType} />
                    {p.pendingDeletion && (
                      <span
                        className="text-xs uppercase text-amber-700 border border-amber-300 bg-amber-50 rounded px-1.5 py-0.5 inline-flex items-center gap-1"
                        data-testid={`badge-pending-deletion-${p.solutionName}`}
                        title={`Requested by ${p.pendingDeletion.requestedByUsername}`}
                      >
                        <Clock className="h-3 w-3" />
                        Pending deletion
                      </span>
                    )}
                    {p.pendingClearFiles && (
                      <span
                        className="text-xs uppercase text-amber-700 border border-amber-300 bg-amber-50 rounded px-1.5 py-0.5 inline-flex items-center gap-1"
                        data-testid={`badge-pending-clear-files-${p.solutionName}`}
                        title={`Requested by ${p.pendingClearFiles.requestedByUsername}`}
                      >
                        <Clock className="h-3 w-3" />
                        Pending file clear
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate max-w-md">
                    {p.slnPath}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isExporting}
                    data-testid={`button-export-${p.solutionName}`}
                    onClick={(e) => {
                      // Prevent the row's load handler from firing when
                      // the user clicks export.
                      e.stopPropagation();
                      void exportProject({
                        solutionName: p.solutionName,
                        language: p.language,
                        slnPath: p.slnPath,
                      });
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {exportButtonLabel(p.language)}
                  </Button>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
