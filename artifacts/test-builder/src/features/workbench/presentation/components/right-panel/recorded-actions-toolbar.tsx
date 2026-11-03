import { Button } from "@/shared/ui/button";
import { Activity, Play, Plus } from "lucide-react";

export function RecordedActionsToolbar({
  recording,
  stopped,
  onValidateSession,
  onOpenAssertion,
  onOpenApiCheck,
  onOpenWait,
  onOpenCaptureLogin,
}: {
  recording: boolean;
  stopped: boolean;
  // Omitted for JMX projects so the "Validate" button in the stopped
  // toolbar disappears while the other stopped-state buttons remain.
  onValidateSession?: (() => void) | undefined;
  onOpenAssertion: () => void;
  onOpenApiCheck: () => void;
  onOpenWait: () => void;
  onOpenCaptureLogin: () => void;
}) {
  return (
    <div className="border-t border-sidebar-border h-9 flex items-center px-3 text-xs font-mono uppercase tracking-wider text-muted-foreground">
      <Activity className="h-3.5 w-3.5 mr-2" />
      Recorded Actions
      {recording && (
        <span className="ml-auto inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-destructive">LIVE</span>
        </span>
      )}
      {stopped && (
        <div className="ml-auto flex items-center gap-1">
          {onValidateSession && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onValidateSession}
              data-testid="button-validate-session"
            >
              <Play className="h-3 w-3 mr-1 fill-current" />
              Validate
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={onOpenAssertion}
            data-testid="button-add-assertion"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add assertion
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={onOpenApiCheck}
            data-testid="button-add-api-check"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add API check
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={onOpenWait}
            data-testid="button-add-wait"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add wait
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("recorder:request-open-insert-shared-step"),
              )
            }
            data-testid="button-insert-shared-step"
            title="Splice a saved RecordedAction macro"
          >
            <Plus className="h-3 w-3 mr-1" />
            Shared step
          </Button>
        </div>
      )}
      {!recording && !stopped && (
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={onOpenCaptureLogin}
            data-testid="button-capture-login"
            title="Capture login storageState for reuse"
          >
            Capture login
          </Button>
        </div>
      )}
    </div>
  );
}
