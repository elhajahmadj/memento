import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import {
  useListUsers,
  useUpdateUser,
  useDeleteUser,
  useResendWelcomeEmail,
  getListUsersQueryKey,
  type AdminUser,
  type AdminUserMembership,
  AdminUserRole,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { useIsMementoAdmin } from "@/features/auth/presentation/role";
import { fullName, formatLastLogin } from "@/features/settings/domain/users-format";
import { AddUserDialog } from "./add-user-dialog";
import { EditUserProfileDialog } from "./edit-user-profile-dialog";

type PerOrgRole = AdminUserMembership["role"];

function formatRoleLabel(role: AdminUser["role"] | PerOrgRole): string {
  switch (role) {
    case "memento_admin":
      return "Memento Admin";
    case "admin":
      return "Admin";
    case "limited_admin":
      return "Limited admin";
    case "limited":
      return "Limited";
  }
}

/**
 * Pick the role to render in the table's Role column.
 *
 * - Memento Admins are always shown as "Memento Admin" (god-mode is
 *   org-independent).
 * - Local username/password users have no memberships; we keep showing
 *   the global `users.role` column they always had.
 * - SSO users are shown with their role *in the admin's active org*.
 *   When the SSO user isn't a member of that org we show "—" so it's
 *   obvious the user has no authority in the current scope.
 */
function scopedDisplayRole(
  user: AdminUser,
  activeOrgId: string | null,
): { role: AdminUser["role"] | PerOrgRole | null; membership: AdminUserMembership | null } {
  if (user.role === "memento_admin") return { role: "memento_admin", membership: null };
  if (user.authSource !== "oidc") return { role: user.role, membership: null };
  if (!activeOrgId) return { role: null, membership: null };
  const m = user.memberships.find((x) => x.organizationId === activeOrgId);
  return { role: m?.role ?? null, membership: m ?? null };
}

export function UsersSection({ viewerIsAdmin }: { viewerIsAdmin: boolean }) {
  const qc = useQueryClient();
  const {
    user: currentUser,
    refresh,
    activeOrganizationId,
    organizations,
  } = useAuth();
  // Privilege-management policy: only existing Memento Admins can grant
  // or revoke the Memento Admin (god-mode) role. Hide the dropdown
  // option from plain Admins so the UI matches the server-side gate.
  const viewerIsMementoAdmin = useIsMementoAdmin();
  const { data: users, isLoading } = useListUsers();
  const activeOrg = useMemo(
    () => organizations.find((o) => o.id === activeOrganizationId) ?? null,
    [organizations, activeOrganizationId],
  );
  const roleColumnLabel = activeOrg
    ? `Role in ${activeOrg.displayName}`
    : "Role";
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [demoteTarget, setDemoteTarget] = useState<{
    user: AdminUser;
    nextRole: AdminUser["role"] | PerOrgRole;
    /** When set, the demotion targets a per-org membership row. */
    orgId: string | null;
    orgName: string | null;
  } | null>(null);
  const [selfDemoteOpen, setSelfDemoteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const updateUser = useUpdateUser({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to update user"),
    },
  });

  const deleteUser = useDeleteUser({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to delete user"),
    },
  });

  const [resendingId, setResendingId] = useState<string | null>(null);
  const resendWelcome = useResendWelcomeEmail({
    mutation: {
      onSettled: () => setResendingId(null),
    },
  });

  const handleResendWelcome = async (target: AdminUser) => {
    setResendingId(target.id);
    try {
      const result = await resendWelcome.mutateAsync({ id: target.id });
      const count = result.resendCount;
      toast.success(
        `Welcome email re-sent to ${target.username}${
          typeof count === "number" ? ` (resend #${count})` : ""
        }.`,
      );
    } catch (e) {
      const err = e as Error & {
        status?: number;
        data?: { error?: string; retryAfterSeconds?: number } | null;
      };
      const retry = err.data?.retryAfterSeconds;
      const baseMsg = err.data?.error ?? err.message ?? "Resend failed";
      const msg =
        err.status === 429 && typeof retry === "number"
          ? `${baseMsg} Try again in ${retry}s.`
          : baseMsg;
      toast.error(msg);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const t = deleteTarget;
    try {
      await deleteUser.mutateAsync({ id: t.id });
      toast.success(`${t.username} was removed`);
      setDeleteTarget(null);
    } catch {
      // toast handled by onError
    }
  };

  // Memento Admin is a god-mode superset of Admin, so it counts as an
  // admin for the "last remaining admin" orphan guard — demoting the
  // sole Admin while a Memento Admin still exists is fine because the
  // org keeps a higher-privilege admin in the seat. This orphan guard
  // tracks the *global* admin pool used for local users and the
  // memento_admin role; per-org orphan checks happen server-side.
  const globalAdminCount = useMemo(
    () =>
      (users ?? []).filter(
        (u) =>
          (u.authSource !== "oidc" && u.role === "admin") ||
          u.role === "memento_admin",
      ).length,
    [users],
  );

  // Count of org admins inside the admin's currently active org —
  // used to disable the per-org dropdown for "the last admin of this
  // org" so the UI matches the server-side orphan guard.
  const activeOrgAdminCount = useMemo(() => {
    if (!activeOrganizationId) return 0;
    return (users ?? []).filter((u) =>
      u.memberships.some(
        (m) => m.organizationId === activeOrganizationId && m.role === "admin",
      ),
    ).length;
  }, [users, activeOrganizationId]);

  /**
   * Apply a role change. `orgId` selects between the two server-side
   * paths:
   *   - `null`  → global edit (memento_admin promotion/demotion, or a
   *               local username/password user's global role).
   *   - string → per-org membership edit. Allowed roles are limited
   *               to the per-org enum (admin / limited_admin /
   *               limited); memento_admin is rejected server-side.
   */
  const applyRoleChange = async (
    target: AdminUser,
    role: AdminUser["role"] | PerOrgRole,
    orgId: string | null,
  ) => {
    try {
      const updated = await updateUser.mutateAsync({
        id: target.id,
        data: orgId ? { role, orgId } : { role: role as AdminUser["role"] },
      });
      const scope = scopedDisplayRole(updated, activeOrganizationId);
      const newLabel = formatRoleLabel(
        (orgId ? role : scope.role) ?? updated.role,
      );
      toast.success(`${target.username} is now ${newLabel}`);
      if (currentUser?.id === target.id) {
        await refresh();
        setSelfDemoteOpen(true);
      }
    } catch {
      // toast handled by onError
    }
  };

  const handleRoleSelect = (
    target: AdminUser,
    next: AdminUser["role"] | PerOrgRole,
    currentScopedRole: AdminUser["role"] | PerOrgRole | null,
    orgId: string | null,
    orgName: string | null,
  ) => {
    if (next === currentScopedRole) return;
    // Confirm any admin → non-admin demotion. Demoting from
    // memento_admin always counts; per-org demotions only count the
    // org-level `admin` role (limited_admin is not a true admin in the
    // org-roles model).
    const wasAdmin =
      currentScopedRole === "admin" || currentScopedRole === "memento_admin";
    const becomesNonAdmin = next === "limited" || next === "limited_admin";
    if (wasAdmin && becomesNonAdmin) {
      setDemoteTarget({ user: target, nextRole: next, orgId, orgName });
      return;
    }
    void applyRoleChange(target, next, orgId);
  };

  const confirmDemote = async () => {
    if (!demoteTarget) return;
    const t = demoteTarget;
    setDemoteTarget(null);
    await applyRoleChange(t.user, t.nextRole, t.orgId);
  };

  return (
    <section data-testid="section-users">
      {viewerIsAdmin && (
        <div className="flex items-center justify-end mb-4">
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            data-testid="button-add-user"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add user
          </Button>
        </div>
      )}
      <div className="rounded-md border border-border bg-card shadow-card">
        {isLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead className="w-[200px]">
                  {roleColumnLabel}
                </TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="w-[140px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(users ?? []).map((u) => {
                const isSelf = currentUser?.id === u.id;
                const scope = scopedDisplayRole(u, activeOrganizationId);
                const isPerOrgEdit =
                  u.authSource === "oidc" && u.role !== "memento_admin";
                const editOrgId = isPerOrgEdit ? activeOrganizationId : null;
                const editOrgName = isPerOrgEdit && activeOrg ? activeOrg.displayName : null;
                // Disable the dropdown for:
                //   - SSO users when the admin has no active org (no
                //     scope to edit in).
                //   - SSO users who aren't a member of the active org
                //     (no membership row to edit).
                //   - The last global admin (would orphan global
                //     admins) for the global path.
                //   - The last org admin for the per-org path.
                const isSsoUserNotInActiveOrg =
                  isPerOrgEdit &&
                  (!activeOrganizationId || scope.membership === null);
                const wouldOrphanGlobal =
                  !isPerOrgEdit &&
                  (u.role === "admin" || u.role === "memento_admin") &&
                  globalAdminCount <= 1;
                const wouldOrphanOrg =
                  isPerOrgEdit &&
                  scope.membership?.role === "admin" &&
                  activeOrgAdminCount <= 1;
                const wouldOrphanAdmins =
                  wouldOrphanGlobal || wouldOrphanOrg;
                const dropdownDisabled =
                  updateUser.isPending ||
                  wouldOrphanAdmins ||
                  isSsoUserNotInActiveOrg;
                const currentScopedRole = scope.role;
                const otherMemberships = u.memberships.filter(
                  (m) => m.organizationId !== activeOrganizationId,
                );
                return (
                  <TableRow
                    key={u.id}
                    data-testid={`row-user-${u.username}`}
                  >
                    <TableCell>
                      <span data-testid={`text-user-name-${u.username}`}>
                        {fullName(u)}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {u.username}
                    </TableCell>
                    <TableCell>
                      {viewerIsAdmin && currentScopedRole !== null ? (
                        <>
                          <Select
                            value={currentScopedRole}
                            onValueChange={(v) =>
                              handleRoleSelect(
                                u,
                                v as AdminUser["role"] | PerOrgRole,
                                currentScopedRole,
                                editOrgId,
                                editOrgName,
                              )
                            }
                            disabled={dropdownDisabled}
                          >
                            <SelectTrigger
                              className="h-8 w-[160px]"
                              data-testid={`select-role-${u.username}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {/* memento_admin is global only — never
                                  offered on the per-org edit path. */}
                              {!isPerOrgEdit &&
                                (viewerIsMementoAdmin ||
                                  u.role === "memento_admin") && (
                                  <SelectItem
                                    value={AdminUserRole.memento_admin}
                                  >
                                    Memento Admin
                                  </SelectItem>
                                )}
                              <SelectItem value={AdminUserRole.admin}>
                                Admin
                              </SelectItem>
                              <SelectItem value={AdminUserRole.limited_admin}>
                                Limited admin
                              </SelectItem>
                              <SelectItem value={AdminUserRole.limited}>
                                Limited
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          {isPerOrgEdit && editOrgName && (
                            <div
                              className="text-[10px] text-muted-foreground mt-1"
                              data-testid={`text-role-scope-${u.username}`}
                            >
                              for {editOrgName}
                            </div>
                          )}
                          {otherMemberships.length > 0 && (
                            <div
                              className="text-[10px] text-muted-foreground mt-0.5"
                              data-testid={`text-other-memberships-${u.username}`}
                              title={otherMemberships
                                .map(
                                  (m) =>
                                    `${formatRoleLabel(m.role)} in ${m.organizationName}`,
                                )
                                .join("\n")}
                            >
                              +{otherMemberships.length} other org
                              {otherMemberships.length === 1 ? "" : "s"}
                            </div>
                          )}
                          {wouldOrphanAdmins && (
                            <div className="text-[10px] text-muted-foreground mt-1">
                              Last admin
                            </div>
                          )}
                        </>
                      ) : viewerIsAdmin && isPerOrgEdit ? (
                        <span
                          className="text-sm text-muted-foreground italic"
                          data-testid={`text-role-${u.username}`}
                        >
                          {activeOrganizationId
                            ? "No access in this org"
                            : "Pick an active org to edit"}
                        </span>
                      ) : (
                        <span
                          className="text-sm capitalize"
                          data-testid={`text-role-${u.username}`}
                        >
                          {(currentScopedRole ?? u.role).replace("_", " ")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatLastLogin(u.lastLoginAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {viewerIsAdmin && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(u)}
                            data-testid={`button-edit-user-${u.username}`}
                          >
                            <Pencil className="h-4 w-4 mr-1.5" />
                            Edit profile
                          </Button>
                          {u.idpExternalId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleResendWelcome(u)}
                              disabled={resendingId === u.id}
                              data-testid={`button-resend-welcome-${u.username}`}
                              title="Resend the IDP welcome email to this user"
                            >
                              {resendingId === u.id ? (
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                              ) : (
                                <Mail className="h-4 w-4 mr-1.5" />
                              )}
                              Resend welcome
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(u)}
                            disabled={
                              isSelf ||
                              wouldOrphanAdmins ||
                              deleteUser.isPending
                            }
                            data-testid={`button-delete-user-${u.username}`}
                            title={
                              isSelf
                                ? "You cannot delete your own account"
                                : wouldOrphanAdmins
                                  ? "Cannot delete the last remaining admin"
                                  : "Delete user"
                            }
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-1.5" />
                            Delete
                          </Button>
                        </div>
                      )}
                      {isSelf && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          you
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {editing && (
        <EditUserProfileDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
            if (currentUser?.id === editing.id) await refresh();
            setEditing(null);
          }}
        />
      )}

      <Dialog
        open={!!demoteTarget}
        onOpenChange={(o) => !o && setDemoteTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Demote to Limited?</DialogTitle>
            <DialogDescription>
              {demoteTarget?.user.id === currentUser?.id ? (
                <>
                  You're about to remove your own admin access. You'll need to
                  sign back in afterwards. Continue?
                </>
              ) : (
                <>
                  <span className="font-mono">
                    {demoteTarget?.user.username}
                  </span>{" "}
                  will lose admin access
                  {demoteTarget?.orgName
                    ? ` in ${demoteTarget.orgName}`
                    : ""}{" "}
                  on their next request. Continue?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDemoteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDemote}
              disabled={updateUser.isPending}
              data-testid="button-confirm-demote-user"
            >
              Demote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selfDemoteOpen}
        onOpenChange={(o) => setSelfDemoteOpen(o)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your role changed</DialogTitle>
            <DialogDescription>
              Your role was just updated. Please reload the app so the new
              permissions take effect everywhere.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => window.location.reload()}
              data-testid="button-self-demote-reload"
            >
              Reload now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{deleteTarget?.username}</span> will
              be permanently removed along with their forks, recordings,
              mocks, and audit history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteUser.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteUser.isPending}
              data-testid="button-confirm-delete-user"
            >
              {deleteUser.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddUserDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </section>
  );
}
