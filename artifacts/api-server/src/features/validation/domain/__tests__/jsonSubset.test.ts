import { describe, it, expect } from "vitest";
import { jsonSubsetMismatch } from "../jsonSubset";

describe("jsonSubsetMismatch", () => {
  it("returns null when the actual value contains all expected keys", () => {
    expect(
      jsonSubsetMismatch(
        { a: 1, nested: { b: "x" } },
        { a: 1, nested: { b: "x", c: true }, extra: 42 },
        "$",
      ),
    ).toBeNull();
  });

  it("reports missing keys at the right path", () => {
    expect(
      jsonSubsetMismatch({ a: { b: 1 } }, { a: {} }, "$"),
    ).toBe("$.a.b: missing");
  });

  it("reports scalar mismatches with both values", () => {
    expect(jsonSubsetMismatch(1, 2, "$.x")).toContain("expected 1");
  });

  it("type-checks arrays vs objects vs scalars", () => {
    expect(jsonSubsetMismatch([], {}, "$")).toMatch(/expected (object|array)/);
    expect(jsonSubsetMismatch({}, [], "$")).toMatch(/expected (object|array)/);
    expect(jsonSubsetMismatch("x", 1, "$")).toMatch(/expected/);
  });

  it("walks arrays positionally", () => {
    expect(
      jsonSubsetMismatch([1, { a: 1 }], [1, { a: 2 }], "$"),
    ).toContain("$[1].a");
  });
});
