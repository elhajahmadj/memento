import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AuthUser } from "@workspace/api-client-react";
import { Landing } from "../pages/landing";
import { AuthGate } from "../auth-gate";

const useAuthMock = vi.fn();
vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

function setAuth(user: AuthUser | null, loading = false) {
  useAuthMock.mockReturnValue({
    user,
    loading,
    organizations: [],
    activeOrganizationId: null,
  });
}

const COMPLETE: AuthUser = {
  id: "u1",
  username: "u",
  role: "admin",
  firstName: "U",
  lastName: "U",
  title: "T",
  email: "u@u.com",
  profileComplete: true,
  authSource: "local",
};

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
});

describe("Landing page", () => {
  it("renders the memento logo and the Login button when signed-out", () => {
    setAuth(null);
    const memory = memoryLocation({ path: "/", record: true });
    render(
      <Router hook={memory.hook}>
        <Landing />
      </Router>,
    );
    expect(screen.getByTestId("landing-logo")).toBeDefined();
    expect(screen.getByTestId("landing-login-button")).toBeDefined();
  });

  it("Login button navigates to /login", async () => {
    setAuth(null);
    const memory = memoryLocation({ path: "/", record: true });
    render(
      <Router hook={memory.hook}>
        <Landing />
      </Router>,
    );
    screen.getByTestId("landing-login-button").click();
    await waitFor(() => expect(memory.history).toContain("/login"));
  });

  it("AuthGate lets a signed-out user stay on / so the landing page renders", () => {
    setAuth(null);
    const memory = memoryLocation({ path: "/", record: true });
    render(
      <Router hook={memory.hook}>
        <AuthGate>
          <div data-testid="root-children">root</div>
        </AuthGate>
      </Router>,
    );
    // No forced redirect to /login: still on /.
    expect(memory.history.at(-1)).toBe("/");
    // Children for `/` are allowed to render (they will resolve to Landing
    // in App.tsx via the Root branch).
    expect(screen.getByTestId("root-children")).toBeDefined();
  });

  it("AuthGate keeps redirecting signed-out users from any other route to /login", async () => {
    setAuth(null);
    const memory = memoryLocation({ path: "/settings", record: true });
    render(
      <Router hook={memory.hook}>
        <AuthGate>
          <div data-testid="root-children">root</div>
        </AuthGate>
      </Router>,
    );
    await waitFor(() => expect(memory.history).toContain("/login"));
  });

  it("signed-in users are redirected away from the landing route to their post-login destination", async () => {
    setAuth(COMPLETE);
    const memory = memoryLocation({ path: "/login", record: true });
    render(
      <Router hook={memory.hook}>
        <AuthGate>
          <div data-testid="root-children">root</div>
        </AuthGate>
      </Router>,
    );
    // Authed users that hit /login bounce to /splash; the same gating
    // means a signed-in user will never see Landing on /.
    await waitFor(() => expect(memory.history).toContain("/splash"));
  });
});
