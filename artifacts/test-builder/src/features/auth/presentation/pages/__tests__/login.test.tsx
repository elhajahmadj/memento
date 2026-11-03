import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
const loginMock = vi.fn();
const continueAsGuestMock = vi.fn();
let ssoEnabled = true;

vi.mock("wouter", () => ({
  useLocation: () => ["/login", navigateMock],
  Link: ({ children, href, ...rest }: { children: ReactNode; href?: string } & Record<string, unknown>) =>
    <a href={href} {...rest}>{children}</a>,
}));

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: loginMock,
    continueAsGuest: continueAsGuestMock,
    logout: vi.fn(),
    refresh: vi.fn(),
    updateProfile: vi.fn(),
    ssoEnabled,
  }),
}));

import { Login, classifyIdentifier } from "../login";
import { ApiError } from "@workspace/api-client-react";

const originalLocation = window.location;
let hrefSink: { value: string };

beforeEach(() => {
  hrefSink = { value: "" };
  // jsdom's Location is a real object; replace with a spy that tracks
  // assignments to `href` so the SSO redirect can be asserted without
  // actually navigating the test environment.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...originalLocation,
      search: originalLocation.search,
      get href() {
        return hrefSink.value;
      },
      set href(v: string) {
        hrefSink.value = v;
      },
    },
  });
});

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  loginMock.mockReset();
  continueAsGuestMock.mockReset();
  ssoEnabled = true;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

function typeUsername(value: string) {
  fireEvent.change(screen.getByTestId("input-username"), {
    target: { value },
  });
}

describe("classifyIdentifier()", () => {
  it("treats values with @ + . in the domain as email", () => {
    expect(classifyIdentifier("alice@example.com")).toBe("email");
    expect(classifyIdentifier("  alice@x.io  ")).toBe("email");
  });

  it("treats bare usernames and malformed inputs as local", () => {
    expect(classifyIdentifier("alice")).toBe("local");
    expect(classifyIdentifier("alice@nodomain")).toBe("local");
    expect(classifyIdentifier("@example.com")).toBe("local");
    expect(classifyIdentifier("alice@")).toBe("local");
    expect(classifyIdentifier("alice @example.com")).toBe("local");
    expect(classifyIdentifier("")).toBe("local");
  });
});

describe("<Login /> step 1 — identifier", () => {
  it("renders only the username field, no password and no SSO button", () => {
    render(<Login />);
    expect(screen.getByTestId("input-username")).toBeDefined();
    expect(screen.getByTestId("button-next")).toBeDefined();
    expect(screen.queryByTestId("input-password")).toBeNull();
    expect(screen.queryByTestId("button-sign-in")).toBeNull();
    expect(screen.queryByTestId("button-sso-sign-in")).toBeNull();
    expect(screen.getByTestId("button-continue-as-guest")).toBeDefined();
  });

  it("requires the identifier before submitting", () => {
    render(<Login />);
    fireEvent.click(screen.getByTestId("button-next"));
    expect(screen.getByTestId("text-login-error").textContent).toMatch(
      /Enter your username or email/i,
    );
  });

  it("redirects an email identifier to /api/auth/sso/login with login_hint", () => {
    render(<Login />);
    typeUsername("alice@example.com");
    fireEvent.click(screen.getByTestId("button-next"));
    expect(hrefSink.value).toBe(
      "/api/auth/sso/login?login_hint=alice%40example.com",
    );
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("shows an inline error for an email when SSO is disabled", () => {
    ssoEnabled = false;
    render(<Login />);
    typeUsername("alice@example.com");
    fireEvent.click(screen.getByTestId("button-next"));
    expect(hrefSink.value).toBe("");
    expect(screen.getByTestId("text-login-error").textContent).toMatch(
      /SSO sign-in isn't configured/i,
    );
  });

  it("advances to the password step for a non-email identifier", () => {
    render(<Login />);
    typeUsername("alice");
    fireEvent.click(screen.getByTestId("button-next"));
    expect(screen.getByTestId("input-password")).toBeDefined();
    expect(screen.getByTestId("button-sign-in")).toBeDefined();
    const usernameField = screen.getByTestId("input-username") as HTMLInputElement;
    expect(usernameField.value).toBe("alice");
    expect(usernameField.readOnly).toBe(true);
  });
});

describe("<Login /> step 2 — password", () => {
  function advanceToPasswordStep(username = "alice") {
    render(<Login />);
    typeUsername(username);
    fireEvent.click(screen.getByTestId("button-next"));
  }

  it("returns to step 1 when 'Use a different username' is clicked, clearing errors", async () => {
    loginMock.mockRejectedValueOnce(
      new ApiError(
        new Response(null, { status: 401, statusText: "Unauthorized" }),
        null,
        { method: "POST", url: "/login" },
      ),
    );
    advanceToPasswordStep("alice");
    fireEvent.change(screen.getByTestId("input-password"), {
      target: { value: "bad" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-sign-in"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("text-login-error")).toBeDefined(),
    );
    fireEvent.click(screen.getByTestId("button-back-to-username"));
    expect(screen.getByTestId("button-next")).toBeDefined();
    expect(screen.queryByTestId("input-password")).toBeNull();
    expect(screen.queryByTestId("text-login-error")).toBeNull();
  });

  it("calls login() and navigates to /splash on success", async () => {
    loginMock.mockResolvedValueOnce(undefined);
    advanceToPasswordStep("alice");
    fireEvent.change(screen.getByTestId("input-password"), {
      target: { value: "pw" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-sign-in"));
    });
    expect(loginMock).toHaveBeenCalledWith("alice", "pw");
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/splash", { replace: true }),
    );
  });

  it("shows a friendly error when the API returns 401", async () => {
    loginMock.mockRejectedValueOnce(
      new ApiError(
        new Response(null, { status: 401, statusText: "Unauthorized" }),
        null,
        { method: "POST", url: "/login" },
      ),
    );
    advanceToPasswordStep("alice");
    fireEvent.change(screen.getByTestId("input-password"), {
      target: { value: "wrong" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-sign-in"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("text-login-error").textContent).toMatch(
        /Invalid username or password/i,
      ),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("surfaces the message of generic Error rejections", async () => {
    loginMock.mockRejectedValueOnce(new Error("network down"));
    advanceToPasswordStep("alice");
    fireEvent.change(screen.getByTestId("input-password"), {
      target: { value: "pw" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-sign-in"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("text-login-error").textContent).toBe(
        "network down",
      ),
    );
  });
});

describe("<Login /> SSO deny banner", () => {
  function renderAt(search: string) {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, search, href: "" },
    });
    return render(<Login />);
  }

  it("renders the generic fallback for no_memento_user without an org param", () => {
    renderAt("?sso_error=no_memento_user");
    const banner = screen.getByTestId("text-sso-error");
    expect(banner.textContent).toMatch(/You are not authorized to use memento/);
    expect(banner.textContent).toMatch(
      /Contact your administrator to request access/,
    );
    expect(screen.queryByTestId("block-sso-admin-contacts")).toBeNull();
  });

  it("renders the generic fallback for no_org (never tries to look up contacts)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderAt("?sso_error=no_org");
    const banner = screen.getByTestId("text-sso-error");
    expect(banner.textContent).toMatch(
      /Your account is not assigned to any organization/,
    );
    expect(banner.textContent).toMatch(/Contact your administrator/);
    expect(screen.queryByTestId("block-sso-admin-contacts")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("renders admin contacts + Request access mailto when the server returns admins", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          org: { externalKey: "org-1", displayName: "Acme" },
          admins: [
            { email: "alice@acme.test", displayName: "Alice A" },
            { email: "bob@acme.test", displayName: "Bob B" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    renderAt("?sso_error=no_memento_access&org=org-1");
    await waitFor(() =>
      expect(screen.getByTestId("block-sso-admin-contacts")).toBeDefined(),
    );
    const banner = screen.getByTestId("text-sso-error");
    expect(banner.textContent).toMatch(/your organization \(Acme\)/);
    expect(screen.queryByTestId("text-sso-generic-fallback")).toBeNull();
    const requestLink = screen.getByTestId(
      "link-sso-request-access",
    ) as HTMLAnchorElement;
    expect(requestLink.href).toMatch(
      /^mailto:alice@acme\.test,bob@acme\.test\?subject=/,
    );
    expect(requestLink.href).toContain("our%20organization");
    expect(screen.getByTestId("link-sso-admin-alice@acme.test")).toBeDefined();
    expect(screen.getByTestId("link-sso-admin-bob@acme.test")).toBeDefined();
  });

  it("falls back to the generic copy when the server reports zero admins", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ org: null, admins: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    renderAt("?sso_error=no_memento_access&org=unknown");
    await waitFor(() =>
      expect(screen.getByTestId("text-sso-generic-fallback")).toBeDefined(),
    );
    expect(screen.queryByTestId("block-sso-admin-contacts")).toBeNull();
  });
});

describe("<Login /> help disclosure", () => {
  it("toggles the help section when 'Need help signing in?' is clicked", () => {
    render(<Login />);
    fireEvent.click(screen.getByTestId("button-login-help"));
    expect(
      screen.getByText(/Email addresses are sent to your organization's single sign-on/i),
    ).toBeDefined();
  });
});

describe("<Login /> — continue as guest", () => {
  it("offers the guest button on step 1 with the trial terms spelled out", () => {
    render(<Login />);
    const btn = screen.getByTestId("button-continue-as-guest");
    expect(btn.textContent).toMatch(/Continue as guest/i);
    // The limits must be visible before the click, not discovered after.
    expect(screen.getByText(/6 hours/i)).toBeDefined();
    expect(screen.getByText(/One project, no AI/i)).toBeDefined();
  });

  it("is hidden on the password step", () => {
    render(<Login />);
    typeUsername("alice");
    fireEvent.click(screen.getByTestId("button-next"));
    expect(screen.queryByTestId("button-continue-as-guest")).toBeNull();
  });

  it("starts a guest session and navigates to /splash", async () => {
    continueAsGuestMock.mockResolvedValueOnce(undefined);
    render(<Login />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-continue-as-guest"));
    });
    expect(continueAsGuestMock).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/splash", { replace: true }),
    );
  });

  it("surfaces the capacity message and stays put when every slot is taken", async () => {
    continueAsGuestMock.mockRejectedValueOnce(
      new Error("Max guest sessions in use for the day. Please try again later."),
    );
    render(<Login />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-continue-as-guest"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("text-guest-error").textContent).toMatch(
        /Max guest sessions in use for the day/i,
      ),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("keeps the guest failure out of the sign-in error slot", async () => {
    continueAsGuestMock.mockRejectedValueOnce(new Error("boom"));
    render(<Login />);
    typeUsername("alice");
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-continue-as-guest"));
    });
    await waitFor(() => expect(screen.getByTestId("text-guest-error")).toBeDefined());
    // The typed identifier and the sign-in path must be untouched.
    expect(screen.queryByTestId("text-login-error")).toBeNull();
    expect(
      (screen.getByTestId("input-username") as HTMLInputElement).value,
    ).toBe("alice");
  });
});
