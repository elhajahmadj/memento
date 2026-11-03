import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Building2 } from "lucide-react";
import { Logo } from "@/shared/ui/shell/logo";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { orgRoleLabel } from "@/features/auth/presentation/org-role-labels";

/**
 * Org-picker page for IDP users who belong to more than one
 * organization. Hit by the AuthGate after a successful SSO login when
 * `activeOrganizationId` is null. Local users never see this page —
 * they have no orgs and the gate skips it entirely.
 */
export function PickOrg() {
  const [, navigate] = useLocation();
  const { organizations, setActiveOrganization, refresh } = useAuth();
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (id: string) => {
    setSubmittingId(id);
    setError(null);
    try {
      await setActiveOrganization(id);
      // refresh so the AuthGate re-evaluates and forwards us on.
      await refresh();
      // Honor the server-side `OIDC_POST_LOGIN_REDIRECT` so multi-org
      // users land on the same page that single-org users (whose org
      // is auto-selected server-side and immediately redirected) do.
      // Falls back to "/" if the lookup fails for any reason.
      let dest = "/";
      try {
        const r = await fetch(
          `${import.meta.env.BASE_URL}api/auth/sso/post-login-redirect`,
          { credentials: "include" },
        );
        if (r.ok) {
          const body = (await r.json()) as { postLoginRedirect?: string };
          if (typeof body.postLoginRedirect === "string" && body.postLoginRedirect) {
            dest = body.postLoginRedirect;
          }
        }
      } catch {
        // Non-fatal: fall back to "/".
      }
      // Route through the post-login splash (task #28) so multi-org
      // SSO users see the same brand animation that single-org SSO
      // users (redirected server-side) and local users do, before
      // landing on `dest`. `dest` is already a same-origin relative
      // path (server-configured `OIDC_POST_LOGIN_REDIRECT`, defaulting
      // to "/"), so the splash's safe-redirect guard accepts it.
      navigate(`/splash?next=${encodeURIComponent(dest)}`, { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to switch organization.");
      setSubmittingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border bg-sidebar/85 px-8 py-5 flex items-center gap-3">
        <Logo className="text-xl" />
      </header>
      <main className="flex-1 flex items-center justify-center p-8">
        <Card className="w-full max-w-md border-card-border shadow-card">
          <CardContent className="p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">
                Choose an organization
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                You belong to more than one organization. Pick the one
                you want to work in. You can switch later from the
                profile menu.
              </p>
            </div>
            <div className="space-y-2" data-testid="pick-org-list">
              {organizations.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No organizations are available for your account.
                </div>
              )}
              {organizations.map((o) => {
                const roleLabel = orgRoleLabel(o.role);
                return (
                  <Button
                    key={o.id}
                    variant="outline"
                    className="w-full justify-start"
                    disabled={submittingId !== null}
                    onClick={() => void onPick(o.id)}
                    data-testid={`pick-org-${o.externalKey}`}
                  >
                    {submittingId === o.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Building2 className="h-4 w-4 mr-2" />
                    )}
                    <span className="text-left">
                      {o.displayName}
                      {roleLabel ? ` - ${roleLabel}` : ""}
                    </span>
                  </Button>
                );
              })}
            </div>
            {error && (
              <div className="mt-4 text-sm text-destructive">{error}</div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
