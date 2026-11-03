import { describe, expect, it, vi } from "vitest";
import { SignOutUseCase } from "../signOut";
import type { SessionStore } from "../../../domain/ports";

function makeSession(): SessionStore & { destroyed: number } {
  let destroyed = 0;
  const store = {
    data: {} as never,
    regenerate: async () => {},
    save: async () => {},
    destroy: async () => {
      destroyed += 1;
    },
    get destroyed() {
      return destroyed;
    },
  };
  return store as SessionStore & { destroyed: number };
}

describe("SignOutUseCase", () => {
  it("clears the user's pinned project and destroys the session", async () => {
    const clear = vi.fn();
    const session = makeSession();
    await new SignOutUseCase(clear).execute({
      userId: "user-1",
      session,
    });
    expect(clear).toHaveBeenCalledWith("user-1");
    expect(session.destroyed).toBe(1);
  });

  it("skips the project clear when there is no user id", async () => {
    const clear = vi.fn();
    const session = makeSession();
    await new SignOutUseCase(clear).execute({ userId: null, session });
    expect(clear).not.toHaveBeenCalled();
    expect(session.destroyed).toBe(1);
  });
});
