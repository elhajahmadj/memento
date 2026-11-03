import { useState } from "react";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import {
  useCreateTeamAccessRequest,
  type CreateTeamAccessRequestRequest,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { useAuth } from "@/features/auth/presentation/auth-context";
import {
  ROLE_CATALOG,
  getRoleDisplayName,
  type TeamRole,
} from "@/features/team/domain/role-catalog";

/**
 * Plain-language banner shown to users who lack access to a feature.
 * Explains what their current role can/can't do and offers a
 * one-click "Request access" path that notifies admins instead of
 * bouncing them to a dead-end error.
 */
export function AccessGate({
  requiredRole,
  featureName,
  className,
}: {
  /** Minimum plain-language role the feature requires. */
  requiredRole: TeamRole;
  /** Friendly name of the gated feature, e.g. "Team admin". */
  featureName: string;
  className?: string;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const currentRole = (user?.effectiveRole ?? user?.role ?? null) as TeamRole | null;
  const currentEntry = currentRole ? ROLE_CATALOG[currentRole] : null;
  const requiredEntry = ROLE_CATALOG[requiredRole];

  const submit = useCreateTeamAccessRequest({
    mutation: {
      onSuccess: () => {
        toast.success("Your access request was sent to the team admins.");
        setOpen(false);
        setReason("");
      },
      onError: (err: Error) =>
        toast.error(err.message ?? "Couldn't send request"),
    },
  });

  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30 p-4 ${className ?? ""}`}
      data-testid={`access-gate-${requiredRole}`}
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 space-y-2">
          <h3 className="font-semibold text-sm">
            {featureName} is for {requiredEntry.displayName}s
          </h3>
          <p className="text-sm text-muted-foreground">
            {currentEntry
              ? `You're signed in as ${getRoleDisplayName(currentEntry.role)} — ${currentEntry.summary}`
              : "You're signed in but don't have a role assigned yet."}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{requiredEntry.displayName}s</span>{" "}
            can {requiredEntry.canDo[0]?.toLowerCase() ?? "do more"}.
          </p>
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              onClick={() => setOpen(true)}
              data-testid={`button-request-access-${requiredRole}`}
            >
              Request access
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-md"
          data-testid="dialog-request-access"
        >
          <DialogHeader>
            <DialogTitle>
              Ask an admin for {requiredEntry.displayName} access
            </DialogTitle>
            <DialogDescription>
              Your team admins will get a notification and can grant you the
              role from the Team page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="access-reason">
              Why do you need this? (optional)
            </Label>
            <Textarea
              id="access-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="E.g. I'm taking over project setup from Pat next week."
              data-testid="input-access-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const data: CreateTeamAccessRequestRequest = {
                  requestedRole: requiredRole,
                };
                const r = reason.trim();
                if (r) data.reason = r;
                submit.mutate({ data });
              }}
              disabled={submit.isPending}
              data-testid="button-submit-access-request"
            >
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
