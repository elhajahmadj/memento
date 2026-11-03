import { describe, it, expect } from "vitest";
import { suggestFreeSolutionName } from "@/features/projects/domain/naming";

/**
 * Guests share the flat `workspace/<SolutionName>/` namespace with
 * projects they cannot see, so "that name is taken" is a dead end
 * unless the server hands them one that isn't.
 */
describe("suggestFreeSolutionName", () => {
  it("suggests the '2' variant when only the base name is taken", () => {
    expect(suggestFreeSolutionName("Demo", new Set(["Demo"]))).toBe("Demo2");
  });

  it("skips past variants that are also taken", () => {
    expect(
      suggestFreeSolutionName("Demo", new Set(["Demo", "Demo2", "Demo3"])),
    ).toBe("Demo4");
  });

  it("never returns a name in the taken set", () => {
    const taken = new Set(["A", "A2", "A3", "A4", "A5"]);
    const got = suggestFreeSolutionName("A", taken);
    expect(taken.has(got)).toBe(false);
  });

  it("returns a name that is still a valid solution slug", () => {
    // `validateSolutionName` requires a leading letter then
    // letters/digits/underscore/dot — a numeric suffix keeps that true.
    expect(suggestFreeSolutionName("My.Suite", new Set(["My.Suite"]))).toMatch(
      /^[A-Za-z][A-Za-z0-9_.]*$/,
    );
  });

  it("is unaffected by unrelated names in the taken set", () => {
    expect(
      suggestFreeSolutionName("Demo", new Set(["Other", "Demo", "Unrelated"])),
    ).toBe("Demo2");
  });
});
