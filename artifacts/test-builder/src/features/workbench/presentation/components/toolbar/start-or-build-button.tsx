import { Button } from "@/shared/ui/button";
import { Play } from "lucide-react";

export function StartOrBuildButton({
  isApi,
  pendingApproval,
  onStart,
}: {
  isApi: boolean;
  pendingApproval: boolean;
  onStart: () => void;
}) {
  if (isApi) {
    return (
      <Button
        variant="default"
        size="sm"
        onClick={onStart}
        data-testid="button-build-test"
      >
        <Play className="h-4 w-4 mr-2 fill-current" />
        Build test
      </Button>
    );
  }
  return (
    <Button
      variant="default"
      size="sm"
      onClick={onStart}
      disabled={pendingApproval}
      title={
        pendingApproval
          ? "An approval is pending for this project. Wait for the SDET decision before recording again."
          : undefined
      }
      data-testid="button-start-recording"
    >
      <Play className="h-4 w-4 mr-2 fill-current" />
      {pendingApproval ? "Awaiting SDET approval" : "Start Recording"}
    </Button>
  );
}
