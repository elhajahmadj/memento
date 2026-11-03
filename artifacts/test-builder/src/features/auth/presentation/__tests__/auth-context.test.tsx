import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AuthUser } from "@workspace/api-client-react";

const getCurrentUserMock = vi.fn();
const loginApiMock = vi.fn();
const logoutApiMock = vi.fn();
const updateProfileApiMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getCurrentUser: (...a: unknown[]) => getCurrentUserMock(...a),
  login: (...a: unknown[]) => loginApiMock(...a),
  logout: (...a: unknown[]) => logoutApiMock(...a),
  updateProfile: (...a: unknown[]) => updateProfileApiMock(...a),
}));

import { AuthProvider, useAuth } from "../auth-context";

const ALICE: AuthUser = {
  id: "u1",
  username: "alice",
  role: "admin",
  firstName: "Alice",
  lastName: "Anderson",
  title: "Tester",
  email: "alice@example.com",
  profileComplete: true,
  authSource: "local",
};

function Probe() {
  const { user, loading, login, logout, refresh, updateProfile } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="username">{user?.username ?? "none"}</div>
      <button data-testid="login" onClick={() => void login("alice", "pw")} />
      <button
        data-testid="logout"
        onClick={() => {
          logout().catch(() => {});
        }}
      />
      <button data-testid="refresh" onClick={() => void refresh()} />
      <button
        data-testid="update"
        onClick={() => void updateProfile({ firstName: "A2", lastName: "Z", title: "T", email: "x@y.z" })}
      />
    </div>
  );
}

beforeEach(() => {
  getCurrentUserMock.mockReset();
  loginApiMock.mockReset();
  logoutApiMock.mockReset();
  updateProfileApiMock.mockReset();
});

afterEach(() => cleanup());

describe("AuthProvider / useAuth", () => {
  it("starts in loading state, then loads the current user from the API", async () => {
    getCurrentUserMock.mockResolvedValueOnce({ user: ALICE });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("loading").textContent).toBe("true");
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("username").textContent).toBe("alice");
    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);
  });

  it("treats a getCurrentUser failure as signed-out", async () => {
    getCurrentUserMock.mockRejectedValueOnce(new Error("nope"));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("username").textContent).toBe("none");
  });

  it("login() updates the user and logout() clears it", async () => {
    getCurrentUserMock.mockResolvedValueOnce({ user: null });
    loginApiMock.mockResolvedValueOnce({ user: ALICE });
    // login() calls refresh() after the API returns to sync orgs/flags.
    getCurrentUserMock.mockResolvedValueOnce({ user: ALICE });
    logoutApiMock.mockResolvedValueOnce(undefined);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("username").textContent).toBe("none");

    await act(async () => {
      screen.getByTestId("login").click();
    });
    expect(loginApiMock).toHaveBeenCalledWith({ username: "alice", password: "pw" });
    expect(screen.getByTestId("username").textContent).toBe("alice");

    await act(async () => {
      screen.getByTestId("logout").click();
    });
    expect(logoutApiMock).toHaveBeenCalled();
    expect(screen.getByTestId("username").textContent).toBe("none");
  });

  it("logout still clears the user even if the API call rejects", async () => {
    getCurrentUserMock.mockResolvedValueOnce({ user: ALICE });
    logoutApiMock.mockRejectedValueOnce(new Error("server gone"));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("username").textContent).toBe("alice"),
    );
    await act(async () => {
      screen.getByTestId("logout").click();
    });
    expect(screen.getByTestId("username").textContent).toBe("none");
  });

  it("updateProfile() pushes the updated user into context", async () => {
    getCurrentUserMock.mockResolvedValueOnce({ user: ALICE });
    const updated: AuthUser = { ...ALICE, firstName: "A2" };
    updateProfileApiMock.mockResolvedValueOnce(updated);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("username").textContent).toBe("alice"),
    );
    await act(async () => {
      screen.getByTestId("update").click();
    });
    expect(updateProfileApiMock).toHaveBeenCalled();
    // username unchanged but user object should be the new reference
    expect(screen.getByTestId("username").textContent).toBe("alice");
  });

  it("useAuth throws a clear error when used outside an AuthProvider", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Outside() {
      useAuth();
      return null;
    }
    expect(() => render(<Outside />)).toThrow(/AuthProvider/);
    errSpy.mockRestore();
  });
});
