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

interface SummaryOutput {
  summaryMarkdown: string;
}

/**
 * "Explain this suite in plain English" AI assist dialog. Renders
 * the markdown summary returned by the `suite-summary` purpose as
 * preformatted text (no markdown renderer is installed in the
 * test-builder bundle — `whitespace-pre-wrap` preserves the headings
 * and bullets the model emits).
 */
export function SummarizeSuiteDialog({
  open,
  onOpenChange,
  projectName,
  testNames,
  sampleSteps,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectName: string;
  testNames: string[];
  sampleSteps?: string[];
}) {
  const hook = useAiAssist<
    {
      projectName: string;
      testNames: string[];
      sampleSteps?: string[];
    },
    SummaryOutput
  >({ purpose: "suite-summary", toastOnError: false });

  // Auto-trigger on open so the user lands on a populated dialog
  // instead of an empty shell with a single button.
  useEffect(() => {
    if (!open) return;
    if (hook.lastResult || hook.busy || hook.error) return;
    if (!projectName || testNames.length === 0) return;
    const input: {
      projectName: string;
      testNames: string[];
      sampleSteps?: string[];
    } = { projectName, testNames };
    if (sampleSteps && sampleSteps.length > 0) input.sampleSteps = sampleSteps;
    void hook.run(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onClose = (v: boolean) => {
    if (!v) hook.reset();
    onOpenChange(v);
  };

  const disabledReason =
    hook.error?.code === "disabled" ? hook.error.message : undefined;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Summarize this suite</DialogTitle>
          <DialogDescription>
            A plain-English overview of what {projectName || "this project"}
            's test suite covers, generated from the {testNames.length} test
            {testNames.length === 1 ? "" : "s"} on disk.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 min-h-[8rem]">
          {testNames.length === 0 ? (
            <div
              className="text-sm text-muted-foreground"
              data-testid="text-summarize-suite-empty"
            >
              No tests found yet for this project. Add a test first, then
              come back to generate a summary.
            </div>
          ) : hook.error && hook.error.code !== "disabled" ? (
            <div
              className="text-sm text-destructive"
              data-testid="text-summarize-suite-error"
            >
              {hook.error.message}
            </div>
          ) : hook.lastResult ? (
            <pre
              className="text-sm whitespace-pre-wrap font-sans rounded-md bg-muted/40 p-3"
              data-testid="text-summarize-suite-output"
            >
              {hook.lastResult.output.summaryMarkdown}
            </pre>
          ) : (
            <div
              className="text-sm text-muted-foreground"
              data-testid="text-summarize-suite-pending"
            >
              {hook.busy ? "Asking the AI…" : "Click Summarize to start."}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Close
          </Button>
          <AiAssistButton
            testId="button-summarize-suite-run"
            busy={hook.busy}
            disabled={testNames.length === 0}
            disabledReason={disabledReason}
            modelName={hook.lastResult?.model}
            onClick={() => {
              const input: {
                projectName: string;
                testNames: string[];
                sampleSteps?: string[];
              } = { projectName, testNames };
              if (sampleSteps && sampleSteps.length > 0)
                input.sampleSteps = sampleSteps;
              void hook.run(input);
            }}
          >
            {hook.lastResult ? "Regenerate" : "Summarize"}
          </AiAssistButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
