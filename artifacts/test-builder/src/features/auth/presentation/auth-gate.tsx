import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/features/auth/presentation/auth-context";

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, organizations, activeOrganizationId } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      if (
        location !== "/login" &&
        location !== "/logged-out" &&
        location !== "/" &&
        location !== "/about" &&
        location !== "/privacy" &&
        location !== "/terms"
      ) {
        navigate("/login", { replace: true });
      }
      return;
    }
    if (location === "/login") {
      navigate(
        user.profileComplete ? "/splash" : "/profile/complete",
        { replace: true },
      );
      return;
    }
    // IDP user with multiple orgs and none yet active → make them pick.
    // Local users (organizations.length === 0) skip this gate entirely
    // and continue to the normal post-login flow. Memento Admin is the
    // god-mode super role that explicitly has no active org (sees every
    // org's projects), so they bypass the picker entirely.
    if (
      user.role !== "memento_admin" &&
      organizations.length > 0 &&
      activeOrganizationId === null &&
      location !== "/pick-org" &&
      location !== "/profile/complete"
    ) {
      navigate("/pick-org", { replace: true });
      return;
    }
    // Once an org is picked, /pick-org should bounce to home.
    if (location === "/pick-org" && activeOrganizationId !== null) {
      navigate("/", { replace: true });
      return;
    }
    // Splash is the post-login interstitial. If the user lands here without a
    // complete profile, skip the splash and route them to profile completion.
    if (location === "/splash" && !user.profileComplete) {
      navigate("/profile/complete", { replace: true });
      return;
    }
    if (
      !user.profileComplete &&
      location !== "/profile/complete" &&
      location !== "/splash"
    ) {
      navigate("/profile/complete", { replace: true });
      return;
    }
    if (user.profileComplete && location === "/profile/complete") {
      navigate("/profile", { replace: true });
    }
  }, [user, loading, location, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (
    !user &&
    location !== "/login" &&
    location !== "/logged-out" &&
    location !== "/" &&
    location !== "/about" &&
    location !== "/privacy" &&
    location !== "/terms"
  ) {
    return null;
  }

  if (user && !user.profileComplete && location !== "/profile/complete") {
    return null;
  }

  // Hold the render while we redirect a multi-org IDP user to the picker.
  // Memento Admin is exempt — they intentionally have no active org.
  if (
    user &&
    user.role !== "memento_admin" &&
    organizations.length > 0 &&
    activeOrganizationId === null &&
    location !== "/pick-org" &&
    location !== "/profile/complete"
  ) {
    return null;
  }

  return <>{children}</>;
}
