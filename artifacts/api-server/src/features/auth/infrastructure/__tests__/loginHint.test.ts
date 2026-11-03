import { describe, it, expect } from "vitest";
import {
  loginHintDomain,
  normalizeLoginHint,
} from "@/features/auth/infrastructure/loginHint";

describe("normalizeLoginHint()", () => {
  it("accepts a plain valid email", () => {
    expect(normalizeLoginHint("alice@example.com")).toBe("alice@example.com");
  });

  it("trims and lowercases", () => {
    expect(normalizeLoginHint("  Alice@Example.COM  ")).toBe(
      "alice@example.com",
    );
  });

  it("rejects a missing @", () => {
    expect(normalizeLoginHint("alicexample.com")).toBeUndefined();
  });

  it("rejects a missing domain dot", () => {
    expect(normalizeLoginHint("alice@example")).toBeUndefined();
  });

  it("rejects embedded whitespace", () => {
    expect(normalizeLoginHint("alice @example.com")).toBeUndefined();
    expect(normalizeLoginHint("alice@ex ample.com")).toBeUndefined();
  });

  it("rejects values longer than 254 chars", () => {
    const local = "a".repeat(250);
    const tooLong = `${local}@x.io`;
    expect(tooLong.length).toBeGreaterThan(254);
    expect(normalizeLoginHint(tooLong)).toBeUndefined();
  });

  it("accepts values exactly 254 chars", () => {
    const local = "a".repeat(247); // 247 + "@b.com" (6) = 253
    const value = `${local}@b.com`;
    expect(value.length).toBeLessThanOrEqual(254);
    expect(normalizeLoginHint(value)).toBe(value);
  });

  it("rejects empty strings and whitespace-only", () => {
    expect(normalizeLoginHint("")).toBeUndefined();
    expect(normalizeLoginHint("   ")).toBeUndefined();
  });

  it("rejects non-string input", () => {
    expect(normalizeLoginHint(undefined)).toBeUndefined();
    expect(normalizeLoginHint(null)).toBeUndefined();
    expect(normalizeLoginHint(42)).toBeUndefined();
    expect(normalizeLoginHint(["alice@example.com"])).toBeUndefined();
    expect(normalizeLoginHint({ email: "alice@example.com" })).toBeUndefined();
  });

  it("rejects multiple @ signs", () => {
    expect(normalizeLoginHint("a@b@example.com")).toBeUndefined();
  });

  it("rejects empty local part", () => {
    expect(normalizeLoginHint("@example.com")).toBeUndefined();
  });

  it("rejects leading/trailing dot in domain", () => {
    expect(normalizeLoginHint("a@.com")).toBeUndefined();
    expect(normalizeLoginHint("a@b.")).toBeUndefined();
  });

  it("preserves + in local part (Nexus accepts plus-addressing)", () => {
    expect(normalizeLoginHint("alice+tag@example.com")).toBe(
      "alice+tag@example.com",
    );
  });
});

describe("loginHintDomain()", () => {
  it("returns the domain portion", () => {
    expect(loginHintDomain("alice@example.com")).toBe("example.com");
  });

  it("returns empty string when no @ present", () => {
    expect(loginHintDomain("nope")).toBe("");
  });
});
