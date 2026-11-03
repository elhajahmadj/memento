import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  ROLE_PREDICATES,
  normalizeRoleName,
  roleRank,
  roleSatisfies,
  rolesMatching,
} from "../role";
import type { AuthUserRole } from "@workspace/api-client-react";

describe("ALL_ROLES", () => {
  it("is ordered highest-privilege first", () => {
    expect(ALL_ROLES).toEqual([
      "memento_admin",
      "admin",
      "limited_admin",
      "limited",
      "guest",
    ]);
  });
});

describe("roleRank / roleSatisfies", () => {
  it("orders roles from highest to lowest privilege", () => {
    expect(roleRank("memento_admin")).toBeGreaterThan(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("limited_admin"));
    expect(roleRank("limited_admin")).toBeGreaterThan(roleRank("limited"));
    expect(roleRank("limited")).toBeGreaterThan(roleRank("guest"));
    expect(roleRank("guest")).toBeGreaterThan(roleRank(null));
  });

  it("roleSatisfies treats higher ranks as satisfying lower minimums", () => {
    expect(roleSatisfies("memento_admin", "admin")).toBe(true);
    expect(roleSatisfies("admin", "admin")).toBe(true);
    expect(roleSatisfies("limited_admin", "admin")).toBe(false);
    expect(roleSatisfies("limited", "limited_admin")).toBe(false);
    expect(roleSatisfies(null, "limited")).toBe(false);
  });
});

describe("ROLE_PREDICATES", () => {
  const cases: Array<[AuthUserRole | null, Record<keyof typeof ROLE_PREDICATES, boolean>]> = [
    ["memento_admin", { any: true, admin: true, anyAdmin: true, limitedAdmin: false, mementoAdmin: true, limitedUser: false, guest: false, nonGuest: true }],
    ["admin", { any: true, admin: true, anyAdmin: true, limitedAdmin: false, mementoAdmin: false, limitedUser: false, guest: false, nonGuest: true }],
    ["limited_admin", { any: true, admin: false, anyAdmin: true, limitedAdmin: true, mementoAdmin: false, limitedUser: false, guest: false, nonGuest: true }],
    ["limited", { any: true, admin: false, anyAdmin: false, limitedAdmin: false, mementoAdmin: false, limitedUser: true, guest: false, nonGuest: true }],
    // A guest must fail every capability predicate — including
    // `limitedUser`, so a guest can never slip through a User-only gate.
    ["guest", { any: true, admin: false, anyAdmin: false, limitedAdmin: false, mementoAdmin: false, limitedUser: false, guest: true, nonGuest: false }],
    [null, { any: false, admin: false, anyAdmin: false, limitedAdmin: false, mementoAdmin: false, limitedUser: false, guest: false, nonGuest: false }],
  ];

  for (const [role, expected] of cases) {
    it(`evaluates predicates correctly for role=${String(role)}`, () => {
      for (const key of Object.keys(expected) as Array<keyof typeof ROLE_PREDICATES>) {
        expect(ROLE_PREDICATES[key](role)).toBe(expected[key]);
      }
    });
  }
});

describe("rolesMatching", () => {
  it("returns the concrete roles that satisfy a predicate", () => {
    expect(rolesMatching(ROLE_PREDICATES.any)).toEqual([
      "memento_admin",
      "admin",
      "limited_admin",
      "limited",
      "guest",
    ]);
    expect(rolesMatching(ROLE_PREDICATES.nonGuest)).toEqual([
      "memento_admin",
      "admin",
      "limited_admin",
      "limited",
    ]);
    expect(rolesMatching(ROLE_PREDICATES.guest)).toEqual(["guest"]);
    expect(rolesMatching(ROLE_PREDICATES.anyAdmin)).toEqual([
      "memento_admin",
      "admin",
      "limited_admin",
    ]);
    expect(rolesMatching(ROLE_PREDICATES.admin)).toEqual([
      "memento_admin",
      "admin",
    ]);
    expect(rolesMatching(ROLE_PREDICATES.limitedUser)).toEqual(["limited"]);
  });
});

describe("normalizeRoleName", () => {
  it("accepts canonical ids", () => {
    expect(normalizeRoleName("memento_admin")).toBe("memento_admin");
    expect(normalizeRoleName("admin")).toBe("admin");
    expect(normalizeRoleName("limited_admin")).toBe("limited_admin");
    expect(normalizeRoleName("limited")).toBe("limited");
  });

  it("accepts display names case- and whitespace-insensitively", () => {
    expect(normalizeRoleName("Memento Admin")).toBe("memento_admin");
    expect(normalizeRoleName("  MEMENTO   ADMIN ")).toBe("memento_admin");
    expect(normalizeRoleName("Limited Admin")).toBe("limited_admin");
    expect(normalizeRoleName("User")).toBe("limited");
    expect(normalizeRoleName("limited-user")).toBe("limited");
  });

  it("returns null for unknown / empty values", () => {
    expect(normalizeRoleName(null)).toBeNull();
    expect(normalizeRoleName(undefined)).toBeNull();
    expect(normalizeRoleName("")).toBeNull();
    expect(normalizeRoleName("superuser")).toBeNull();
  });

  it("never resolves to guest — it is not IDP- or admin-assignable", () => {
    // `guest` is minted only by POST /auth/guest. If an IDP claim or an
    // admin-entered string could normalize to it, someone could be
    // handed a role that bypasses the normal account lifecycle.
    expect(normalizeRoleName("guest")).toBeNull();
    expect(normalizeRoleName("Guest")).toBeNull();
    expect(normalizeRoleName(" GUEST ")).toBeNull();
  });
});
