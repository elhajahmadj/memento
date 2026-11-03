import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUserPreferences,
  useUpdateUserPreferences,
  getGetUserPreferencesQueryKey,
  type NavLayout,
  type UserPreferencesResponse,
} from "@workspace/api-client-react";
import type { QueryKey } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/presentation/auth-context";

export type { NavLayout };

const DEFAULT_LAYOUT: NavLayout = "top";

interface NavLayoutContextValue {
  /**
   * Effective layout to render. While the initial fetch is in flight
   * or the caller is signed out, this is `top` so the shell renders
   * the default top bar instead of flashing an empty layout.
   */
  layout: NavLayout;
  /** Update the per-user preference. Optimistic, rolls back on failure. */
  setLayout: (next: NavLayout) => void;
  /** True while the server-side preference is being fetched for the first time. */
  loading: boolean;
}

const NavLayoutContext = createContext<NavLayoutContextValue | null>(null);

export function NavLayoutProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const signedIn = Boolean(user);

  // Only hit the server once the user is actually signed in. For
  // signed-out visitors the layout is always `top` and we never call
  // the endpoint.
  // Scope the cache key by user id so that signing out and signing in as
  // a different user on the same browser does not show the previous
  // user's preference. The base key is preserved as the first element so
  // invalidations targeting `getGetUserPreferencesQueryKey()` still match.
  const prefsQueryKey = useMemo<QueryKey>(
    () => [...getGetUserPreferencesQueryKey(), user?.id ?? "anonymous"],
    [user?.id],
  );

  const { data, isLoading } = useGetUserPreferences({
    query: {
      queryKey: prefsQueryKey,
      enabled: signedIn && !authLoading,
      staleTime: 5 * 60 * 1000,
    },
  });

  const [optimisticLayout, setOptimisticLayout] = useState<NavLayout | null>(
    null,
  );

  // Drop any optimistic value when the user changes (e.g. sign-out /
  // sign-in as a different account) so we don't leak the previous
  // user's choice into the next session.
  useEffect(() => {
    setOptimisticLayout(null);
  }, [user?.id]);

  const update = useUpdateUserPreferences();

  const setLayout = useCallback(
    (next: NavLayout) => {
      if (!signedIn) return;
      const previous = data?.navLayout ?? DEFAULT_LAYOUT;
      setOptimisticLayout(next);
      qc.setQueryData<UserPreferencesResponse>(prefsQueryKey, {
        navLayout: next,
      });
      update.mutate(
        { data: { navLayout: next } },
        {
          onSuccess: (resp) => {
            qc.setQueryData<UserPreferencesResponse>(prefsQueryKey, resp);
            setOptimisticLayout(null);
          },
          onError: () => {
            qc.setQueryData<UserPreferencesResponse>(prefsQueryKey, {
              navLayout: previous,
            });
            setOptimisticLayout(null);
          },
        },
      );
    },
    [data?.navLayout, prefsQueryKey, qc, signedIn, update],
  );

  const layout: NavLayout = useMemo(() => {
    if (!signedIn) return DEFAULT_LAYOUT;
    if (optimisticLayout) return optimisticLayout;
    return data?.navLayout ?? DEFAULT_LAYOUT;
  }, [data?.navLayout, optimisticLayout, signedIn]);

  const value = useMemo<NavLayoutContextValue>(
    () => ({
      layout,
      setLayout,
      loading: signedIn && isLoading,
    }),
    [layout, setLayout, signedIn, isLoading],
  );

  return (
    <NavLayoutContext.Provider value={value}>
      {children}
    </NavLayoutContext.Provider>
  );
}

export function useNavLayout(): NavLayoutContextValue {
  const ctx = useContext(NavLayoutContext);
  if (!ctx) {
    // Render a sensible fallback so components don't crash when the
    // provider is missing (e.g. in isolated tests). The default keeps
    // the existing top-bar behavior.
    return {
      layout: DEFAULT_LAYOUT,
      setLayout: () => undefined,
      loading: false,
    };
  }
  return ctx;
}
