import { describe, expect, it, vi } from "vitest";
import {
  InMemoryPasswordResetThrottle,
  RequestPasswordResetUseCase,
  type PasswordResetThrottle,
} from "@/features/auth/application/useCases";
import type { PasswordResetClient } from "@/features/auth/domain/ports";

function makeClient(
  sendResetEmail: PasswordResetClient["sendResetEmail"],
): PasswordResetClient {
  return { sendResetEmail };
}

const ssoUser = {
  id: "u1",
  email: "a@b.com",
  authSource: "oidc" as const,
};

const noopThrottle: PasswordResetThrottle = { consume: () => 0 };

describe("RequestPasswordResetUseCase", () => {
  it("returns ok on adapter ok and forwards the email", async () => {
    const send = vi.fn(async () => ({ kind: "ok" as const }));
    const uc = new RequestPasswordResetUseCase(makeClient(send), noopThrottle);
    const out = await uc.execute({ user: ssoUser });
    expect(out.kind).toBe("ok");
    expect(send).toHaveBeenCalledWith("a@b.com");
  });

  it("rejects local users with localUser and does not call the adapter", async () => {
    const send = vi.fn();
    const uc = new RequestPasswordResetUseCase(makeClient(send as never), noopThrottle);
    const out = await uc.execute({
      user: { ...ssoUser, authSource: "local" },
    });
    expect(out.kind).toBe("localUser");
    expect(send).not.toHaveBeenCalled();
  });

  it("returns missingEmail when the SSO user has no email", async () => {
    const send = vi.fn();
    const uc = new RequestPasswordResetUseCase(makeClient(send as never), noopThrottle);
    const out = await uc.execute({
      user: { ...ssoUser, email: "" },
    });
    expect(out.kind).toBe("missingEmail");
    expect(send).not.toHaveBeenCalled();
  });

  it("forwards adapter throttled as throttledUpstream", async () => {
    const send = vi.fn(async () => ({
      kind: "throttled" as const,
      retryAfterSeconds: 30,
      message: "slow down",
    }));
    const uc = new RequestPasswordResetUseCase(makeClient(send), noopThrottle);
    const out = await uc.execute({ user: ssoUser });
    expect(out).toEqual({
      kind: "throttledUpstream",
      retryAfterSeconds: 30,
      message: "slow down",
    });
  });

  it("forwards adapter upstreamFailure verbatim", async () => {
    const send = vi.fn(async () => ({
      kind: "upstreamFailure" as const,
      reason: "Nexus 503: boom",
    }));
    const uc = new RequestPasswordResetUseCase(makeClient(send), noopThrottle);
    const out = await uc.execute({ user: ssoUser });
    expect(out).toEqual({ kind: "upstreamFailure", reason: "Nexus 503: boom" });
  });

  it("forwards adapter notConfigured verbatim", async () => {
    const send = vi.fn(async () => ({
      kind: "notConfigured" as const,
      message: "not set",
    }));
    const uc = new RequestPasswordResetUseCase(makeClient(send), noopThrottle);
    const out = await uc.execute({ user: ssoUser });
    expect(out).toEqual({ kind: "notConfigured", message: "not set" });
  });

  it("blocks repeat calls within 60s with throttledSelf and does not call the adapter", async () => {
    const send = vi.fn(async () => ({ kind: "ok" as const }));
    let now = 1_000_000;
    const throttle = new InMemoryPasswordResetThrottle(60_000, () => now);
    const uc = new RequestPasswordResetUseCase(makeClient(send), throttle);

    const first = await uc.execute({ user: ssoUser });
    expect(first.kind).toBe("ok");

    now += 5_000; // 5s later — still within the window
    const second = await uc.execute({ user: ssoUser });
    expect(second.kind).toBe("throttledSelf");
    if (second.kind === "throttledSelf") {
      expect(second.retryAfterSeconds).toBe(55);
    }
    expect(send).toHaveBeenCalledTimes(1);

    now += 60_000; // well past the window
    const third = await uc.execute({ user: ssoUser });
    expect(third.kind).toBe("ok");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
