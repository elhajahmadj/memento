import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useAuth } from "@/features/auth/presentation/auth-context";
import {
  useOrgsMatchingRole,
  type RolePredicate,
} from "@/features/auth/presentation/role";
import type { AuthOrganization, AuthUserRole } from "@workspace/api-client-react";

/**
 * Short label shown in the inline switch action so users can see at a
 * glance what role they have in the other org (e.g. "Switch to OrgA
 * (Admin)"). Mirrors the same mapping used in the user-menu org
 * switcher; null roles get the generic "Switch to OrgX" label.
 */
const ROLE_LABELS: Record<NonNullable<AuthOrganization["role"]>, string> = {
  admin: "Admin",
  limited_admin: "Limited Admin",
  limited: "User",
};

function roleLabelFor(role: AuthUserRole | null | undefined): string | null {
  if (role == null || role === "memento_admin") return null;
  return ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? null;
}

/**
 * Inline gate shown by a role-gated page when the active org's role
 * fails the gate but the user has the required role in another org.
 * Instead of bouncing the user back home and forcing them to hunt for
 * the right org in the user-menu, we surface a one-click "Switch to
 * <OrgX> (<Role>)" action.
 *
 * Renders `null` (i.e. defers to whatever fallback the caller wants)
 * when no other org satisfies the predicate — local users, SSO users
 * with a single org, and SSO users who genuinely don't have the role
 * anywhere all fall through to the existing redirect behavior.
 */
export function SwitchOrgPrompt({
  predicate,
  pageLabel,
  testId = "switch-org-prompt",
}: {
  /** Which role the gated page requires. */
  predicate: RolePredicate;
  /** Human-readable name of the page (e.g. "Admin"). */
  pageLabel: string;
  /** Test id for the wrapper; the button gets `${testId}-button-<id>`. */
  testId?: string;
}) {
  const candidates = useOrgsMatchingRole(predicate);
  const { setActiveOrganization, refresh } = useAuth();
  const qc = useQueryClient();
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  return (
    <div
      className="rounded-md border bg-card p-6 max-w-xl"
      data-testid={testId}
    >
      <h2 className="text-lg font-semibold mb-1">
        {pageLabel} isn't available in this organization
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Your active organization doesn't grant access to {pageLabel}. You can
        switch to {candidates.length === 1 ? "the organization" : "an organization"}{" "}
        below to continue.
      </p>
      <div className="flex flex-col gap-2">
        {candidates.map((o) => {
          const label = roleLabelFor(o.role);
          return (
            <Button
              key={o.id}
              variant="outline"
              className="justify-start"
              disabled={switchingOrgId !== null}
              onClick={async () => {
                setSwitchingOrgId(o.id);
                try {
                  await setActiveOrganization(o.id);
                  // Refresh /auth/me so `effectiveRole` flips to the
                  // newly-active org's role before the page re-renders
                  // and re-checks the gate.
                  await refresh();
                  // Bust any project/list caches scoped to the old org.
                  qc.clear();
                } finally {
                  setSwitchingOrgId(null);
                }
              }}
              data-testid={`${testId}-button-${o.externalKey}`}
            >
              <Building2 className="h-4 w-4 mr-2" />
              <span className="flex-1 truncate text-left">
                Switch to {o.displayName}
                {label ? ` (${label})` : ""}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
