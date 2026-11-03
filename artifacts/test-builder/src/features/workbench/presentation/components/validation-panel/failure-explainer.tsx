import { useState } from "react";
import { HelpCircle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { useAiAssist } from "@/shared/ai-assist/use-ai-assist";
import type { StepEvent } from "./types";

interface FailureExplanation {
  plainEnglishReason: string;
  suggestedNextAction: string;
}

/**
 * Inline "Why did this fail?" affordance for a failed validation
 * step. Sends the step description + error to the failure-reason AI
 * purpose and renders the plain-English explanation + suggested
 * next action below the step row.
 *
 * Graceful degradation:
 *  - When the org/project has no AI key, the button is still
 *    clickable but on click renders the server's disabled message
 *    inline instead of erroring loudly (the user learns where to
 *    configure the key without leaving the panel).
 */
export function FailureExplainer({
  runId,
  step,
}: {
  runId: string;
  step: StepEvent;
}) {
  const [open, setOpen] = useState(false);
  const hook = useAiAssist<
    {
      stepDescription: string;
      errorMessage: string;
      failedSelector?: string;
    },
    FailureExplanation
  >({ purpose: "failure-reason", toastOnError: false });

  const explain = async () => {
    setOpen(true);
    if (hook.lastResult) return; // already have it
    await hook.run({
      stepDescription: step.description,
      errorMessage: step.detail ?? step.description,
      ...(step.failedSelector ? { failedSelector: step.failedSelector } : {}),
    });
  };

  const tooltipText = hook.lastResult?.model
    ? `Powered by AI (${hook.lastResult.model})`
    : "Powered by AI — translate this error into plain English";
  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] px-2"
              onClick={explain}
              disabled={hook.busy}
              data-testid={`button-explain-failure-${runId}-${step.index}`}
            >
              {hook.busy ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <HelpCircle className="h-3 w-3 mr-1" />
              )}
              Why did this fail?
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{tooltipText}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {open && (hook.lastResult || hook.error || hook.busy) && (
        <div
          className="mt-1.5 ml-5 rounded border bg-muted/40 p-2 text-[11px] space-y-1"
          data-testid={`failure-explanation-${runId}-${step.index}`}
        >
          {hook.busy && (
            <div className="text-muted-foreground italic">
              Asking AI to translate this error…
            </div>
          )}
          {hook.error && (
            <div
              className={
                hook.error.code === "disabled"
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-destructive"
              }
            >
              {hook.error.message}
            </div>
          )}
          {hook.lastResult && (
            <>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Sparkles className="h-3 w-3 text-amber-500" />
                <span className="text-[10px] uppercase tracking-wide">
                  AI explanation
                  {hook.lastResult.model ? ` · ${hook.lastResult.model}` : ""}
                </span>
              </div>
              <div className="font-sans">
                {hook.lastResult.output.plainEnglishReason}
              </div>
              <div className="font-sans text-muted-foreground">
                <span className="font-semibold">Try: </span>
                {hook.lastResult.output.suggestedNextAction}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
