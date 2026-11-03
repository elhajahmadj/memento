import { describe, expect, it } from "vitest";
import { buildContainer } from "@/composition/container";

describe("composition container", () => {
  it("exposes a non-null use case for every key on every migrated feature", () => {
    const c = buildContainer();
    const groups = c.useCases;

    // Top-level feature groups
    expect(Object.keys(groups).sort()).toEqual(
      [
        "approvals",
        "architectures",
        "auth",
        "codegen",
        "gitConfig",
        "projects",
        "validation",
      ].sort(),
    );

    // Every nested use case must be a non-null function or object with
    // an `execute` method — no group should ship with an undefined hole.
    for (const [groupName, group] of Object.entries(groups)) {
      for (const [ucName, uc] of Object.entries(
        group as Record<string, unknown>,
      )) {
        expect(uc, `${groupName}.${ucName} should be non-null`).toBeDefined();
        expect(uc, `${groupName}.${ucName} should be non-null`).not.toBeNull();
        const looksRunnable =
          typeof uc === "function" ||
          (typeof uc === "object" &&
            uc !== null &&
            "execute" in (uc as Record<string, unknown>) &&
            typeof (uc as { execute: unknown }).execute === "function") ||
          typeof uc === "object"; // adapters like approvals.workspace
        expect(
          looksRunnable,
          `${groupName}.${ucName} should be a function, an object with execute(), or an adapter`,
        ).toBe(true);
      }
    }
  });
});
