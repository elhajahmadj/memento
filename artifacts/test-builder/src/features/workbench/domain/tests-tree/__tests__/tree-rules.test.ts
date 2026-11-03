/**
 * Unit tests for the pure tests-tree rules.
 *
 * Exercises the transforms (`formatTotals`, `collectMethodIds`,
 * `totalsFromMethods`, `sumTotals`, `tristateFor`, `filterFile`,
 * `filterFolder`) without a render pass.
 */
import { describe, expect, it } from "vitest";
import type {
  DiscoveredTestFolder,
  TestKind,
} from "@workspace/api-client-react";
import {
  collectMethodIds,
  filterFolder,
  formatTotals,
  sumTotals,
  totalsFromMethods,
  tristateFor,
} from "../tree-rules";

const tree: DiscoveredTestFolder = {
  type: "folder",
  name: "root",
  path: ".",
  totals: { e2e: 2, unit: 1, api: 1, all: 4 },
  children: [
    {
      type: "folder",
      name: "e2e",
      path: "e2e",
      totals: { e2e: 2, unit: 0, api: 0, all: 2 },
      children: [
        {
          type: "file",
          name: "LoginSuite.cs",
          path: "e2e/LoginSuite.cs",
          language: "csharp",
          totals: { e2e: 2, unit: 0, api: 0, all: 2 },
          methods: [
            {
              type: "method",
              id: "m::happy",
              name: "HappyPath",
              kind: "e2e",
              language: "csharp",
            },
            {
              type: "method",
              id: "m::sad",
              name: "SadPath",
              kind: "e2e",
              language: "csharp",
            },
          ],
        },
      ],
    },
    {
      type: "folder",
      name: "unit",
      path: "unit",
      totals: { e2e: 0, unit: 1, api: 1, all: 2 },
      children: [
        {
          type: "file",
          name: "MathTests.cs",
          path: "unit/MathTests.cs",
          language: "csharp",
          totals: { e2e: 0, unit: 1, api: 0, all: 1 },
          methods: [
            {
              type: "method",
              id: "m::math",
              name: "AddsTwoNumbers",
              kind: "unit",
              language: "csharp",
            },
          ],
        },
        {
          type: "file",
          name: "ApiTests.cs",
          path: "unit/ApiTests.cs",
          language: "csharp",
          totals: { e2e: 0, unit: 0, api: 1, all: 1 },
          methods: [
            {
              type: "method",
              id: "m::api",
              name: "Ping",
              kind: "api",
              language: "csharp",
            },
          ],
        },
      ],
    },
  ],
};

const allKinds = new Set<TestKind>(["e2e", "unit", "api"]);

describe("formatTotals", () => {
  it("joins non-zero buckets with the kind labels", () => {
    expect(formatTotals({ e2e: 2, unit: 1, api: 1, all: 4 })).toBe(
      "2 E2E · 1 Unit · 1 API",
    );
  });

  it("omits zero buckets", () => {
    expect(formatTotals({ e2e: 0, unit: 3, api: 0, all: 3 })).toBe("3 Unit");
  });

  it("falls back to a generic phrase when everything is zero", () => {
    expect(formatTotals({ e2e: 0, unit: 0, api: 0, all: 0 })).toBe("0 tests");
  });
});

describe("collectMethodIds", () => {
  it("collects every method id under a folder, in tree order", () => {
    expect(collectMethodIds(tree)).toEqual([
      "m::happy",
      "m::sad",
      "m::math",
      "m::api",
    ]);
  });
});

describe("totalsFromMethods + sumTotals", () => {
  it("counts each kind", () => {
    expect(
      totalsFromMethods([
        { type: "method", id: "a", name: "A", kind: "e2e", language: "csharp" },
        { type: "method", id: "b", name: "B", kind: "unit", language: "csharp" },
        { type: "method", id: "c", name: "C", kind: "api", language: "csharp" },
      ]),
    ).toEqual({ e2e: 1, unit: 1, api: 1, all: 3 });
  });

  it("sums totals across siblings", () => {
    expect(
      sumTotals([
        { e2e: 1, unit: 0, api: 0, all: 1 },
        { e2e: 0, unit: 2, api: 1, all: 3 },
      ]),
    ).toEqual({ e2e: 1, unit: 2, api: 1, all: 4 });
  });
});

describe("tristateFor", () => {
  it("returns false when nothing is selected", () => {
    expect(tristateFor(["a", "b"], new Set())).toBe(false);
  });

  it("returns true when every id is selected", () => {
    expect(tristateFor(["a", "b"], new Set(["a", "b"]))).toBe(true);
  });

  it("returns 'indeterminate' when only some ids are selected", () => {
    expect(tristateFor(["a", "b"], new Set(["a"]))).toBe("indeterminate");
  });

  it("returns false for an empty subtree (no descendants to check)", () => {
    expect(tristateFor([], new Set(["a"]))).toBe(false);
  });
});

describe("filterFolder", () => {
  it("returns the input unchanged when there are no filters", () => {
    const out = filterFolder(tree, "", allKinds, false);
    expect(out).not.toBeNull();
    expect(collectMethodIds(out!)).toHaveLength(4);
  });

  it("name search prunes non-matching siblings (case-insensitive)", () => {
    const out = filterFolder(tree, "happy", allKinds, false);
    expect(out).not.toBeNull();
    expect(collectMethodIds(out!)).toEqual(["m::happy"]);
  });

  it("kind filter restricts to the chosen kinds", () => {
    const out = filterFolder(tree, "", new Set<TestKind>(["e2e"]), false);
    expect(out).not.toBeNull();
    expect(collectMethodIds(out!).sort()).toEqual(
      ["m::happy", "m::sad"].sort(),
    );
  });

  it("returns null when nothing matches", () => {
    expect(filterFolder(tree, "no-such-name", allKinds, false)).toBeNull();
  });

  it("keeps descendants when an ancestor folder name itself matches", () => {
    // "unit" matches the folder name — every method in it survives,
    // regardless of the method's own name.
    const out = filterFolder(tree, "unit", allKinds, false);
    expect(out).not.toBeNull();
    expect(collectMethodIds(out!).sort()).toEqual(
      ["m::math", "m::api"].sort(),
    );
  });

  it("recomputes folder totals on the pruned subtree", () => {
    const out = filterFolder(tree, "happy", allKinds, false);
    expect(out!.totals).toEqual({ e2e: 1, unit: 0, api: 0, all: 1 });
  });
});
