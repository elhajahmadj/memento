import { describe, expect, it } from "vitest";
import { validateRetention } from "../retention-rules";

describe("validateRetention", () => {
  it("accepts an integer within bounds", () => {
    expect(validateRetention("5", 1, 100)).toEqual({ ok: true, value: 5 });
  });

  it("trims whitespace", () => {
    expect(validateRetention("  7  ", 1, 365)).toEqual({ ok: true, value: 7 });
  });

  it("rejects empty input with bounds in the message", () => {
    expect(validateRetention("   ", 1, 100)).toEqual({
      ok: false,
      error: "Enter a number between 1 and 100",
    });
  });

  it("rejects non-integers", () => {
    expect(validateRetention("3.5", 1, 100)).toEqual({
      ok: false,
      error: "Enter a whole number",
    });
    expect(validateRetention("abc", 1, 100)).toEqual({
      ok: false,
      error: "Enter a whole number",
    });
  });

  it("rejects below min and above max", () => {
    expect(validateRetention("0", 1, 100)).toEqual({
      ok: false,
      error: "Must be between 1 and 100",
    });
    expect(validateRetention("366", 1, 365)).toEqual({
      ok: false,
      error: "Must be between 1 and 365",
    });
  });

  it("accepts boundary values", () => {
    expect(validateRetention("1", 1, 100)).toEqual({ ok: true, value: 1 });
    expect(validateRetention("100", 1, 100)).toEqual({ ok: true, value: 100 });
  });
});
