import { describe, expect, it, vi } from "vitest";
import type { User } from "@workspace/db";
import { VerifyBearerTokenUseCase } from "../verifyBearerToken";
import type {
  OidcGateway,
  OidcTokenVerifier,
  UserRepository,
} from "../../../domain/ports";

function makeUser(): User {
  return {
    id: "u-1",
    username: "sub-1",
    role: "limited",
    firstName: null,
    lastName: null,
    title: null,
    email: null,
    passwordHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as User;
}

const tokenClaims = { sub: "sub-1", aud: "memento" };
const userInfo = { email: "ada@example.com", roles: ["User"] };

const ARGS = { token: "tok", orgClaim: "org", rolesClaim: "roles" };

describe("VerifyBearerTokenUseCase", () => {
  it("returns 401 when the token fails signature/issuer verification", async () => {
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn(),
      verifyAccessToken: vi.fn().mockRejectedValue(new Error("bad sig")),
    };
    const gateway: Partial<OidcGateway> = { fetchUserInfo: vi.fn() };
    const users: Partial<UserRepository> = { provisionFromClaims: vi.fn() };
    const result = await new VerifyBearerTokenUseCase(
      verifier,
      gateway as OidcGateway,
      users as UserRepository,
    ).execute(ARGS);
    expect(result.kind).toBe("err");
    expect(gateway.fetchUserInfo).not.toHaveBeenCalled();
  });

  it("returns 401 when /userinfo enrichment fails", async () => {
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn(),
      verifyAccessToken: vi.fn().mockResolvedValue(tokenClaims),
    };
    const gateway: Partial<OidcGateway> = {
      fetchUserInfo: vi.fn().mockRejectedValue(new Error("401")),
    };
    const users: Partial<UserRepository> = { provisionFromClaims: vi.fn() };
    const result = await new VerifyBearerTokenUseCase(
      verifier,
      gateway as OidcGateway,
      users as UserRepository,
    ).execute(ARGS);
    expect(result.kind).toBe("err");
    expect(users.provisionFromClaims).not.toHaveBeenCalled();
  });

  it("returns 401 when provisioning throws", async () => {
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn(),
      verifyAccessToken: vi.fn().mockResolvedValue(tokenClaims),
    };
    const gateway: Partial<OidcGateway> = {
      fetchUserInfo: vi.fn().mockResolvedValue(userInfo),
    };
    const users: Partial<UserRepository> = {
      provisionFromClaims: vi.fn().mockRejectedValue(new Error("db down")),
    };
    const result = await new VerifyBearerTokenUseCase(
      verifier,
      gateway as OidcGateway,
      users as UserRepository,
    ).execute(ARGS);
    expect(result.kind).toBe("err");
  });

  it("downgrades a Memento Admin bearer token to admin when mementoAdmin claim is missing", async () => {
    const user = makeUser();
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn(),
      verifyAccessToken: vi.fn().mockResolvedValue({ sub: "sub-1" }),
    };
    const gateway: Partial<OidcGateway> = {
      fetchUserInfo: vi.fn().mockResolvedValue({
        organizations: [{ id: "ext-1", mementoAccess: true }],
        "https://nexus/claims": {
          mementoUser: true,
          // Triple incomplete → role must be downgraded.
          roles: ["Memento Admin"],
        },
      }),
    };
    const provision = vi.fn().mockResolvedValue({ user, orgs: [] });
    const users: Partial<UserRepository> = { provisionFromClaims: provision };
    const result = await new VerifyBearerTokenUseCase(
      verifier,
      gateway as OidcGateway,
      users as UserRepository,
    ).execute(ARGS);
    expect(result.kind).toBe("ok");
    expect(provision).toHaveBeenCalledTimes(1);
    const arg = provision.mock.calls[0]![0];
    expect(arg.isGodmode).toBe(false);
    expect(arg.role).toBe("admin");
  });

  it("promotes to memento_admin on the bearer path when the full god-mode triple is present", async () => {
    const user = makeUser();
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn(),
      verifyAccessToken: vi.fn().mockResolvedValue({ sub: "sub-1" }),
    };
    const gateway: Partial<OidcGateway> = {
      fetchUserInfo: vi.fn().mockResolvedValue({
        organizations: [{ id: "ext-1", mementoAccess: true }],
        "https://nexus/claims": {
          mementoUser: true,
          mementoAccess: true,
          mementoGodMode: "mementoAdmin",
          "NexusTier reserved": "NexusAdmin",
          roles: ["User"],
        },
      }),
    };
    const provision = vi.fn().mockResolvedValue({ user, orgs: [] });
    const users: Partial<UserRepository> = { provisionFromClaims: provision };
    const result = await new VerifyBearerTokenUseCase(
      verifier,
      gateway as OidcGateway,
      users as UserRepository,
    ).execute(ARGS);
    expect(result.kind).toBe("ok");
    const arg = provision.mock.calls[0]![0];
    expect(arg.isGodmode).toBe(true);
    expect(arg.role).toBe("memento_admin");
  });

  it("honors custom god-mode triple overrides on the bearer path", async () => {
    const user = makeUser();
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn(),
      verifyAccessToken: vi.fn().mockResolvedValue({ sub: "sub-1" }),
    };
    const gateway: Partial<OidcGateway> = {
      fetchUserInfo: vi.fn().mockResolvedValue({
        organizations: [{ id: "ext-1", customAccess: true }],
        "https://custom/ns": {
          customUser: true,
          customAccess: true,
          customGod: "GOD",
          customTier: "T9",
          roles: ["User"],
        },
      }),
    };
    const provision = vi.fn().mockResolvedValue({ user, orgs: [] });
    const users: Partial<UserRepository> = { provisionFromClaims: provision };
    const result = await new VerifyBearerTokenUseCase(
      verifier,
      gateway as OidcGateway,
      users as UserRepository,
    ).execute({
      ...ARGS,
      userClaimsNamespace: "https://custom/ns",
      mementoUserClaim: "customUser",
      mementoAccessClaim: "customAccess",
      mementoGodModeAccessClaim: "customAccess",
      mementoGodModeRoleClaim: "customGod",
      mementoGodModeRoleValue: "GOD",
      mementoGodModeTierClaim: "customTier",
      mementoGodModeTierValue: "T9",
    });
    expect(result.kind).toBe("ok");
    const arg = provision.mock.calls[0]![0];
    expect(arg.role).toBe("memento_admin");
  });

  it("returns the provisioned user on the happy path", async () => {
    const user = makeUser();
    const verifier: OidcTokenVerifier = {
      verifyIdToken: vi.fn(),
      verifyAccessToken: vi.fn().mockResolvedValue(tokenClaims),
    };
    const gateway: Partial<OidcGateway> = {
      fetchUserInfo: vi.fn().mockResolvedValue(userInfo),
    };
    const provision = vi.fn().mockResolvedValue({ user, orgs: [] });
    const users: Partial<UserRepository> = {
      provisionFromClaims: provision,
    };
    const result = await new VerifyBearerTokenUseCase(
      verifier,
      gateway as OidcGateway,
      users as UserRepository,
    ).execute(ARGS);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.value.user.id).toBe(user.id);
    // Merged claim set is normalized and handed to the repo. The
    // verified token's `sub` must win over /userinfo's identity hint.
    expect(provision).toHaveBeenCalledTimes(1);
    const arg = provision.mock.calls[0]![0];
    expect(arg.subject).toBe("sub-1");
  });
});
