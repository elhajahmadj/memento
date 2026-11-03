import { type ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";

/**
 * Standard "AI assist" trigger button. Shows a sparkle icon, optional
 * loading spinner, and a "powered by AI" tooltip with the active
 * model name when supplied.
 *
 * Disabled state: when `busy`, when `disabledReason` is set (e.g.
 * org/project disabled), or when explicitly `disabled`.
 */
export function AiAssistButton({
  onClick,
  busy,
  disabled,
  modelName,
  disabledReason,
  size,
  variant,
  testId,
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** Active model name surfaced in the tooltip. */
  modelName?: string | null | undefined;
  /** When set, the button is disabled and the tooltip explains why. */
  disabledReason?: string | undefined;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "secondary" | "ghost" | "outline";
  testId?: string;
  children: ReactNode;
}) {
  const isDisabled = !!busy || !!disabled || !!disabledReason;
  const tooltip = disabledReason
    ? disabledReason
    : `Powered by AI${modelName ? ` (${modelName})` : ""}`;
  const btn = (
    <Button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      size={size ?? "sm"}
      variant={variant ?? "secondary"}
      data-testid={testId}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
      )}
      {children}
    </Button>
  );
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{btn}</span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
