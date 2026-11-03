import { describe, expect, it, vi } from "vitest";
import type { Organization, User } from "@workspace/db";
import {
  SignInOidcCallbackUseCase,
  UserInfoUnauthorizedError,
  type OidcClaimConfig,
} from "../signInOidcCallback";
import type {
  OidcGateway,
  OidcTokenVerifier,
  SessionStore,
  UserRepository,
} from "../../../domain/ports";

const claimConfig: OidcClaimConfig = {
  orgClaim: "organizations",
  rolesClaim: "roles",
  userClaimsNamespace: "https://nexus/claims",
  mementoUserClaim: "mementoUser",
  mementoAccessClaim: "mementoAccess",
  mementoGodModeAccessClaim: "mementoAccess",
  mementoGodModeRoleClaim: "mementoGodMode",
  mementoGodModeRoleValue: "mementoAdmin",
  mementoGodModeTierClaim: "NexusTier reserved",
  mementoGodModeTierValue: "NexusAdmin",
};

function makeSession() {
  const data: Record<string, unknown> = {};
  let regenerated = 0;
  let saved = 0;
  const store: SessionStore & { regenerated: number; saved: number } = {
    data: data as never,
    regenerate: async () => {
      regenerated += 1;
    },
    save: async () => {
      saved += 1;
    },
    destroy: async () => {},
    get regenerated() {
      return regenerated;
    },
    get saved() {
      return saved;
    },
  };
  return store;
}

function tokens(extra: Record<string, unknown> = {}) {
  return {
    access_token: "at",
    id_token: "idt",
    refresh_token: "rt",
    expires_in: 3600,
    ...extra,
  };
}

function makeUser(role: User["role"] = "limited"): User {
  return {
    id: "u-1",
    username: "sub-1",
    role,
    firstName: null,
    lastName: null,
    title: null,
    email: null,
    passwordHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as User;
}

function makeOrg(): Organization {
  return {
    id: "org-1",
    externalKey: "ext-1",
    displayName: "Org",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Organization;
}

const BASE_INPUT = {
  code: "c",
  state: "s",
  sessionState: "s",
  codeVerifier: "v",
  claimConfig,
};

describe("SignInOidcCallbackUseCase", () => {
  it("returns a validation error when state/code/verifier are missing or mismatched", async () => {
    const useCase = new SignInOidcCallbackUseCase(
      { verifyIdToken: vi.fn(), verifyAccessToken: vi.fn() },
      {} as OidcGateway,
      {} as UserRepository,
    );
    const result = await useCase.execute({
      ...BASE_INPUT,
      state: "different",
      session: makeSession(),
    });
    expect(result.kind).toBe("err");
  });

  it("returns no_id_token when the IDP omits id_token from the exchange", async () => {
    const useCase = new SignInOidcCallbackUseCase(
      { verifyIdToken: vi.fn(), verifyAccessToken: vi.fn() },
      {
        exchangeCodeForTokens: vi
          .fn()
          .mockResolvedValue({ access_token: "at" }),
        refreshAccessToken: vi.fn(),
        fetchUserInfo: vi.fn(),
      },
      {} as UserRepository,
    );
    const result = await useCase.execute({
      ...BASE_INPUT,
      session: makeSession(),
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.kind).toBe("deny");
      if (result.value.kind === "deny")
        expect(result.value.marker).toBe("no_id_token");
    }
  });

  it("surfaces userinfo_unauthorized when /userinfo 401s", async () => {
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn().mockResolvedValue({ sub: "sub-1" }),
      verifyAccessToken: vi.fn(),
    };
    const gateway: OidcGateway = {
      exchangeCodeForTokens: vi.fn().mockResolvedValue(tokens()),
      refreshAccessToken: vi.fn(),
      fetchUserInfo: vi
        .fn()
        .mockRejectedValue(new UserInfoUnauthorizedError("401")),
    };
    const useCase = new SignInOidcCallbackUseCase(
      verifier,
      gateway,
      {} as UserRepository,
    );
    const result = await useCase.execute({
      ...BASE_INPUT,
      session: makeSession(),
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.kind).toBe("userinfo_unauthorized");
    }
  });

  it("denies with no_memento_user when the user-gate is missing", async () => {
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn().mockResolvedValue({ sub: "sub-1" }),
      verifyAccessToken: vi.fn(),
    };
    const gateway: OidcGateway = {
      exchangeCodeForTokens: vi.fn().mockResolvedValue(tokens()),
      refreshAccessToken: vi.fn(),
      // No `https://nexus/claims.mementoUser` anywhere → gate fails.
      fetchUserInfo: vi.fn().mockResolvedValue({
        organizations: [{ id: "ext-1", mementoAccess: true }],
        roles: ["User"],
      }),
    };
    const users: Partial<UserRepository> = {
      provisionFromClaims: vi.fn(),
    };
    const result = await new SignInOidcCallbackUseCase(
      verifier,
      gateway,
      users as UserRepository,
    ).execute({ ...BASE_INPUT, session: makeSession() });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.value.kind === "deny") {
      expect(result.value.marker).toBe("no_memento_user");
      expect(result.value.boundOrg).toBe("ext-1");
    }
    expect(users.provisionFromClaims).not.toHaveBeenCalled();
  });

  it("denies with no_memento_access when the bound org lacks the access claim", async () => {
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn().mockResolvedValue({ sub: "sub-1" }),
      verifyAccessToken: vi.fn(),
    };
    const gateway: OidcGateway = {
      exchangeCodeForTokens: vi.fn().mockResolvedValue(tokens()),
      refreshAccessToken: vi.fn(),
      fetchUserInfo: vi.fn().mockResolvedValue({
        // Org entry intentionally lacks mementoAccess → gate denies.
        organizations: [{ id: "ext-1" }],
        roles: ["User"],
        "https://nexus/claims": { mementoUser: true },
      }),
    };
    const users: Partial<UserRepository> = {
      provisionFromClaims: vi
        .fn()
        .mockResolvedValue({ user: makeUser(), orgs: [] }),
    };
    const result = await new SignInOidcCallbackUseCase(
      verifier,
      gateway,
      users as UserRepository,
    ).execute({ ...BASE_INPUT, session: makeSession() });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.value.kind === "deny") {
      expect(result.value.marker).toBe("no_memento_access");
    }
  });

  it("starts a session on the happy path and parks OIDC tokens", async () => {
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn().mockResolvedValue({ sub: "sub-1" }),
      verifyAccessToken: vi.fn(),
    };
    const gateway: OidcGateway = {
      exchangeCodeForTokens: vi.fn().mockResolvedValue(tokens()),
      refreshAccessToken: vi.fn(),
      fetchUserInfo: vi.fn().mockResolvedValue({
        organizations: [{ id: "ext-1", mementoAccess: true }],
        roles: ["User"],
        "https://nexus/claims": { mementoUser: true },
      }),
    };
    const user = makeUser();
    const org = makeOrg();
    const users: Partial<UserRepository> = {
      provisionFromClaims: vi
        .fn()
        .mockResolvedValue({ user, orgs: [org] }),
    };
    const session = makeSession();
    const result = await new SignInOidcCallbackUseCase(
      verifier,
      gateway,
      users as UserRepository,
    ).execute({ ...BASE_INPUT, session });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.kind).toBe("success");
    }
    expect(session.regenerated).toBe(1);
    expect(session.saved).toBe(1);
    expect(session.data.userId).toBe(user.id);
    expect(session.data.activeOrgId).toBe(org.id);
    expect(session.data.oidcIdToken).toBe("idt");
    expect(session.data.oidcAccessToken).toBe("at");
    expect(session.data.oidcRefreshToken).toBe("rt");
  });

  it("downgrades Memento Admin role to admin when the mementoAdmin claim is missing", async () => {
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn().mockResolvedValue({ sub: "sub-1" }),
      verifyAccessToken: vi.fn(),
    };
    const gateway: OidcGateway = {
      exchangeCodeForTokens: vi.fn().mockResolvedValue(tokens()),
      refreshAccessToken: vi.fn(),
      fetchUserInfo: vi.fn().mockResolvedValue({
        organizations: [{ id: "ext-1", mementoAccess: true }],
        // mementoUser present, but no mementoAdmin → role is downgraded
        // to plain `admin` before provisioning. Roles live inside the
        // namespace because the Nexus namespace is present.
        "https://nexus/claims": {
          mementoUser: true,
          roles: ["Memento Admin"],
        },
      }),
    };
    const provisionFromClaims = vi
      .fn()
      .mockResolvedValue({ user: makeUser("admin"), orgs: [makeOrg()] });
    const users: Partial<UserRepository> = { provisionFromClaims };
    const result = await new SignInOidcCallbackUseCase(
      verifier,
      gateway,
      users as UserRepository,
    ).execute({ ...BASE_INPUT, session: makeSession() });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.value.kind === "success") {
      expect(result.value.normalized.role).toBe("admin");
      expect(result.value.normalized.isGodmode).toBe(false);
    }
    expect(provisionFromClaims).toHaveBeenCalledTimes(1);
    const claimsArg = provisionFromClaims.mock.calls[0]?.[0];
    expect(claimsArg?.role).toBe("admin");
  });

  it("memento admins skip the org-gate and get no activeOrgId", async () => {
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn().mockResolvedValue({ sub: "sub-1" }),
      verifyAccessToken: vi.fn(),
    };
    const gateway: OidcGateway = {
      exchangeCodeForTokens: vi.fn().mockResolvedValue(tokens()),
      refreshAccessToken: vi.fn(),
      fetchUserInfo: vi.fn().mockResolvedValue({
        // Org entry deliberately lacks mementoAccess — Memento Admin
        // bypasses the org-gate entirely. The full god-mode triple
        // is required for the role to survive — without it the role
        // would be downgraded to plain `admin`.
        organizations: [{ id: "ext-1" }],
        roles: ["User"],
        "https://nexus/claims": {
          mementoUser: true,
          mementoAccess: true,
          mementoGodMode: "mementoAdmin",
          "NexusTier reserved": "NexusAdmin",
        },
      }),
    };
    const user = makeUser("memento_admin");
    const users: Partial<UserRepository> = {
      provisionFromClaims: vi
        .fn()
        .mockResolvedValue({ user, orgs: [] }),
    };
    const session = makeSession();
    const result = await new SignInOidcCallbackUseCase(
      verifier,
      gateway,
      users as UserRepository,
    ).execute({ ...BASE_INPUT, session });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.value.kind).toBe("success");
    expect(session.data.userId).toBe(user.id);
    expect(session.data.activeOrgId).toBeNull();
  });
});
