import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Clock, LogIn } from "lucide-react";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { useIsGuest } from "@/features/auth/presentation/role";
import {
  formatGuestRemaining,
  guestMsRemaining,
} from "@/features/auth/domain/guest";

/**
 * Re-render cadence for the countdown. The label is minute-granular
 * (see `formatGuestRemaining`), so ticking every 30s keeps it honest
 * without spinning a per-second render loop across every page.
 */
const TICK_MS = 30_000;

/**
 * Slim persistent bar telling a guest how long their trial has left and
 * offering a way out to a real account.
 *
 * Renders nothing for every non-guest, so it is safe to mount
 * unconditionally in the app shell.
 */
export function GuestBanner() {
  const { user, logout } = useAuth();
  const isGuest = useIsGuest();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isGuest) return;
    const handle = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(handle);
  }, [isGuest]);

  const [, navigate] = useLocation();

  /**
   * Get the visitor to the real sign-in form.
   *
   * Navigating straight to `/login` does nothing visible: `AuthGate`
   * bounces any *signed-in* user off that route to `/splash`, and a
   * guest is signed in. So end the guest session first, then go. The
   * guest's project is unaffected — it lives until its own deadline.
   */
  const signInInstead = async () => {
    try {
      await logout();
    } catch {
      // Even if the sign-out call fails, still send them to the form;
      // logging in there will replace the session anyway.
    }
    navigate("/login");
  };

  if (!isGuest) return null;
  const remaining = guestMsRemaining(user, now);
  if (remaining === null) return null;

  return (
    <div
      className="w-full border-b border-border bg-muted/60 px-4 py-2 text-xs flex items-center justify-center gap-x-3 gap-y-1 flex-wrap"
      role="status"
      data-testid="guest-banner"
    >
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        <span data-testid="guest-banner-remaining">
          Guest session — expires in {formatGuestRemaining(remaining)}
        </span>
      </span>
      <span className="text-muted-foreground/70 hidden sm:inline">
        One project. AI features and setup are not included.
      </span>
      <button
        type="button"
        onClick={() => void signInInstead()}
        className="inline-flex items-center gap-1.5 font-medium underline underline-offset-2 hover:no-underline"
        data-testid="guest-banner-sign-in"
      >
        <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
        Sign in to keep your work
      </button>
    </div>
  );
}
