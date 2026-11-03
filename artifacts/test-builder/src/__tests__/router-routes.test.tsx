import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router as WouterRouter, Switch, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";

/**
 * Task #34 — focused unit coverage for the SPA route map:
 *
 *   /          -> Dashboard (signed-in Home)        (was: Projects dispatcher)
 *   /projects  -> Home (Projects dispatcher)        (new)
 *   /dashboard -> permanent redirect to /           (was: Dashboard)
 *
 * Page components are mocked to lightweight markers so the test
 * exercises pure routing without booting the auth provider, the React
 * Query client, the workbench, etc.
 */

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => ({ user: { id: "u", role: "admin" }, loading: false, logout: vi.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/features/dashboard/presentation/pages/dashboard", () => ({
  Dashboard: () => <div data-testid="page-dashboard-mock" />,
}));

vi.mock("@/features/projects/presentation/pages/home", () => ({
  Home: () => <div data-testid="page-projects-mock" />,
}));

vi.mock("@/features/auth/presentation/pages/landing", () => ({
  Landing: () => <div data-testid="page-landing-mock" />,
}));

// Import after mocks so the Router picks up the mocked components.
import { Home } from "@/features/projects/presentation/pages/home";
import { Dashboard } from "@/features/dashboard/presentation/pages/dashboard";
import { RedirectTo } from "@/features/admin/presentation/components/redirect-to";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { Landing } from "@/features/auth/presentation/pages/landing";

function Root() {
  const { user } = useAuth();
  return user ? <Dashboard /> : <Landing />;
}

function TestRouter() {
  return (
    <Switch>
      <Route path="/" component={Root} />
      <Route path="/projects" component={Home} />
      <Route path="/dashboard">
        <RedirectTo to="/" />
      </Route>
    </Switch>
  );
}

afterEach(() => cleanup());

describe("App route map", () => {
  it("'/' renders the Dashboard (signed-in Home)", () => {
    const mem = memoryLocation({ path: "/", record: true });
    render(
      <WouterRouter hook={mem.hook}>
        <TestRouter />
      </WouterRouter>,
    );
    expect(screen.getByTestId("page-dashboard-mock")).toBeDefined();
    expect(screen.queryByTestId("page-projects-mock")).toBeNull();
  });

  it("'/projects' renders the Projects dispatcher (Home)", () => {
    const mem = memoryLocation({ path: "/projects", record: true });
    render(
      <WouterRouter hook={mem.hook}>
        <TestRouter />
      </WouterRouter>,
    );
    expect(screen.getByTestId("page-projects-mock")).toBeDefined();
    expect(screen.queryByTestId("page-dashboard-mock")).toBeNull();
  });

  it("'/dashboard' permanently redirects to '/' and renders Dashboard", () => {
    const mem = memoryLocation({ path: "/dashboard", record: true });
    render(
      <WouterRouter hook={mem.hook}>
        <TestRouter />
      </WouterRouter>,
    );
    // RedirectTo navigates client-side; after the effect the location
    // should be "/" and the Dashboard should render.
    expect(mem.history[mem.history.length - 1]).toBe("/");
    expect(screen.getByTestId("page-dashboard-mock")).toBeDefined();
  });
});

/**
 * Task #35 — `/settings#<old-anchor>` legacy hash redirects.
 *
 * After the Settings/Admin/Tools reorg, bookmarks like
 * `/settings#architectures` should land the user on the new home
 * for that section. The Settings page itself runs a `useEffect`
 * that reads `window.location.hash` and calls `navigate(target,
 * { replace: true })` against wouter's history. We exercise the
 * real Settings component (with its sub-sections mocked) under a
 * memory router seeded to `/settings` and assert the redirect
 * target was pushed.
 */
vi.mock("@/shared/ui/shell/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="page-shell-mock">{children}</div>
  ),
}));
vi.mock("@/features/settings/presentation/components/collapsible-section", () => ({
  CollapsibleSection: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/features/settings/presentation/sections/appearance-section", () => ({
  AppearanceSection: () => <div data-testid="appearance-mock" />,
}));
vi.mock("@/features/settings/presentation/sections/mocks-section", () => ({
  MocksSection: () => <div />,
}));
vi.mock("@/features/settings/presentation/sections/shared-steps-section", () => ({
  SharedStepsSection: () => <div />,
}));
vi.mock("@/features/auth/presentation/role", () => ({
  useIsAnyAdmin: () => true,
  // Settings hides Shared steps / Mocks for guest trial sessions.
  useIsGuest: () => false,
}));

import { Settings } from "@/features/settings/presentation/pages/settings";

describe("Settings legacy hash redirects", () => {
  const cases: Array<[string, string]> = [
    ["architectures", "/admin#architectures"],
    ["recording", "/admin#recording"],
    ["validation", "/admin#validation"],
    ["activity", "/tools/activity"],
    ["maintenance", "/tools/maintenance"],
  ];

  for (const [hash, target] of cases) {
    it(`'/settings#${hash}' redirects to '${target}'`, async () => {
      // jsdom: seed window.location.hash before mounting so the
      // Settings useEffect can read it.
      window.location.hash = `#${hash}`;
      const mem = memoryLocation({ path: "/settings", record: true });
      render(
        <WouterRouter hook={mem.hook}>
          <Settings />
        </WouterRouter>,
      );
      // useEffect runs synchronously after render in RTL; the
      // navigate(target, { replace: true }) call appends the
      // target to the recorded history.
      await new Promise((r) => setTimeout(r, 0));
      expect(mem.history[mem.history.length - 1]).toBe(target);
      window.location.hash = "";
    });
  }
});
