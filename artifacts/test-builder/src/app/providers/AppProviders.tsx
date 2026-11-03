/**
 * Application-wide provider tree composition (Phase 1 scaffolding).
 *
 * This file is currently a thin pass-through; `App.tsx` still owns the
 * provider chain (QueryClient, Theme, Auth, WouterRouter, Toaster). As
 * features migrate to the layered structure, this component will:
 *
 *   1. Build the DI container exactly once (`buildContainer()`).
 *   2. Expose it via `ContainerContext` so use cases are reachable from
 *      any presentation hook.
 *   3. Continue to host the existing third-party providers in the same
 *      order `App.tsx` does today (no behavior change at the boundary).
 *
 * Keeping the providers in one named component (rather than nested in
 * `App.tsx`) lets tests render any subtree against a stub container by
 * swapping this file for a `TestProviders` analogue.
 */

import {
  createContext,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";
import { buildContainer, type Container } from "../di/container";

const ContainerContext = createContext<Container | null>(null);

export interface AppProvidersProps {
  /** Optional override used by tests to inject a stub container. */
  container?: Container;
  children: ReactNode;
}

export function AppProviders({
  container,
  children,
}: AppProvidersProps): ReactElement {
  const value = useMemo(() => container ?? buildContainer(), [container]);
  return (
    <ContainerContext.Provider value={value}>
      {children}
    </ContainerContext.Provider>
  );
}

/** Access the DI container from any presentation hook / component. */
export function useContainer(): Container {
  const c = useContext(ContainerContext);
  if (!c) {
    throw new Error(
      "useContainer() called outside <AppProviders>. Wrap the tree at the top of App.tsx.",
    );
  }
  return c;
}
