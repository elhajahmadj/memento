import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, UserRound } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useAuth } from "@/features/auth/presentation/auth-context";

/**
 * "Continue as guest" — the zero-friction trial entry point on the
 * login card's identifier step.
 *
 * Owns its own submitting/error state rather than sharing the sign-in
 * form's, so a failed guest attempt neither clears what the user typed
 * above nor renders a capacity refusal in the sign-in error slot.
 * On success it follows the same `/splash` path a local sign-in takes.
 */
export function ContinueAsGuestButton() {
  const [, navigate] = useLocation();
  const { continueAsGuest } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await continueAsGuest();
      navigate("/splash", { replace: true });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't start a guest session. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="relative py-1"
        aria-hidden="true"
        data-testid="guest-divider"
      >
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-card px-2 text-xs text-muted-foreground">
            or
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={submitting}
          onClick={onClick}
          data-testid="button-continue-as-guest"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <UserRound className="h-4 w-4 mr-2" />
          )}
          Continue as guest
        </Button>
        {/* The limits are stated up-front, not discovered after signing in. */}
        <p className="text-xs text-muted-foreground text-center">
          Explore memento for 6 hours. One project, no AI features.
        </p>
        {error && (
          <div
            className="text-sm text-destructive text-center"
            data-testid="text-guest-error"
          >
            {error}
          </div>
        )}
      </div>
    </>
  );
}
