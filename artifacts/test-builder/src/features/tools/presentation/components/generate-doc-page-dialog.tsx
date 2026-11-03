import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { AiAssistButton } from "@/shared/ai-assist/ai-assist-button";
import { useAiAssist } from "@/shared/ai-assist/use-ai-assist";

interface DocOutput {
  markdown: string;
}

/**
 * "Generate doc page" AI assist dialog. Calls the `doc-page` purpose
 * and renders the returned Markdown as preformatted text. Lets the
 * user copy the result into the clipboard so they can paste it into
 * a wiki / handoff doc.
 */
export function GenerateDocPageDialog({
  open,
  onOpenChange,
  projectName,
  testNames,
  recentFailures,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectName: string;
  testNames: string[];
  recentFailures?: string[];
}) {
  const hook = useAiAssist<
    {
      projectName: string;
      testNames: string[];
      recentFailures?: string[];
    },
    DocOutput
  >({ purpose: "doc-page", toastOnError: false });

  useEffect(() => {
    if (!open) return;
    if (hook.lastResult || hook.busy || hook.error) return;
    if (!projectName || testNames.length === 0) return;
    const input: {
      projectName: string;
      testNames: string[];
      recentFailures?: string[];
    } = { projectName, testNames };
    if (recentFailures && recentFailures.length > 0)
      input.recentFailures = recentFailures;
    void hook.run(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onClose = (v: boolean) => {
    if (!v) hook.reset();
    onOpenChange(v);
  };

  const disabledReason =
    hook.error?.code === "disabled" ? hook.error.message : undefined;

  const copyToClipboard = async () => {
    if (!hook.lastResult) return;
    try {
      await navigator.clipboard.writeText(hook.lastResult.output.markdown);
    } catch {
      /* clipboard unavailable — silently no-op */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate documentation page</DialogTitle>
          <DialogDescription>
            A one-page "What this app does and what we test" doc for{" "}
            {projectName || "this project"}. Copy the Markdown into your
            team's wiki when you're happy with it.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 min-h-[8rem]">
          {testNames.length === 0 ? (
            <div
              className="text-sm text-muted-foreground"
              data-testid="text-generate-doc-empty"
            >
              No tests found yet for this project. Add a test first.
            </div>
          ) : hook.error && hook.error.code !== "disabled" ? (
            <div
              className="text-sm text-destructive"
              data-testid="text-generate-doc-error"
            >
              {hook.error.message}
            </div>
          ) : hook.lastResult ? (
            <pre
              className="text-sm whitespace-pre-wrap font-sans rounded-md bg-muted/40 p-3"
              data-testid="text-generate-doc-output"
            >
              {hook.lastResult.output.markdown}
            </pre>
          ) : (
            <div
              className="text-sm text-muted-foreground"
              data-testid="text-generate-doc-pending"
            >
              {hook.busy ? "Asking the AI…" : "Click Generate to start."}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Close
          </Button>
          {hook.lastResult ? (
            <Button
              variant="outline"
              onClick={() => void copyToClipboard()}
              data-testid="button-generate-doc-copy"
            >
              Copy Markdown
            </Button>
          ) : null}
          <AiAssistButton
            testId="button-generate-doc-run"
            busy={hook.busy}
            disabled={testNames.length === 0}
            disabledReason={disabledReason}
            modelName={hook.lastResult?.model}
            onClick={() => {
              const input: {
                projectName: string;
                testNames: string[];
                recentFailures?: string[];
              } = { projectName, testNames };
              if (recentFailures && recentFailures.length > 0)
                input.recentFailures = recentFailures;
              void hook.run(input);
            }}
          >
            {hook.lastResult ? "Regenerate" : "Generate"}
          </AiAssistButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
