import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  ChevronDown,
  Circle,
  HelpCircle,
  LogOut,
  Moon,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
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
import { useAuth } from "@/features/auth/presentation/auth-context";
import { useIsGuest } from "@/features/auth/presentation/role";
import { useLocation } from "wouter";
import { useTheme, type ThemeMode } from "@/shared/hooks/use-theme";
import { NotificationBell } from "@/features/approvals/presentation/components/notification-bell";
import {
  useGetRecordingStatus,
  getGetRecordingStatusQueryKey,
} from "@workspace/api-client-react";

import { orgRoleLabel } from "@/features/auth/presentation/org-role-labels";

const THEME_META: Record<
  ThemeMode,
  { icon: typeof Sun; label: string; nextLabel: string }
> = {
  dark: { icon: Moon, label: "Dark", nextLabel: "Switch to light theme" },
  light: { icon: Sun, label: "Light", nextLabel: "Switch to grey theme" },
  grey: { icon: Circle, label: "Grey", nextLabel: "Switch to dark theme" },
};

export function UserMenu() {
  const {
    user,
    logout,
    organizations,
    activeOrganizationId,
    setActiveOrganization,
    refresh,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isGuest = useIsGuest();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState(false);
  // Detect a kept-open Chromium so we can warn the user before sign-out
  // tears it down. We only poll when the menu is mounted (i.e. for
  // signed-in users); the existing workbench poll already keeps this
  // query warm everywhere recording is actually active.
  const { data: recordingStatus } = useGetRecordingStatus({
    query: {
      queryKey: getGetRecordingStatusQueryKey(),
      enabled: !!user,
      refetchOnWindowFocus: false,
    },
  });
  const keepBrowserOpenActive = recordingStatus?.keepBrowserOpen === true;
  const performSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      qc.clear();
      navigate("/logged-out", { replace: true });
    } finally {
      setSigningOut(false);
    }
  };
  if (!user) return null;

  const displayName =
    user.profileComplete && user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`
      : user.username;

  const meta = THEME_META[theme];
  const Icon = meta.icon;
  const isMementoAdmin = user.effectiveRole === "memento_admin";

  return (
    <div className="flex items-center gap-2">
      <NotificationBell />
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        aria-label={meta.nextLabel}
        title={`${meta.label} — ${meta.nextLabel.toLowerCase()}`}
        data-testid="button-toggle-theme"
      >
        <Icon className="h-4 w-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            title={isMementoAdmin ? "Memento Admin (god mode)" : undefined}
            data-testid="button-user-menu"
          >
            <UserIcon
              aria-hidden="true"
              className={
                isMementoAdmin
                  ? "h-3.5 w-3.5 text-brand"
                  : "h-3.5 w-3.5"
              }
              data-testid={
                isMementoAdmin ? "icon-user-memento-admin" : "icon-user"
              }
            />
            <span data-testid="text-current-user">{displayName}</span>
            <ChevronDown
              aria-hidden="true"
              className="h-3.5 w-3.5 text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {/* Not offered to guests: the identity is a throwaway
              `guest-<token>` with placeholder name/email, there is no
              password to change, and both `PUT /auth/profile` and the
              password-reset endpoint are closed to them server-side. */}
          {!isGuest && (
            <DropdownMenuItem
              onClick={() => navigate("/profile")}
              data-testid="menu-item-my-profile"
            >
              <UserIcon className="h-4 w-4 mr-2" />
              My profile
            </DropdownMenuItem>
          )}
          {/* Not offered to guests: the tour walks through Settings and
              other surfaces that are closed to them, so it dead-ends. */}
          {!isGuest && (
            <DropdownMenuItem
              onClick={() =>
                window.dispatchEvent(new CustomEvent("onboarding:relaunch"))
              }
              data-testid="menu-item-take-tour"
            >
              <HelpCircle className="h-4 w-4 mr-2" />
              Take the tour
            </DropdownMenuItem>
          )}
          {/* Org switcher — only rendered for IDP users (organizations
              is empty for local username/password users, so this whole
              block disappears and the menu looks unchanged for them). */}
          {organizations.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div
                className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground"
                data-testid="org-switcher-label"
              >
                Organization
              </div>
              {organizations.map((o) => {
                const active = o.id === activeOrganizationId;
                const roleLabel = orgRoleLabel(o.role);
                return (
                  <DropdownMenuItem
                    key={o.id}
                    disabled={switchingOrgId !== null || active}
                    onClick={async () => {
                      setSwitchingOrgId(o.id);
                      try {
                        await setActiveOrganization(o.id);
                        // Refresh `/auth/me` so `user.effectiveRole`
                        // (and therefore `useRole` / `AdminOnly` /
                        // `AnyAdminOnly`) flips to the newly-active
                        // org's per-org role before any downstream
                        // query refires.
                        await refresh();
                        // Bust any project / list caches that depended
                        // on the old org so the UI repaints from the
                        // newly-scoped data.
                        qc.clear();
                      } finally {
                        setSwitchingOrgId(null);
                      }
                    }}
                    data-testid={`org-switcher-item-${o.externalKey}`}
                  >
                    {active ? (
                      <Check className="h-4 w-4 mr-2" />
                    ) : (
                      <Building2 className="h-4 w-4 mr-2" />
                    )}
                    <span className="flex-1 truncate">{o.displayName}</span>
                    {roleLabel && (
                      <span
                        className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground"
                        data-testid={`org-switcher-role-${o.externalKey}`}
                      >
                        {roleLabel}
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={signingOut}
            onClick={async (e) => {
              if (keepBrowserOpenActive) {
                e.preventDefault();
                setConfirmSignOutOpen(true);
                return;
              }
              await performSignOut();
            }}
            data-testid="button-sign-out"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={confirmSignOutOpen}
        onOpenChange={setConfirmSignOutOpen}
      >
        <AlertDialogContent data-testid="dialog-confirm-sign-out-keep-open">
          <AlertDialogHeader>
            <AlertDialogTitle>Close the kept-open browser?</AlertDialogTitle>
            <AlertDialogDescription>
              You asked to keep the browser open after stopping the recording.
              Signing out will close the browser window you asked to keep open.
              Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="button-confirm-sign-out-keep-open-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmSignOutOpen(false);
                await performSignOut();
              }}
              data-testid="button-confirm-sign-out-keep-open-confirm"
            >
              Close browser and sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
