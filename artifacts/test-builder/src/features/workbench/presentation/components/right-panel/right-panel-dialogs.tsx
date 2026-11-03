import { AddAssertionDialog } from "../../dialogs/add-assertion-dialog";
import { AddApiCheckDialog } from "../../dialogs/add-api-check-dialog";
import { AddWaitDialog } from "../../dialogs/add-wait-dialog";
import { CaptureLoginDialog } from "../../dialogs/capture-login-dialog";

export function RightPanelDialogs({
  assertionOpen,
  onAssertionOpenChange,
  assertionInitial,
  assertionInsertBefore,
  apiCheckOpen,
  onApiCheckOpenChange,
  waitOpen,
  onWaitOpenChange,
  captureLoginOpen,
  onCaptureLoginOpenChange,
}: {
  assertionOpen: boolean;
  onAssertionOpenChange: (open: boolean) => void;
  assertionInitial: { selector: string; text: string } | null;
  assertionInsertBefore: number | null;
  apiCheckOpen: boolean;
  onApiCheckOpenChange: (open: boolean) => void;
  waitOpen: boolean;
  onWaitOpenChange: (open: boolean) => void;
  captureLoginOpen: boolean;
  onCaptureLoginOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <AddAssertionDialog
        open={assertionOpen}
        onOpenChange={onAssertionOpenChange}
        initial={assertionInitial}
        insertBeforeIndex={assertionInsertBefore}
      />
      <AddApiCheckDialog open={apiCheckOpen} onOpenChange={onApiCheckOpenChange} />
      <AddWaitDialog open={waitOpen} onOpenChange={onWaitOpenChange} />
      <CaptureLoginDialog
        open={captureLoginOpen}
        onOpenChange={onCaptureLoginOpenChange}
      />
    </>
  );
}
