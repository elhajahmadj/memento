import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  useCreateUser,
  useInviteUser,
  getListUsersQueryKey,
  AdminUserRole,
  type AdminUser,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { useIsMementoAdmin } from "@/features/auth/presentation/role";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;
// Hidden escape hatch: when an admin literally types
// `localUser:{username}:noEmail` (case-sensitive, exact format) into
// the email field, we bypass the IDP and create a username/password
// row locally. The username must satisfy the same character set the
// server enforces (letters, numbers, dot, dash, underscore, 3-40
// chars). Documented only in HANDOFF.md so non-admins can't discover
// it from the UI.
const LOCAL_USER_RE = /^localUser:([A-Za-z0-9._-]{3,40}):noEmail$/;

export function AddUserDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // canProvisionInIdp gates the email-based IDP path. False for
  // local username/password admins (seeded users, dev-login) by
  // policy — only admins who signed in via SSO are allowed to create
  // IdP accounts on someone else's tenant, even though memento
  // itself authenticates upstream with a server-side API key. Also
  // false when the IDP toggle is off server-side, when no IdP API
  // key is configured, or when no active org is picked. In any of
  // those cases the dialog falls back to a local-only username +
  // role form.
  const { canProvisionInIdp } = useAuth();
  // Privilege-management policy: only existing Memento Admins can grant
  // the Memento Admin (god-mode) role. Hide the dropdown option from
  // plain Admins so the UI matches the server-side gate.
  const viewerIsMementoAdmin = useIsMementoAdmin();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<AdminUser["role"]>(AdminUserRole.limited);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setEmail("");
      setUsername("");
      setRole(AdminUserRole.limited);
      setErrorMessage(null);
    }
  }, [open]);

  const createUser = useCreateUser({
    mutation: {
      onSuccess: async (res) => {
        await qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        if (res.provisionedInIdp) {
          toast.success(
            `Provisioned ${res.user.username} in identity provider.`,
            { duration: 8000 },
          );
        } else {
          toast.success(
            `Created local user ${res.user.username}. Temporary password: ${
              res.temporaryPassword ?? "(none)"
            }`,
            { duration: 12000 },
          );
        }
        onClose();
      },
      onError: (e: Error) => {
        const msg = e.message ?? "Failed to create user";
        setErrorMessage(msg);
        toast.error(msg);
      },
    },
  });

  // Invite flow (invitation-code path per the IdP partner docs). Sends an
  // invitation-code-only provisioning call so the identity provider emails the
  // recipient a register link; no user row is created in memento
  // until they accept and sign in via SSO. Re-uses the email + name
  // fields from the dialog; the role dropdown is ignored on this
  // path (the identity provider assigns the org's default role at acceptance time).
  const inviteUser = useInviteUser({
    mutation: {
      onSuccess: async (res) => {
        await qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast.success(
          `Invitation sent to ${res.email}. They have until ${new Date(
            res.expiresAt,
          ).toLocaleString()} to accept.`,
          { duration: 12000 },
        );
        onClose();
      },
      onError: (e: Error) => {
        const msg = e.message ?? "Failed to send invitation";
        setErrorMessage(msg);
        toast.error(msg);
      },
    },
  });

  const trimmedEmail = email.trim();
  const trimmedUsername = username.trim();
  const localUserMatch = trimmedEmail.match(LOCAL_USER_RE);
  const isLocalUserEscape = localUserMatch !== null;
  const emailLooksValid = EMAIL_RE.test(trimmedEmail);
  const usernameLooksValid = USERNAME_RE.test(trimmedUsername);
  const pending = createUser.isPending || inviteUser.isPending;
  const canSubmit = canProvisionInIdp
    ? !pending && (isLocalUserEscape || emailLooksValid)
    : !pending && usernameLooksValid;
  // Invite is IDP-only; never offered on the local fallback path,
  // never offered on the local-user escape hatch (the whole point of
  // that backdoor is to bypass the IDP).
  const canInvite =
    canProvisionInIdp && !isLocalUserEscape && emailLooksValid && !pending;

  const handleInvite = () => {
    if (!canInvite) return;
    setErrorMessage(null);
    const fn = firstName.trim();
    const ln = lastName.trim();
    inviteUser.mutate({
      data: {
        email: trimmedEmail,
        ...(fn ? { firstName: fn } : {}),
        ...(ln ? { lastName: ln } : {}),
      },
    });
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    setErrorMessage(null);
    if (!canProvisionInIdp) {
      // Local-only path for admins without an OIDC access token.
      // Creates a username/password row immediately; admin shares the
      // temporary password from the success toast.
      const fn1 = firstName.trim();
      const ln1 = lastName.trim();
      createUser.mutate({
        data: {
          username: trimmedUsername,
          role,
          ...(fn1 ? { firstName: fn1 } : {}),
          ...(ln1 ? { lastName: ln1 } : {}),
          provisionInIdp: false,
        },
      });
      return;
    }
    if (isLocalUserEscape && localUserMatch) {
      // Backdoor for SSO admins who need a local row (bots, break-
      // glass). No email is stored, no IDP provisioning is attempted.
      const fn2 = firstName.trim();
      const ln2 = lastName.trim();
      createUser.mutate({
        data: {
          username: localUserMatch[1]!,
          role,
          ...(fn2 ? { firstName: fn2 } : {}),
          ...(ln2 ? { lastName: ln2 } : {}),
          provisionInIdp: false,
        },
      });
      return;
    }
    // Default path: provision in the identity provider. Email doubles as the local
    // username so Settings → Users displays the email everywhere.
    const fn3 = firstName.trim();
    const ln3 = lastName.trim();
    createUser.mutate({
      data: {
        username: trimmedEmail,
        role,
        email: trimmedEmail,
        ...(fn3 ? { firstName: fn3 } : {}),
        ...(ln3 ? { lastName: ln3 } : {}),
        provisionInIdp: true,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            {canProvisionInIdp
              ? "Provisions the account in the identity provider. The user receives a welcome email and is asked to complete their profile on first sign-in."
              : "Creates a local username/password account. Provisioning in the identity provider requires signing in via SSO with an active organization, so this dialog only offers local-account creation right now."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2 grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="add-user-first">First name</Label>
              <Input
                id="add-user-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                data-testid="input-new-user-first-name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-user-last">Last name</Label>
              <Input
                id="add-user-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                data-testid="input-new-user-last-name"
              />
            </div>
          </div>
          {canProvisionInIdp ? (
            <div className="grid gap-2">
              <Label htmlFor="add-user-email">
                Email
                <span className="text-destructive"> *</span>
              </Label>
              <Input
                id="add-user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                autoComplete="off"
                data-testid="input-new-user-email"
              />
              <p className="text-xs text-muted-foreground">
                The email address doubles as the username and is what the
                user will sign in with.
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="add-user-username">
                Username
                <span className="text-destructive"> *</span>
              </Label>
              <Input
                id="add-user-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="jane.doe"
                autoComplete="off"
                data-testid="input-new-user-username"
              />
              <p className="text-xs text-muted-foreground">
                Letters, numbers, dot, dash, or underscore (3–40
                characters). The user signs in with this username and
                the temporary password shown on success.
              </p>
            </div>
          )}
          <div className="grid gap-2">
            <Label>Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as AdminUser["role"])}
            >
              <SelectTrigger data-testid="select-new-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {viewerIsMementoAdmin && (
                  <SelectItem value={AdminUserRole.memento_admin}>
                    memento admin
                  </SelectItem>
                )}
                <SelectItem value={AdminUserRole.admin}>admin</SelectItem>
                <SelectItem value={AdminUserRole.limited_admin}>
                  limitedadmin
                </SelectItem>
                <SelectItem value={AdminUserRole.limited}>user</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {errorMessage && (
            <div
              className="text-xs text-destructive"
              data-testid="text-add-user-error"
            >
              {errorMessage}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={pending}
            data-testid="button-cancel-add-user"
          >
            Cancel
          </Button>
          {canProvisionInIdp && !isLocalUserEscape && (
            <Button
              variant="secondary"
              onClick={handleInvite}
              disabled={!canInvite}
              title="Email the recipient an invitation link and let them self-register (set their own name, password, accept terms). No account is created until they accept."
              data-testid="button-invite-user"
            >
              {inviteUser.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Invite user"
              )}
            </Button>
          )}
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="button-confirm-add-user"
          >
            {createUser.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Create user"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
