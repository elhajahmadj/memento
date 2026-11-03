import { Button } from "@/shared/ui/button";
import { MousePointerClick, Sparkles, Wrench } from "lucide-react";
import { A11yViolationsRow } from "./a11y-violations-row";
import { StepIcon } from "./step-icon";
import type { StepEvent } from "./types";
import { VisualDiffRow } from "./visual-diff-row";
import { FailureExplainer } from "./failure-explainer";
import type {
  FixSelectorContext,
  FixSelectorInitialTab,
} from "../../dialogs/fix-selector/types";

export function StepRow({
  runId,
  step,
  onFixSelector,
  buildContext,
}: {
  runId: string;
  step: StepEvent;
  onFixSelector: (ctx: FixSelectorContext, initialTab?: FixSelectorInitialTab) => void;
  buildContext: (step: StepEvent) => FixSelectorContext;
}) {
  return (
    <li
      className="text-xs flex items-start gap-2 font-mono"
      data-testid={`step-${runId}-${step.index}`}
    >
      <StepIcon status={step.status} />
      <span className="flex-1">
        <span className="text-muted-foreground">#{step.index + 1}</span>{" "}
        {step.description}
        {step.detail && (
          <span className="block text-muted-foreground">{step.detail}</span>
        )}
        {step.a11y && step.a11y.length > 0 && (
          <A11yViolationsRow
            runId={runId}
            stepIndex={step.index}
            violations={step.a11y}
          />
        )}
        {step.visual && (
          <VisualDiffRow
            runId={runId}
            stepIndex={step.index}
            visual={step.visual}
          />
        )}
        {step.status === "failed" && (
          <div className="mt-1">
            <FailureExplainer runId={runId} step={step} />
          </div>
        )}
      </span>
      {step.status === "failed" && step.failedSelector && (
        // Two explicit entry points + a fallback for the manual path,
        // so a non-coder doesn't have to think about "what's a tab".
        // All three open the same dialog, just on different tabs.
        <span className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] px-2"
            onClick={() => onFixSelector(buildContext(step), "ai")}
            data-testid={`button-fix-selector-ai-${runId}-${step.index}`}
            title="Suggest a replacement using AI"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Fix with AI
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] px-2"
            onClick={() => onFixSelector(buildContext(step), "repick")}
            data-testid={`button-fix-selector-repick-${runId}-${step.index}`}
            title="Click the element on a screenshot of the page"
          >
            <MousePointerClick className="h-3 w-3 mr-1" />
            Re-pick
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] px-2"
            onClick={() => onFixSelector(buildContext(step), "advanced")}
            data-testid={`button-fix-selector-${runId}-${step.index}`}
            title="Edit the selector text by hand"
          >
            <Wrench className="h-3 w-3" />
          </Button>
        </span>
      )}
    </li>
  );
}
