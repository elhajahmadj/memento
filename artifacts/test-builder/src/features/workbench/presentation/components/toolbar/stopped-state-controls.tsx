import { Button } from "@/shared/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";

export function StoppedStateControls({
  canSaveDirectly,
  finalizePending,
  pendingApproval,
  onDiscard,
  onSave,
  onSubmitForApproval,
}: {
  /**
   * True when this user's recordings go straight to the project instead
   * of through SDET review. Admins (their changes land on main) and
   * guests (a throwaway solo trial — there is no reviewer, and they own
   * no fork to submit from) both save directly.
   */
  canSaveDirectly: boolean;
  finalizePending: boolean;
  pendingApproval: boolean;
  onDiscard: () => void;
  onSave: () => void;
  onSubmitForApproval: () => void;
}) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={onDiscard}
        data-testid="button-discard-recording"
      >
        Discard
      </Button>
      {canSaveDirectly ? (
        <Button
          variant="default"
          size="sm"
          onClick={onSave}
          disabled={finalizePending}
          data-testid="button-save-recording"
        >
          {finalizePending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4 mr-2" />
          )}
          Save
        </Button>
      ) : (
        <Button
          variant="default"
          size="sm"
          onClick={onSubmitForApproval}
          disabled={finalizePending || pendingApproval}
          title={
            pendingApproval
              ? "An approval is already pending for this project"
              : undefined
          }
          data-testid="button-request-approval"
        >
          {finalizePending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4 mr-2" />
          )}
          {pendingApproval ? "Approval pending" : "Request SDET approval"}
        </Button>
      )}
    </>
  );
}
