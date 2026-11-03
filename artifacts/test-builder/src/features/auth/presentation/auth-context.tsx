import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getCurrentUser,
  login as loginApi,
  logout as logoutApi,
  setActiveOrg as setActiveOrgApi,
  updateProfile as updateProfileApi,
  type AuthOrganization,
  type AuthUser,
  type UpdateProfileRequest,
} from "@workspace/api-client-react";
import { startGuestSession } from "@/features/auth/domain/guest";
import { fetchSsoEndSessionUrl } from "@/features/auth/domain/sso-logout";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** IDP-driven org list. Empty for local username/password users. */
  organizations: AuthOrganization[];
  /** Currently active org id, or null for local / not-yet-picked. */
  activeOrganizationId: string | null;
  /** True when SSO env vars are configured on the server. */
  ssoEnabled: boolean;
  /** True when IDP_PROVISIONING_ENABLED is set on the server. */
  idpProvisioningEnabled: boolean;
  /**
   * True when this specific caller is currently allowed to provision
   * users in the IDP. Requires the server toggle, the caller is an
   * admin, the server has an IdP partner API key configured,
   * the caller signed in via SSO (proven by an
   * OIDC access token on their session), and an active organization
   * is picked. **Local username/password admins are intentionally
   * excluded** — they fall back to local-only username/password
   * creation in the Add user dialog. The actual upstream call still
   * uses the server-side API key; the SSO requirement is a policy
   * gate, not a credential constraint.
   */
  canProvisionInIdp: boolean;
  login: (username: string, password: string) => Promise<void>;
  /** Start a guest trial. Rejects with `GuestCapacityError` when full. */
  continueAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (data: UpdateProfileRequest) => Promise<AuthUser>;
  /** Switch the active org. IDP users only; throws if not a member. */
  setActiveOrganization: (organizationId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organizations, setOrganizations] = useState<AuthOrganization[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState<
    string | null
  >(null);
  // Optimistic default: assume SSO is wired until `/api/auth/me`
  // tells us otherwise. Server-side `isOidcEnabled()` is the source
  // of truth and is returned on every successful `/auth/me` call;
  // keeping the initial value at `false` previously caused the login
  // page to falsely report "SSO sign-in isn't configured" whenever
  // the very first `/auth/me` request errored (e.g. a stale session
  // cookie tripping the OIDC refresh middleware). The catch block
  // intentionally does NOT reset this so a transient probe failure
  // can't flip the SPA into local-only mode either.
  const [ssoEnabled, setSsoEnabled] = useState(true);
  const [idpProvisioningEnabled, setIdpProvisioningEnabled] = useState(false);
  const [canProvisionInIdp, setCanProvisionInIdp] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await getCurrentUser();
      setUser(res.user ?? null);
      setOrganizations(res.organizations ?? []);
      setActiveOrganizationId(res.activeOrganizationId ?? null);
      setSsoEnabled(Boolean(res.ssoEnabled));
      setIdpProvisioningEnabled(Boolean(res.idpProvisioningEnabled));
      setCanProvisionInIdp(Boolean(res.canProvisionInIdp));
    } catch {
      setUser(null);
      setOrganizations([]);
      setActiveOrganizationId(null);
      setCanProvisionInIdp(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await loginApi({ username, password });
      setUser(res.user);
      // Local users have no orgs — refresh to sync the empty list and
      // any server-side ssoEnabled flag.
      await refresh();
    },
    [refresh],
  );

  const continueAsGuest = useCallback(async () => {
    await startGuestSession();
    // Re-read `/auth/me` rather than trusting the POST body so the
    // context picks up server-side flags (ssoEnabled, etc.) the same
    // way the local login path does.
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    // Resolved before the local session is destroyed — see
    // `fetchSsoEndSessionUrl`. Null for local users.
    const endSessionUrl = await fetchSsoEndSessionUrl();
    try {
      await logoutApi();
    } finally {
      setUser(null);
      setOrganizations([]);
      setActiveOrganizationId(null);
      // For SSO users, hand the browser off to the identity provider so the IDP
      // session is also terminated. The identity provider will redirect back to
      // `${BASE_URL}logged-out` (or whatever
      // OIDC_POST_LOGOUT_REDIRECT_URL is set to on the server).
      if (endSessionUrl) {
        window.location.href = endSessionUrl;
      }
    }
  }, []);

  const updateProfile = useCallback(async (data: UpdateProfileRequest) => {
    const updated = await updateProfileApi(data);
    setUser(updated);
    return updated;
  }, []);

  const setActiveOrganization = useCallback(
    async (organizationId: string) => {
      const res = await setActiveOrgApi({ organizationId });
      setActiveOrganizationId(res.activeOrganizationId);
    },
    [],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      organizations,
      activeOrganizationId,
      ssoEnabled,
      idpProvisioningEnabled,
      canProvisionInIdp,
      login,
      continueAsGuest,
      logout,
      refresh,
      updateProfile,
      setActiveOrganization,
    }),
    [
      user,
      loading,
      organizations,
      activeOrganizationId,
      ssoEnabled,
      idpProvisioningEnabled,
      canProvisionInIdp,
      login,
      continueAsGuest,
      logout,
      refresh,
      updateProfile,
      setActiveOrganization,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
