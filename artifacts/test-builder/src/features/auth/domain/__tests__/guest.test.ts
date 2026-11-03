import { describe, expect, it } from "vitest";
import type { AuthUser } from "@workspace/api-client-react";
import {
  formatGuestRemaining,
  guestExpiresAt,
  guestMsRemaining,
} from "../guest";

function makeUser(guestExpiry?: string | null): AuthUser {
  return {
    id: "u1",
    username: "guest-abc123",
    role: "guest",
    profileComplete: true,
    authSource: "guest",
    ...(guestExpiry === undefined ? {} : { guestExpiresAt: guestExpiry }),
  } as unknown as AuthUser;
}

describe("guestExpiresAt", () => {
  it("parses the ISO deadline off the user", () => {
    const iso = "2026-08-02T18:30:00.000Z";
    expect(guestExpiresAt(makeUser(iso))?.toISOString()).toBe(iso);
  });

  it("returns null for a null user", () => {
    expect(guestExpiresAt(null)).toBeNull();
  });

  it("returns null for a real account (no deadline)", () => {
    expect(guestExpiresAt(makeUser(null))).toBeNull();
  });

  it("returns null when the field is absent entirely", () => {
    // This is the pre-codegen shape — the helper must not throw when
    // the generated `AuthUser` predates the `guestExpiresAt` field.
    expect(guestExpiresAt(makeUser(undefined))).toBeNull();
  });

  it("returns null for an unparseable value rather than an Invalid Date", () => {
    expect(guestExpiresAt(makeUser("not-a-date"))).toBeNull();
    expect(guestExpiresAt(makeUser(""))).toBeNull();
  });
});

describe("guestMsRemaining", () => {
  const now = Date.parse("2026-08-02T12:00:00.000Z");

  it("counts down to the deadline", () => {
    const user = makeUser("2026-08-02T14:30:00.000Z");
    expect(guestMsRemaining(user, now)).toBe(2.5 * 60 * 60 * 1000);
  });

  it("clamps at zero once the deadline has passed", () => {
    const user = makeUser("2026-08-02T11:00:00.000Z");
    expect(guestMsRemaining(user, now)).toBe(0);
  });

  it("returns null when there is no deadline", () => {
    expect(guestMsRemaining(makeUser(null), now)).toBeNull();
    expect(guestMsRemaining(null, now)).toBeNull();
  });
});

describe("formatGuestRemaining", () => {
  it("renders hours and minutes", () => {
    expect(formatGuestRemaining(5 * 3600_000 + 42 * 60_000)).toBe("5h 42m");
    expect(formatGuestRemaining(6 * 3600_000)).toBe("6h 0m");
  });

  it("drops the hours segment under an hour", () => {
    expect(formatGuestRemaining(42 * 60_000)).toBe("42m");
    expect(formatGuestRemaining(60_000)).toBe("1m");
  });

  it("collapses sub-minute and zero to a single label", () => {
    expect(formatGuestRemaining(59_000)).toBe("< 1m");
    expect(formatGuestRemaining(0)).toBe("< 1m");
  });
});
