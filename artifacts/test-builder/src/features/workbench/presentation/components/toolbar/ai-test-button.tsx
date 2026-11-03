import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Sparkles } from "lucide-react";
import {
  useGetAiAgentStatus,
  getGetAiAgentStatusQueryKey,
} from "@workspace/api-client-react";
import { TestWithAiDialog } from "@/features/workbench/presentation/dialogs/test-with-ai-dialog";
import { useIsGuest } from "@/features/auth/presentation/role";

export function AiTestButton({
  projectName,
  projectId,
  language,
  solutionType,
  extraDisabledReason,
}: {
  projectName: string;
  projectId: string;
  language: "csharp" | "python" | "nodejs" | "java";
  solutionType?: "playwright" | "api" | undefined;
  // Caller-supplied reason that overrides the ready check (e.g. while
  // an open-browser session is live). Wins over the normal tooltip.
  extraDisabledReason?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  // Guests have no AI features at all, and `/ai-agent/*` is closed to
  // them server-side. Skip the status probe entirely so we don't fire a
  // request that can only 403.
  const isGuest = useIsGuest();
  const { data: status } = useGetAiAgentStatus(projectName, {
    query: {
      queryKey: getGetAiAgentStatusQueryKey(projectName),
      refetchOnWindowFocus: false,
      enabled: !isGuest,
    },
  });
  const ready = status?.ready ?? false;
  const reason = status?.reason ?? null;
  let tooltip = "Build a test from a plain-English plan";
  if (!ready) {
    if (reason === "ORG_DISABLED")
      tooltip = "AI Agent is disabled for this organization. Enable it in Tools → AI Agent.";
    else if (reason === "PROJECT_DISABLED")
      tooltip = "AI Agent is disabled for this project. Enable it in Tools → AI Agent.";
    else if (reason === "NO_API_KEY")
      tooltip = "No AI provider API key on file. Add one in Tools → AI Agent.";
    else tooltip = "AI Agent is not ready. Check Tools → AI Agent.";
  }
  // Caller-supplied reasons (e.g. "open-browser session is live") win
  // over the ready check so the user sees the most actionable reason.
  const effectiveDisabled = !ready || !!extraDisabledReason;
  const effectiveTooltip = extraDisabledReason ?? tooltip;
  // Auto-derive the kind from the project's solution type so the
  // dialog opens already on the right tab — Playwright projects can
  // still flip to API/Unit if needed.
  const defaultKind: "playwright" | "api" =
    solutionType === "api" ? "api" : "playwright";
  // Hidden rather than disabled: a disabled button with a "not
  // available" tooltip advertises a feature the guest can never unlock
  // in this session, which is worse than simply not offering it.
  if (isGuest) return null;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => !effectiveDisabled && setOpen(true)}
        disabled={effectiveDisabled}
        title={effectiveTooltip}
        data-testid="button-test-with-ai"
      >
        <Sparkles className="h-4 w-4 mr-2" />
        Build with AI
      </Button>
      <TestWithAiDialog
        open={open}
        onOpenChange={setOpen}
        projectName={projectName}
        projectId={projectId}
        defaultLanguage={language}
        defaultKind={defaultKind}
      />
    </>
  );
}
