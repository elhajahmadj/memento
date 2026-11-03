import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import {
  useUpdateUser,
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
import { EMAIL_RE } from "@/features/settings/domain/users-format";

function formatMembershipRole(role: string): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "limited_admin":
      return "Limited admin";
    case "limited":
      return "Limited";
    default:
      return role;
  }
}

export function EditUserProfileDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [title, setTitle] = useState(user.title ?? "");
  const [email, setEmail] = useState(user.email ?? "");

  const update = useUpdateUser({
    mutation: {
      onError: (e: Error) => toast.error(e.message ?? "Failed to save"),
    },
  });

  const fn = firstName.trim();
  const ln = lastName.trim();
  const tt = title.trim();
  const em = email.trim();
  const emailValid = EMAIL_RE.test(em);
  const isValid = !!fn && !!ln && !!tt && !!em && emailValid;

  const onSubmit = async () => {
    if (!isValid) return;
    try {
      await update.mutateAsync({
        id: user.id,
        data: { firstName: fn, lastName: ln, title: tt, email: em },
      });
      toast.success(`Profile updated for ${user.username}`);
      await onSaved();
    } catch {
      // toast handled by onError
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Update profile details for{" "}
            <span className="font-mono">{user.username}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {user.authSource === "oidc" && (
            <div
              className="rounded-md border border-border bg-muted/40 p-3 text-sm"
              data-testid="section-edit-user-memberships"
            >
              <div className="font-medium mb-1.5">Organization memberships</div>
              {user.memberships.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  This user has no organization memberships.
                </p>
              ) : (
                <ul className="space-y-1">
                  {user.memberships.map((m) => (
                    <li
                      key={m.organizationId}
                      className="flex items-center justify-between gap-3"
                      data-testid={`row-edit-user-membership-${m.organizationId}`}
                    >
                      <span className="truncate">{m.organizationName}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatMembershipRole(m.role)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">
                Per-organization roles are edited from the Users list while
                viewing that organization.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-first-name">First name</Label>
              <Input
                id="edit-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoFocus
                data-testid="input-edit-user-first-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-last-name">Last name</Label>
              <Input
                id="edit-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                data-testid="input-edit-user-last-name"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. QA Engineer"
              data-testid="input-edit-user-title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="input-edit-user-email"
            />
            {em.length > 0 && !emailValid && (
              <p className="text-xs text-destructive">
                Enter a valid email address.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!isValid || update.isPending}
            data-testid="button-save-user-profile"
          >
            {update.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            <Save className="h-4 w-4 mr-1.5" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
