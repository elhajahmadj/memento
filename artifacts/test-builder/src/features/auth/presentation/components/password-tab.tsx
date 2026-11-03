import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import {
  useRequestPasswordReset,
  ApiError,
  type PasswordResetThrottledResponse,
} from "@workspace/api-client-react";

const COOLDOWN_SECONDS = 60;

interface PasswordTabProps {
  isSsoUser: boolean;
  email: string | null;
}

export function PasswordTab({ isSsoUser, email }: PasswordTabProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notConfigured, setNotConfigured] = useState(false);
  const mutation = useRequestPasswordReset();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const onConfirm = async () => {
    setConfirmOpen(false);
    setNotConfigured(false);
    try {
      await mutation.mutateAsync();
      toast.success(
        "If an account exists for that email, we've sent a reset link. Check your inbox.",
      );
      setCooldown(COOLDOWN_SECONDS);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const data = err.data as PasswordResetThrottledResponse | null;
          const retry = data?.retryAfterSeconds ?? COOLDOWN_SECONDS;
          setCooldown(retry);
          toast.error("Too many attempts. Try again in a minute.");
          return;
        }
        if (err.status === 503) {
          setNotConfigured(true);
          return;
        }
      }
      toast.error(
        "Couldn't reach our identity provider. Try again in a moment.",
      );
    }
  };

  const disabled =
    !isSsoUser || cooldown > 0 || mutation.isPending || !email;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        We'll email you a reset link from our identity provider. The new
        password is set on the identity provider's hosted page.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={disabled}
          data-testid="button-reset-password"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Mail className="h-4 w-4 mr-2" />
          )}
          {cooldown > 0 ? `Reset password (${cooldown}s)` : "Reset password"}
        </Button>
        {!isSsoUser && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="text-reset-local-user-note"
          >
            Password reset is only available for SSO accounts. Local accounts
            keep their password in this app.
          </p>
        )}
      </div>
      {notConfigured && (
        <div
          className="rounded-md border border-card-border bg-muted/40 p-3 text-xs text-muted-foreground"
          data-testid="notice-reset-not-configured"
        >
          Password reset isn't configured on this server. Ask an operator to
          set the identity provider environment variables.
        </div>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-reset-password">
          <AlertDialogHeader>
            <AlertDialogTitle>Send password reset link?</AlertDialogTitle>
            <AlertDialogDescription>
              We'll email you a reset link at{" "}
              <span className="font-medium">{email ?? "your email"}</span> —
              continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="button-cancel-reset-password"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              data-testid="button-confirm-reset-password"
            >
              Send link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
