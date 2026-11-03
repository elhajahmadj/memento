import { describe, it, expect } from "vitest";
import {
  mapRoleString,
  pickRoleFromClaims,
  normalizeClaims,
} from "../claims";

describe("mapRoleString", () => {
  it("recognizes the four canonical Nexus role names case-insensitively", () => {
    expect(mapRoleString("Memento Admin")).toBe("memento_admin");
    expect(mapRoleString("memento admin")).toBe("memento_admin");
    expect(mapRoleString("Admin")).toBe("admin");
    expect(mapRoleString("LIMITED ADMIN")).toBe("limited_admin");
    expect(mapRoleString("  limited  admin ")).toBe("limited_admin");
    expect(mapRoleString("User")).toBe("limited");
  });

  it("returns null for unknown / non-string values", () => {
    expect(mapRoleString("Owner")).toBeNull();
    expect(mapRoleString("")).toBeNull();
    expect(mapRoleString(null)).toBeNull();
    expect(mapRoleString(42)).toBeNull();
  });
});

describe("pickRoleFromClaims", () => {
  it("picks the highest-privilege role across an array", () => {
    expect(
      pickRoleFromClaims({ roles: ["User", "Admin", "Limited Admin"] }, "roles"),
    ).toBe("admin");
  });

  it("accepts a single string", () => {
    expect(pickRoleFromClaims({ roles: "Memento Admin" }, "roles")).toBe(
      "memento_admin",
    );
  });

  it("defaults to limited when the claim is missing or empty", () => {
    expect(pickRoleFromClaims({}, "roles")).toBe("limited");
    expect(pickRoleFromClaims({ roles: [] }, "roles")).toBe("limited");
    expect(pickRoleFromClaims({ roles: ["unknown-role"] }, "roles")).toBe(
      "limited",
    );
  });
});

describe("normalizeClaims", () => {
  it("reads the user-gate flag from the Nexus namespace when present", () => {
    const out = normalizeClaims(
      {
        sub: "user-1",
        "https://nexus/claims": { mementoUser: true, roles: ["Admin"] },
        organizations: [{ org_id: "acme", org_name: "Acme" }],
      },
      "org",
    );
    expect(out.hasMementoUserClaim).toBe(true);
    expect(out.nexusNamespacePresent).toBe(true);
    expect(out.role).toBe("admin");
    expect(out.orgKeys).toEqual(["acme"]);
    expect(out.orgDisplayNames).toEqual({ acme: "Acme" });
  });

  it("falls back to top-level user-gate when namespace is absent", () => {
    const out = normalizeClaims(
      { sub: "user-2", mementoUser: true, org: "acme" },
      "org",
    );
    expect(out.hasMementoUserClaim).toBe(true);
    expect(out.nexusNamespacePresent).toBe(false);
  });

  it("populates mementoAccessOrgKeys with every organizations[] entry whose gate claim is truthy", () => {
    const granted = normalizeClaims(
      {
        sub: "s",
        organizations: [
          { id: "acme", name: "Acme", mementoAccess: true },
        ],
      },
      "organizations",
    );
    expect(Array.from(granted.mementoAccessOrgKeys)).toEqual(["acme"]);

    const noAccess = normalizeClaims(
      { sub: "s", organizations: [{ id: "acme", name: "Acme" }] },
      "organizations",
    );
    expect(noAccess.mementoAccessOrgKeys.size).toBe(0);

    // Top-level mementoAccess (the old shape) is ignored — the gate
    // only counts when it sits inside an org entry.
    const flatTopLevel = normalizeClaims(
      { sub: "s", mementoAccess: true },
      "organizations",
    );
    expect(flatTopLevel.mementoAccessOrgKeys.size).toBe(0);
  });

  it("filters mementoAccessOrgKeys to just the granting entries in a mixed list", () => {
    const out = normalizeClaims(
      {
        sub: "s",
        organizations: [
          { id: "acme", mementoAccess: true },
          { id: "globex" },
          { id: "initech", mementoAccess: true },
          { id: "umbrella", mementoAccess: false },
        ],
      },
      "organizations",
    );
    expect(out.orgKeys.sort()).toEqual(
      ["acme", "globex", "initech", "umbrella"].sort(),
    );
    expect(Array.from(out.mementoAccessOrgKeys).sort()).toEqual(
      ["acme", "initech"].sort(),
    );
  });

  it("treats the org-gate claim name case-sensitively per entry", () => {
    const out = normalizeClaims(
      {
        sub: "s",
        organizations: [
          { id: "acme", mementoaccess: true },
          { id: "globex", MementoAccess: true },
        ],
      },
      "organizations",
    );
    expect(out.mementoAccessOrgKeys.size).toBe(0);
  });

  it("prefers a top-level recognized role over org-nested roles", () => {
    const out = normalizeClaims(
      {
        sub: "s",
        roles: ["User"],
        organizations: [{ org_id: "acme", roles: ["Admin"] }],
      },
      "org",
    );
    // Explicit top-level `User` wins even though the org has Admin.
    expect(out.role).toBe("limited");
  });

  it("falls back to org-nested roles when top-level has no recognized value", () => {
    const out = normalizeClaims(
      {
        sub: "s",
        roles: ["weirdo"],
        organizations: [{ org_id: "acme", roles: ["Limited Admin"] }],
      },
      "org",
    );
    expect(out.role).toBe("limited_admin");
  });

  it("derives a subject from preferred_username when sub is missing", () => {
    const out = normalizeClaims(
      { preferred_username: "alice@example.com" },
      "org",
    );
    expect(out.subject).toBe("alice@example.com");
  });

  it("downgrades memento_admin to admin when the god-mode triple is incomplete", () => {
    const out = normalizeClaims(
      {
        sub: "user-1",
        "https://nexus/claims": {
          mementoUser: true,
          mementoAccess: true,
          mementoGodMode: "mementoAdmin",
          // Tier claim missing — triple is incomplete.
          roles: ["Memento Admin"],
        },
        organizations: [{ id: "acme", mementoAccess: true }],
      },
      "organizations",
    );
    expect(out.isGodmode).toBe(false);
    expect(out.role).toBe("admin");
  });

  it("promotes to memento_admin when the full god-mode triple is present", () => {
    const out = normalizeClaims(
      {
        sub: "user-1",
        "https://nexus/claims": {
          mementoUser: true,
          mementoAccess: true,
          mementoGodMode: "mementoAdmin",
          "NexusTier reserved": "NexusAdmin",
          roles: ["Admin"],
        },
        organizations: [{ id: "acme", mementoAccess: true }],
      },
      "organizations",
    );
    expect(out.isGodmode).toBe(true);
    expect(out.role).toBe("memento_admin");
  });

  it("triple is case-sensitive on role and tier values", () => {
    const out = normalizeClaims(
      {
        sub: "user-1",
        "https://nexus/claims": {
          mementoUser: true,
          mementoAccess: true,
          mementoGodMode: "MementoAdmin", // wrong case
          "NexusTier reserved": "NexusAdmin",
          roles: ["Memento Admin"],
        },
        organizations: [{ id: "acme", mementoAccess: true }],
      },
      "organizations",
    );
    expect(out.isGodmode).toBe(false);
    expect(out.role).toBe("admin");
  });

  it("requires the access leg of the triple to be truthy", () => {
    const out = normalizeClaims(
      {
        sub: "user-1",
        "https://nexus/claims": {
          mementoUser: true,
          mementoAccess: false,
          mementoGodMode: "mementoAdmin",
          "NexusTier reserved": "NexusAdmin",
          roles: ["Memento Admin"],
        },
        organizations: [{ id: "acme", mementoAccess: true }],
      },
      "organizations",
    );
    expect(out.isGodmode).toBe(false);
    expect(out.role).toBe("admin");
  });

  it("accepts the god-mode triple at the top level when no namespace is present", () => {
    const out = normalizeClaims(
      {
        sub: "user-1",
        mementoUser: true,
        mementoAccess: true,
        mementoGodMode: "mementoAdmin",
        "NexusTier reserved": "NexusAdmin",
        roles: ["User"],
        org: "acme",
      },
      "org",
    );
    expect(out.isGodmode).toBe(true);
    expect(out.role).toBe("memento_admin");
  });

  it("supports custom claim-name overrides", () => {
    const out = normalizeClaims(
      {
        sub: "s",
        "https://custom/ns": { isMember: true, roles: ["Admin"] },
        organizations: [{ id: "acme", canAccess: true }],
      },
      "organizations",
      "roles",
      {
        userClaimsNamespace: "https://custom/ns",
        mementoUserClaim: "isMember",
        mementoAccessClaim: "canAccess",
      },
    );
    expect(out.hasMementoUserClaim).toBe(true);
    expect(out.role).toBe("admin");
    expect(Array.from(out.mementoAccessOrgKeys)).toEqual(["acme"]);
  });
});
