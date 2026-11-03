import { ValidationPanel } from "@/features/workbench/presentation/components/validation-panel";
import type { WorkbenchDialogState } from "../hooks/useWorkbenchDialogs";
import { StartRecordingDialog } from "../dialogs/start-recording-dialog";
import { BuildTestDialog } from "../dialogs/build-test-dialog";
import { AddTestClassDialog } from "../dialogs/add-test-class-dialog";
import { AddTestMethodDialog } from "../dialogs/add-test-method-dialog";
import { RenameDialog } from "../dialogs/rename-dialog";
import { DeleteConfirmDialog } from "../dialogs/delete-confirm-dialog";
import { CreateChildDialog } from "../dialogs/create-child-dialog";
import { AiStepDialog } from "../dialogs/ai-step-dialog";

/**
 * Map the AI assertion purpose's normalized output kinds onto the
 * `add-assertion` WebSocket detail shape consumed by the recording
 * server. Returns `null` for kinds we don't have a clean mapping for
 * (the caller skips the dispatch).
 */
function mapAiAssertionToWsDetail(o: {
  kind: string;
  target: string;
  expected?: string;
}): Record<string, unknown> | null {
  const target = (o.target ?? "").trim();
  const expected = (o.expected ?? "").trim();
  switch (o.kind) {
    case "text-contains":
      return {
        assertKind: "element-has-text",
        selector: target || "body",
        assertText: expected || target,
      };
    case "url-contains":
      return { assertKind: "url-contains", assertUrl: target };
    case "url-equals":
      return { assertKind: "url-equals", assertUrl: target };
    case "element-visible":
      return { assertKind: "element-visible", selector: target };
    case "element-hidden":
      return { assertKind: "element-hidden", selector: target };
    case "accessibility":
      return { assertKind: "accessibility", axeImpactLevel: "serious" };
    case "visual-baseline":
      return {
        assertKind: "visual-baseline",
        visualName: target || "baseline",
        visualThreshold: 0.1,
      };
    default:
      return null;
  }
}

interface Props {
  dialogs: WorkbenchDialogState;
  tests: Array<{ className: string; path: string }>;
  solutionName: string;
}

export function WorkbenchDialogs({ dialogs, tests, solutionName }: Props) {
  return (
    <>
      <StartRecordingDialog
        open={dialogs.startDialogOpen}
        onOpenChange={dialogs.setStartDialogOpen}
        tests={tests}
      />
      <StartRecordingDialog
        open={dialogs.attachDialogOpen}
        onOpenChange={dialogs.setAttachDialogOpen}
        tests={tests}
        attachToOpenBrowser
      />
      <BuildTestDialog
        open={dialogs.buildTestOpen}
        onOpenChange={dialogs.setBuildTestOpen}
        solutionName={solutionName}
      />
      <AddTestClassDialog
        open={dialogs.addClassOpen}
        onOpenChange={dialogs.setAddClassOpen}
      />
      <AddTestMethodDialog
        filePath={dialogs.addMethodFor}
        onClose={() => dialogs.setAddMethodFor(null)}
      />
      <RenameDialog
        target={dialogs.renameTarget}
        onClose={() => dialogs.setRenameTarget(null)}
      />
      <DeleteConfirmDialog
        target={dialogs.deleteTarget}
        onClose={() => dialogs.setDeleteTarget(null)}
      />
      <CreateChildDialog
        kind="folder"
        parent={dialogs.addFolderUnder}
        onClose={() => dialogs.setAddFolderUnder(null)}
      />
      <CreateChildDialog
        kind="file"
        parent={dialogs.addFileUnder}
        onClose={() => dialogs.setAddFileUnder(null)}
      />
      <ValidationPanel
        open={dialogs.validateOpen}
        onOpenChange={dialogs.setValidateOpen}
      />
      <AiStepDialog
        open={dialogs.aiAuthorMode !== null}
        onOpenChange={(v) => {
          if (!v) dialogs.setAiAuthorMode(null);
        }}
        mode={dialogs.aiAuthorMode ?? "assertion"}
        pageUrl={typeof window !== "undefined" ? window.location.href : undefined}
        onAccept={(result) => {
          if (dialogs.aiAuthorMode === "assertion") {
            const detail = mapAiAssertionToWsDetail(
              result as {
                kind: string;
                target: string;
                expected?: string;
              },
            );
            if (!detail) return false;
            window.dispatchEvent(
              new CustomEvent("recorder:request-add-assertion", { detail }),
            );
            return true;
          }
          // Step authoring: only the `wait` verb has a clean WS
          // insert path today. Everything else (click/fill/navigate)
          // requires live browser capture; we return false so the
          // dialog surfaces a clear "open the recorder" warning
          // instead of a misleading "Step inserted" toast.
          const step = result as {
            verb: string;
            selector: string;
            value?: string;
          };
          if (step.verb === "wait") {
            window.dispatchEvent(
              new CustomEvent("recorder:request-add-wait", {
                detail: { waitKind: "selector", waitSelector: step.selector },
              }),
            );
            return true;
          }
          return false;
        }}
      />
    </>
  );
}
