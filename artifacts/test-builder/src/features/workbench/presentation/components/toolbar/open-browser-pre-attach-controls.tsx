import { Button } from "@/shared/ui/button";
import { Loader2, Play, X } from "lucide-react";

export function OpenBrowserPreAttachControls({
  onAttach,
  onStartFresh,
  onClose,
  isClosing,
}: {
  onAttach: () => void;
  // Open the standard Start Recording dialog so the user can launch a
  // brand-new recording session (different URL, new suite, etc.). The
  // backend tears down the kept-open browser owned by the same user
  // when /recording/start is called, so submitting the dialog cleanly
  // replaces the pre-attach session.
  onStartFresh: () => void;
  onClose: () => void;
  isClosing: boolean;
}) {
  return (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={onAttach}
        data-testid="button-start-recording-attach"
      >
        <Play className="h-4 w-4 mr-2 fill-current" />
        Start Recording
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onStartFresh}
        data-testid="button-start-recording"
        title="Discard the kept-open browser and start a fresh recording."
      >
        <Play className="h-4 w-4 mr-2" />
        New Recording
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onClose}
        disabled={isClosing}
        data-testid="button-close-open-browser"
      >
        {isClosing ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <X className="h-4 w-4 mr-2" />
        )}
        Close Browser
      </Button>
    </>
  );
}
