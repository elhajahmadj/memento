import { PageShell } from "@/shared/ui/shell/page-shell";
import { useIsAnyAdmin } from "@/features/auth/presentation/role";
import {
  SwitchOrgGatePage,
  useSwitchOrgGate,
} from "@/features/auth/presentation/switch-org-gate";
import { ActivitySection } from "@/features/settings/presentation/pages/settings-activity";

export function ToolsActivity() {
  const isAnyAdmin = useIsAnyAdmin();
  const { canPromptSwitch } = useSwitchOrgGate({
    allowed: isAnyAdmin,
    requires: "anyAdmin",
    pageLabel: "Activity",
  });

  if (!isAnyAdmin) {
    if (!canPromptSwitch) return null;
    return (
      <SwitchOrgGatePage
        pageLabel="Activity"
        description="Single timeline of who changed what file on which project."
        requires="anyAdmin"
        testId="activity-switch-org-prompt"
        contentClassName="max-w-4xl w-full"
        backTestId="button-activity-back"
        backTo="/tools"
        backLabel="Back to Tools"
      />
    );
  }

  return (
    <PageShell
      contentClassName="max-w-4xl w-full"
      backTestId="button-activity-back"
      backTo="/tools"
      backLabel="Back to Tools"
    >
      <h1 className="text-3xl font-semibold mb-2">Activity</h1>
      <p className="text-muted-foreground mb-8">
        Single timeline of who changed what file on which project.
      </p>
      <ActivitySection />
    </PageShell>
  );
}
