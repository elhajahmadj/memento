import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { PageShell } from "@/shared/ui/shell/page-shell";
import {
  ROLE_PREDICATES,
  useOrgsMatchingRole,
} from "@/features/auth/presentation/role";
import { SwitchOrgPrompt } from "@/features/auth/presentation/switch-org-prompt";

/**
 * Symbolic name for the role gate enforced on a page. Maps to the
 * matching `ROLE_PREDICATES` entry. Keeps call sites from having to
 * import `ROLE_PREDICATES` themselves (which makes the gate easier to
 * stub in tests that mock the role module).
 */
export type SwitchOrgGateRole = "admin" | "anyAdmin" | "limitedAdmin";

function predicateFor(role: SwitchOrgGateRole) {
  if (role === "admin") return ROLE_PREDICATES.admin;
  if (role === "limitedAdmin") return ROLE_PREDICATES.limitedAdmin;
  return ROLE_PREDICATES.anyAdmin;
}

/**
 * Shared role-gate hook for pages that should auto-suggest an org
 * switch when the active org fails the gate but another of the user's
 * orgs grants the required role. Encapsulates the
 * "redirect-when-denied / prompt-when-recoverable" decision that used
 * to be copy-pasted in every gated page.
 *
 * - When `allowed`, returns `{ canPromptSwitch: false }` and does
 *   nothing — the page renders normally.
 * - When `!allowed` and another org grants the required role, returns
 *   `{ canPromptSwitch: true }` and does NOT redirect. The page should
 *   render `<SwitchOrgGatePage />` (or its own equivalent shell that
 *   renders `<SwitchOrgPrompt />`).
 * - When `!allowed` and no other org qualifies, fires a single
 *   error toast and replaces the URL with `redirectTo` (default `/`).
 *
 * Memento Admin users always satisfy any predicate via `effectiveRole`,
 * so they hit the `allowed` branch and never reach the prompt path.
 */
export function useSwitchOrgGate({
  allowed,
  requires,
  pageLabel,
  toastMessage,
  redirectTo = "/",
}: {
  allowed: boolean;
  requires: SwitchOrgGateRole;
  pageLabel: string;
  toastMessage?: string;
  redirectTo?: string;
}): { canPromptSwitch: boolean } {
  const switchCandidates = useOrgsMatchingRole(predicateFor(requires));
  const canPromptSwitch = !allowed && switchCandidates.length > 0;
  const [, navigate] = useLocation();
  const redirected = useRef(false);

  useEffect(() => {
    if (!allowed && !canPromptSwitch && !redirected.current) {
      redirected.current = true;
      toast.error(toastMessage ?? `You don't have access to ${pageLabel}`);
      navigate(redirectTo, { replace: true });
    }
  }, [allowed, canPromptSwitch, navigate, toastMessage, pageLabel, redirectTo]);

  return { canPromptSwitch };
}

/**
 * Standard "switch-org" fallback shell used when the active org fails
 * the gate but the user has the required role in another org. Renders
 * the same `PageShell` + heading + `SwitchOrgPrompt` combo the
 * `/admin` page wired up so every gated page gets identical
 * one-click recovery UX.
 */
export function SwitchOrgGatePage({
  pageLabel,
  description,
  requires,
  testId,
  contentClassName = "max-w-5xl w-full",
  backTestId,
  backTo,
  backLabel,
  headerExtras,
}: {
  pageLabel: string;
  description?: ReactNode;
  requires: SwitchOrgGateRole;
  testId: string;
  contentClassName?: string;
  backTestId?: string;
  backTo?: string;
  backLabel?: string;
  headerExtras?: ReactNode;
}) {
  return (
    <PageShell
      contentClassName={contentClassName}
      {...(backTestId !== undefined ? { backTestId } : {})}
      {...(backTo !== undefined ? { backTo } : {})}
      {...(backLabel !== undefined ? { backLabel } : {})}
    >
      <h1 className="text-3xl font-semibold mb-2">{pageLabel}</h1>
      {description ? (
        <p className="text-muted-foreground mb-8">{description}</p>
      ) : null}
      {headerExtras}
      <SwitchOrgPrompt
        predicate={predicateFor(requires)}
        pageLabel={pageLabel}
        testId={testId}
      />
    </PageShell>
  );
}
