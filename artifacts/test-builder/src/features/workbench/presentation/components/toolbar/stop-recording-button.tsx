import { Button } from "@/shared/ui/button";
import { Loader2, Square } from "lucide-react";

export function StopRecordingButton({
  onStop,
  isPending,
}: {
  onStop: () => void;
  isPending: boolean;
}) {
  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={onStop}
      disabled={isPending}
      data-testid="button-stop-recording"
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Square className="h-4 w-4 mr-2 fill-current" />
      )}
      Stop Recording
    </Button>
  );
}
