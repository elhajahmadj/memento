import { describe, expect, it, vi } from "vitest";
import type { User } from "@workspace/db";
import { SignInLocalUseCase } from "../signInLocal";
import type {
  PasswordHasher,
  SessionStore,
  UserRepository,
} from "../../../domain/ports";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    username: "ada",
    role: "limited",
    firstName: null,
    lastName: null,
    title: null,
    email: null,
    passwordHash: "$2a$10$hash",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(overrides as Partial<User>),
  } as User;
}

function makeSession(): SessionStore & {
  regenerated: number;
  saved: number;
} {
  const data: Record<string, unknown> = {};
  let regenerated = 0;
  let saved = 0;
  const store = {
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
  return store as SessionStore & { regenerated: number; saved: number };
}

describe("SignInLocalUseCase", () => {
  it("rejects unknown usernames with an unauthorized error", async () => {
    const users: Partial<UserRepository> = {
      findByUsername: vi.fn().mockResolvedValue(null),
    };
    const hasher: Partial<PasswordHasher> = { verify: vi.fn() };
    const useCase = new SignInLocalUseCase(
      users as UserRepository,
      hasher as PasswordHasher,
    );
    const result = await useCase.execute({
      username: "ada",
      password: "pw",
      session: makeSession(),
    });
    expect(result.kind).toBe("err");
    if (result.kind === "err") {
      expect(result.error.kind).toBe("unauthorized");
    }
    expect(hasher.verify).not.toHaveBeenCalled();
  });

  it("rejects when the stored hash does not match", async () => {
    const user = makeUser();
    const users: Partial<UserRepository> = {
      findByUsername: vi.fn().mockResolvedValue(user),
    };
    const hasher: Partial<PasswordHasher> = {
      verify: vi.fn().mockResolvedValue(false),
    };
    const useCase = new SignInLocalUseCase(
      users as UserRepository,
      hasher as PasswordHasher,
    );
    const result = await useCase.execute({
      username: "ada",
      password: "pw",
      session: makeSession(),
    });
    expect(result.kind).toBe("err");
    expect(hasher.verify).toHaveBeenCalledWith("pw", user.passwordHash);
  });

  it("regenerates the session, stamps userId, and returns the user", async () => {
    const user = makeUser();
    const users: Partial<UserRepository> = {
      findByUsername: vi.fn().mockResolvedValue(user),
    };
    const hasher: Partial<PasswordHasher> = {
      verify: vi.fn().mockResolvedValue(true),
    };
    const session = makeSession();
    const useCase = new SignInLocalUseCase(
      users as UserRepository,
      hasher as PasswordHasher,
    );
    const result = await useCase.execute({
      username: "ada",
      password: "pw",
      session,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.value.user.id).toBe(user.id);
    expect(session.regenerated).toBe(1);
    expect(session.saved).toBe(1);
    expect(session.data.userId).toBe(user.id);
  });

  it("rejects users with no stored password (IDP-only)", async () => {
    const user = makeUser({ passwordHash: null });
    const users: Partial<UserRepository> = {
      findByUsername: vi.fn().mockResolvedValue(user),
    };
    const hasher: Partial<PasswordHasher> = { verify: vi.fn() };
    const useCase = new SignInLocalUseCase(
      users as UserRepository,
      hasher as PasswordHasher,
    );
    const result = await useCase.execute({
      username: "ada",
      password: "pw",
      session: makeSession(),
    });
    expect(result.kind).toBe("err");
    expect(hasher.verify).not.toHaveBeenCalled();
  });
});
