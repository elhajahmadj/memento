import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AuthUser } from "@workspace/api-client-react";
import { AuthGate } from "../auth-gate";

const useAuthMock = vi.fn();
vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

function setAuth(
  user: AuthUser | null,
  loading = false,
  opts: {
    organizations?: Array<{ id: string; externalKey: string; displayName: string }>;
    activeOrganizationId?: string | null;
  } = {},
) {
  useAuthMock.mockReturnValue({
    user,
    loading,
    organizations: opts.organizations ?? [],
    activeOrganizationId: opts.activeOrganizationId ?? null,
  });
}

function renderAt(path: string) {
  const memory = memoryLocation({ path, record: true });
  const utils = render(
    <Router hook={memory.hook}>
      <AuthGate>
        <div data-testid="protected">secret</div>
      </AuthGate>
    </Router>,
  );
  return { ...utils, memory };
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
const INCOMPLETE: AuthUser = { ...COMPLETE, profileComplete: false };

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
});

describe("AuthGate", () => {
  it("shows a loading spinner while auth is loading and hides children", () => {
    setAuth(null, true);
    renderAt("/");
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("redirects unauthenticated users on a protected route to /login", async () => {
    setAuth(null);
    const { memory } = renderAt("/settings");
    await waitFor(() => expect(memory.history).toContain("/login"));
  });

  it("does NOT redirect signed-out users away from / so the public landing page can render", async () => {
    setAuth(null);
    const { memory } = renderAt("/");
    // Wait a tick for any redirect effects to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(memory.history).not.toContain("/login");
    // Children render for `/` even when signed-out (Landing is rendered
    // by the Root branch in App.tsx).
    expect(screen.getByTestId("protected")).toBeDefined();
  });

  it("renders the login page itself when there's no user and we're already on /login", () => {
    setAuth(null);
    renderAt("/login");
    expect(screen.getByTestId("protected")).toBeDefined();
  });

  it("renders the post-logout page when there's no user and we're on /logged-out (no bounce to /login)", async () => {
    setAuth(null);
    const { memory } = renderAt("/logged-out");
    expect(screen.getByTestId("protected")).toBeDefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(memory.history).not.toContain("/login");
  });

  it("redirects an authed user away from /login to /splash when profile is complete", async () => {
    setAuth(COMPLETE);
    const { memory } = renderAt("/login");
    await waitFor(() => expect(memory.history).toContain("/splash"));
  });

  it("redirects an authed user with an incomplete profile from /login to /profile/complete", async () => {
    setAuth(INCOMPLETE);
    const { memory } = renderAt("/login");
    await waitFor(() =>
      expect(memory.history).toContain("/profile/complete"),
    );
  });

  it("forces incomplete-profile users from /splash to /profile/complete", async () => {
    setAuth(INCOMPLETE);
    const { memory } = renderAt("/splash");
    await waitFor(() =>
      expect(memory.history).toContain("/profile/complete"),
    );
  });

  it("forces incomplete-profile users on any other route to /profile/complete", async () => {
    setAuth(INCOMPLETE);
    const { memory } = renderAt("/settings");
    await waitFor(() =>
      expect(memory.history).toContain("/profile/complete"),
    );
  });

  it("redirects complete users away from /profile/complete to /profile", async () => {
    setAuth(COMPLETE);
    const { memory } = renderAt("/profile/complete");
    await waitFor(() => expect(memory.history).toContain("/profile"));
  });

  it("renders children when the user is fully authed and on a normal route", () => {
    setAuth(COMPLETE);
    renderAt("/");
    expect(screen.getByTestId("protected")).toBeDefined();
  });

  it("lets a fully-authed SSO user (orgs + activeOrganizationId) render /splash without redirecting", async () => {
    setAuth(COMPLETE, false, {
      organizations: [
        { id: "org-1", externalKey: "ext-1", displayName: "Org One" },
      ],
      activeOrganizationId: "org-1",
    });
    const { memory } = renderAt("/splash");
    expect(screen.getByTestId("protected")).toBeDefined();
    await new Promise((r) => setTimeout(r, 0));
    // Should not be bounced to /pick-org, /profile/complete, /login, or /.
    expect(memory.history).not.toContain("/pick-org");
    expect(memory.history).not.toContain("/profile/complete");
    expect(memory.history).not.toContain("/login");
    expect(memory.history).not.toContain("/");
  });

  it("bounces an incomplete-profile SSO user from /splash to /profile/complete", async () => {
    setAuth(INCOMPLETE, false, {
      organizations: [
        { id: "org-1", externalKey: "ext-1", displayName: "Org One" },
      ],
      activeOrganizationId: "org-1",
    });
    const { memory } = renderAt("/splash");
    await waitFor(() =>
      expect(memory.history).toContain("/profile/complete"),
    );
  });
});
