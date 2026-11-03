import { useEffect, type ComponentType, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useIsGuest } from "@/features/auth/presentation/role";

/**
 * Route wrapper for pages that are not part of the guest trial.
 *
 * Hiding the nav link is not enough on its own — a deep link, a
 * bookmark, or a link inside page copy would still land a guest on the
 * page. Guarding at the route layer (rather than inside each page)
 * keeps the access rule next to the routing table in `App.tsx` and
 * leaves the page components unaware of guests entirely.
 *
 * Renders nothing for a guest so they never see the page chrome flash
 * before the redirect lands. Non-guests pass straight through.
 *
 * This is a UX guard, not a security boundary: the real enforcement is
 * the server-side allow-list in `shared/middlewares/guestAllowlist.ts`.
 */
export function GuestBlockedRoute({ children }: { children: ReactNode }) {
  const isGuest = useIsGuest();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isGuest) navigate("/", { replace: true });
  }, [isGuest, navigate]);

  if (isGuest) return null;
  return <>{children}</>;
}

/**
 * HOC form of {@link GuestBlockedRoute}, for `<Route component={...} />`.
 *
 * Wrapping inline in the routing table costs five lines per route and
 * there are now four of them, which was pushing `App.tsx` over its size
 * budget. Call this at module scope — building the component during
 * render would give it a new identity every time and remount the page.
 */
export function guestBlocked<P extends object>(Page: ComponentType<P>) {
  return function GuestBlocked(props: P) {
    return (
      <GuestBlockedRoute>
        <Page {...props} />
      </GuestBlockedRoute>
    );
  };
}
