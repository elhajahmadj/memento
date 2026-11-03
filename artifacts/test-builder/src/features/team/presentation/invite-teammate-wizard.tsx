import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, Mail, Send, Shield } from "lucide-react";
import {
  useCreateTeamInvitation,
  getListTeamInvitationsQueryKey,
  type CreateTeamInvitationRequest,
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
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { useIsMementoAdmin } from "@/features/auth/presentation/role";
import {
  ROLE_CATALOG,
  rolesGrantableBy,
  type TeamRole,
} from "@/features/team/domain/role-catalog";

type DeliveryMethod = CreateTeamInvitationRequest["deliveryMethod"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = 1 | 2 | 3 | 4;

/**
 * Four-step Invite Teammate wizard.
 *
 *   1. Who — first name, last name, email
 *   2. Role — pick from the plain-language role catalog
 *   3. How to invite — email, copy link, or provision in IDP
 *   4. Review & send — final summary + create call
 */
export function InviteTeammateWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { canProvisionInIdp, idpProvisioningEnabled } = useAuth();
  const isMementoAdmin = useIsMementoAdmin();
  const grantable = useMemo(
    () => rolesGrantableBy(isMementoAdmin),
    [isMementoAdmin],
  );

  const [step, setStep] = useState<Step>(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("limited");
  const [deliveryMethod, setDeliveryMethod] =
    useState<DeliveryMethod>("email");
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep(1);
    setFirstName("");
    setLastName("");
    setEmail("");
    setRole("limited");
    setDeliveryMethod("email");
    setAcceptUrl(null);
  }, []);

  const create = useCreateTeamInvitation({
    mutation: {
      onSuccess: async (res) => {
        await qc.invalidateQueries({
          queryKey: getListTeamInvitationsQueryKey(),
        });
        setAcceptUrl(res.invitation.acceptUrl ?? null);
        toast.success(`Invitation created for ${res.invitation.email}.`);
      },
      onError: (err: Error) =>
        toast.error(err.message ?? "Failed to create invitation"),
    },
  });

  const emailValid = EMAIL_RE.test(email.trim().toLowerCase());

  // First and last name are optional per spec — only a valid email is
  // required to advance from step 1.
  const canAdvance =
    step === 1
      ? emailValid
      : step === 2
        ? grantable.some((g) => g.role === role)
        : step === 3
          ? deliveryMethod !== "idp" || canProvisionInIdp
          : true;

  const handleClose = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      // Slight delay so the user sees the success state on the final
      // step before the dialog tears down.
      setTimeout(reset, 200);
    }
  };

  const handleSubmit = async () => {
    if (acceptUrl) {
      handleClose(false);
      return;
    }
    const data: CreateTeamInvitationRequest = {
      email: email.trim().toLowerCase(),
      role,
      deliveryMethod,
    };
    const f = firstName.trim();
    if (f) data.firstName = f;
    const l = lastName.trim();
    if (l) data.lastName = l;
    try {
      await create.mutateAsync({ data });
    } catch {
      // toast already shown
    }
  };

  const selectedEntry = ROLE_CATALOG[role];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="dialog-invite-teammate"
      >
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            Step {step} of 4 —{" "}
            {step === 1
              ? "Who are you inviting?"
              : step === 2
                ? "Pick their role"
                : step === 3
                  ? "How should we deliver the invite?"
                  : "Review and send"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3" data-testid="invite-step-who">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="invite-first">First name (optional)</Label>
                <Input
                  id="invite-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  data-testid="input-invite-first-name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="invite-last">Last name (optional)</Label>
                <Input
                  id="invite-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  data-testid="input-invite-last-name"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-email">Work email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@example.com"
                data-testid="input-invite-email"
              />
              {!emailValid && email.length > 0 && (
                <p className="text-xs text-destructive">
                  Please enter a valid email address.
                </p>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2" data-testid="invite-step-role">
            {grantable.map((entry) => {
              const selected = entry.role === role;
              return (
                <label
                  key={entry.role}
                  className={`block rounded-md border p-3 cursor-pointer transition-colors ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-foreground/30"
                  }`}
                  data-testid={`option-role-${entry.role}`}
                >
                  <input
                    type="radio"
                    name="invite-role"
                    className="sr-only"
                    checked={selected}
                    onChange={() => setRole(entry.role)}
                  />
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{entry.displayName}</div>
                    {entry.godMode && (
                      <span className="text-[10px] uppercase tracking-wide text-primary">
                        Owner-only
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {entry.summary}
                  </p>
                </label>
              );
            })}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2" data-testid="invite-step-delivery">
            <DeliveryOption
              icon={<Mail className="h-4 w-4" />}
              value="email"
              label="Email them an invite link"
              description="We'll email a one-time link they can click to join."
              selected={deliveryMethod === "email"}
              onSelect={() => setDeliveryMethod("email")}
            />
            <DeliveryOption
              icon={<Copy className="h-4 w-4" />}
              value="copy_link"
              label="Just give me a link to share"
              description="We'll show you a link to copy and send yourself (chat, ticket, etc.)."
              selected={deliveryMethod === "copy_link"}
              onSelect={() => setDeliveryMethod("copy_link")}
            />
            <DeliveryOption
              icon={<Shield className="h-4 w-4" />}
              value="idp"
              label="Provision in our identity provider"
              description={
                idpProvisioningEnabled
                  ? canProvisionInIdp
                    ? "Create the account directly in your identity provider and let it own the welcome email."
                    : "Available only to admins signed in via SSO with an active organization picked."
                  : "Disabled on this server (IDP_PROVISIONING_ENABLED is off)."
              }
              selected={deliveryMethod === "idp"}
              onSelect={() => setDeliveryMethod("idp")}
              disabled={!idpProvisioningEnabled || !canProvisionInIdp}
            />
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3 text-sm" data-testid="invite-step-review">
            <SummaryRow label="Name" value={`${firstName} ${lastName}`.trim() || "—"} />
            <SummaryRow label="Email" value={email.trim().toLowerCase()} />
            <SummaryRow label="Role" value={selectedEntry.displayName} />
            <SummaryRow
              label="Delivery"
              value={
                deliveryMethod === "email"
                  ? "Email link"
                  : deliveryMethod === "copy_link"
                    ? "Copy link"
                    : "Provision in IDP"
              }
            />
            {acceptUrl && (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Invitation link
                </div>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={acceptUrl}
                    className="font-mono text-xs"
                    data-testid="input-invite-accept-url"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(acceptUrl);
                        toast.success("Link copied to clipboard.");
                      } catch {
                        toast.error("Couldn't copy — select the text and copy manually.");
                      }
                    }}
                    data-testid="button-copy-accept-url"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step > 1 && !acceptUrl && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep((s) => (s - 1) as Step)}
              data-testid="button-invite-back"
            >
              Back
            </Button>
          )}
          {step < 4 && (
            <Button
              type="button"
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={!canAdvance}
              data-testid="button-invite-next"
            >
              Next
            </Button>
          )}
          {step === 4 && (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={create.isPending}
              data-testid="button-invite-send"
            >
              {create.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1.5" />
              )}
              {acceptUrl ? "Done" : "Send invitation"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}

function DeliveryOption({
  icon,
  value,
  label,
  description,
  selected,
  disabled,
  onSelect,
}: {
  icon: React.ReactNode;
  value: DeliveryMethod;
  label: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${
        disabled
          ? "opacity-50 cursor-not-allowed border-border"
          : selected
            ? "border-primary bg-primary/5 cursor-pointer"
            : "border-border hover:border-foreground/30 cursor-pointer"
      }`}
      data-testid={`option-delivery-${value}`}
    >
      <input
        type="radio"
        name="invite-delivery"
        className="sr-only"
        value={value}
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
      />
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="flex-1">
        <span className="font-medium block">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
