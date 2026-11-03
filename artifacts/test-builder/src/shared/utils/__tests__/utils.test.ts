import { describe, expect, it } from "vitest";
import { cn } from "../utils";

describe("cn (className merger)", () => {
  it("joins string class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("ignores falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("merges Tailwind classes so the last one wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm text-red-500", "text-blue-500")).toBe(
      "text-sm text-blue-500",
    );
  });

  it("respects conditional class objects from clsx", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("flattens nested arrays of class values", () => {
    expect(cn(["a", ["b", { c: true }]], "d")).toBe("a b c d");
  });
});
