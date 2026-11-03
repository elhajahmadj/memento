import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Info, Loader2, RefreshCw, Trash2 } from "lucide-react";
import {
  useListTeamInvitations,
  useResendTeamInvitation,
  useRevokeTeamInvitation,
  getListTeamInvitationsQueryKey,
  type TeamInvitation,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { getRoleDisplayName } from "@/features/team/domain/role-catalog";

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "Expired";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

export function PendingInvitationsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useListTeamInvitations();
  const [actingId, setActingId] = useState<string | null>(null);

  const resend = useResendTeamInvitation({
    mutation: {
      onSettled: () => setActingId(null),
      onSuccess: async (res) => {
        await qc.invalidateQueries({
          queryKey: getListTeamInvitationsQueryKey(),
        });
        if (res.invitation.acceptUrl) {
          try {
            await navigator.clipboard.writeText(res.invitation.acceptUrl);
            toast.success("New link copied to clipboard.");
          } catch {
            toast.success("Invitation re-issued.");
          }
        } else {
          toast.success("Invitation re-issued.");
        }
      },
      onError: (err: Error) => toast.error(err.message ?? "Resend failed"),
    },
  });

  const revoke = useRevokeTeamInvitation({
    mutation: {
      onSettled: () => setActingId(null),
      onSuccess: async () => {
        await qc.invalidateQueries({
          queryKey: getListTeamInvitationsQueryKey(),
        });
        toast.success("Invitation revoked.");
      },
      onError: (err: Error) => toast.error(err.message ?? "Revoke failed"),
    },
  });

  const handleResend = async (inv: TeamInvitation) => {
    setActingId(inv.id);
    try {
      await resend.mutateAsync({ id: inv.id });
    } catch {
      /* toast handled */
    }
  };

  const handleRevoke = async (inv: TeamInvitation) => {
    setActingId(inv.id);
    try {
      await revoke.mutateAsync({ id: inv.id });
    } catch {
      /* toast handled */
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex justify-center" data-testid="pending-invitations-loading">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground"
        data-testid="pending-invitations-empty"
      >
        No pending invitations. Invite a teammate to get started.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SmtpFallbackBanner rows={rows} />
      <div className="rounded-md border border-border bg-card shadow-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Delivery</TableHead>
            <TableHead>Invited by</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="w-[200px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((inv) => {
            const busy = actingId === inv.id;
            return (
              <TableRow key={inv.id} data-testid={`row-invitation-${inv.email}`}>
                <TableCell className="font-mono text-sm">{inv.email}</TableCell>
                <TableCell>{getRoleDisplayName(inv.role)}</TableCell>
                <TableCell className="capitalize text-sm">
                  {inv.deliveryMethod.replace("_", " ")}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {inv.createdByUsername ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatExpiry(inv.expiresAt)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleResend(inv)}
                      disabled={busy}
                      data-testid={`button-resend-invitation-${inv.email}`}
                      title="Rotate the link and re-send"
                    >
                      {busy && resend.isPending ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-1.5" />
                      )}
                      Resend
                    </Button>
                    {inv.deliveryMethod === "copy_link" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleResend(inv)}
                        disabled={busy}
                        data-testid={`button-copy-invitation-${inv.email}`}
                        title="Rotate the link and copy a fresh one to your clipboard"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRevoke(inv)}
                      disabled={busy}
                      data-testid={`button-revoke-invitation-${inv.email}`}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Revoke
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}

/**
 * Heads-up banner shown when one or more pending invitations use the
 * "email" delivery method. Today the server logs the accept URL
 * instead of actually emailing it (SMTP isn't wired). Surface that so
 * admins know to use "Copy link" until SMTP_HOST / SMTP_FROM are set.
 */
function SmtpFallbackBanner({ rows }: { rows: TeamInvitation[] }) {
  const hasEmailInvites = rows.some((r) => r.deliveryMethod === "email");
  if (!hasEmailInvites) return null;
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30 p-3 text-sm"
      data-testid="banner-smtp-fallback"
    >
      <Info className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
      <div>
        Email delivery isn't configured on this server yet. The invitation
        link was logged but no email was sent — set <code>SMTP_HOST</code>{" "}
        and <code>SMTP_FROM</code> to enable real email, or use the
        <strong> Copy link</strong> action below to send the link yourself.
      </div>
    </div>
  );
}
