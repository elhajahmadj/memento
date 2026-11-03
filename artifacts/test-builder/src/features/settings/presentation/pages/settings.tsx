import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { useIsAnyAdmin, useIsGuest } from "@/features/auth/presentation/role";
import { CollapsibleSection } from "../components/collapsible-section";
import { AppearanceSection } from "../sections/appearance-section";
import { MocksSection } from "../sections/mocks-section";
import { SharedStepsSection } from "../sections/shared-steps-section";

/**
 * Legacy hash anchors from the old Settings page. After the
 * Settings/Admin/Tools re-org these sections live elsewhere, so a
 * bookmark like `/settings#architectures` should land the user on the
 * new home for that section.
 */
const HASH_REDIRECTS: Record<string, string> = {
  architectures: "/admin#architectures",
  recording: "/admin#recording",
  validation: "/admin#validation",
  maintenance: "/tools/maintenance",
  activity: "/tools/activity",
};

export function Settings() {
  const isAnyAdmin = useIsAnyAdmin();
  // Guests keep Appearance (it is purely cosmetic and stored on their
  // own user row) but get nothing that "sets up" a project — shared
  // steps included. The server-side allow-list already closes
  // `/shared-steps/*` and `/route-mocks/*`; this just avoids rendering
  // a panel whose every request would 403.
  const isGuest = useIsGuest();
  const [, navigate] = useLocation();
  const redirectedRef = useRef(false);

  // Old anchor hashes that point at sections which have moved.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    const target = hash ? HASH_REDIRECTS[hash] : undefined;
    if (target && !redirectedRef.current) {
      redirectedRef.current = true;
      navigate(target, { replace: true });
    }
  }, [navigate]);

  return (
    <PageShell
      contentClassName="max-w-4xl w-full"
      backTestId="button-settings-back"
    >
      <h1 className="text-3xl font-semibold mb-2">Settings</h1>
      <p className="text-muted-foreground mb-8">
        Personal preferences and per-project test helpers.
      </p>
      <div className="space-y-3">
        <CollapsibleSection
          title="Appearance"
          description={
            "Choose how Test Builder looks. \u201CFollow system\u201D tracks your OS preference."
          }
          testId="appearance"
        >
          <AppearanceSection />
        </CollapsibleSection>

        {isAnyAdmin && !isGuest && (
          <CollapsibleSection
            title="Mocks"
            description="Network mock rules applied to the active project's recordings and replays."
            testId="mocks"
          >
            <MocksSection />
          </CollapsibleSection>
        )}

        {!isGuest && <SharedStepsSection />}
      </div>
    </PageShell>
  );
}
