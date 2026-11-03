import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOCS_MATRIX,
  DOCS_SECTION_IDS,
  ROUTES_WITHOUT_DOCS,
  entriesForRole,
  getMatrixEntry,
  groupByCategory,
  permissionsNote,
  screenshotKey,
  screenshotSrc,
} from "../matrix";

const here = dirname(fileURLToPath(import.meta.url));
const APP_TSX = resolve(here, "..", "..", "..", "App.tsx");

/** Pull every `<Route path="..." />` literal out of App.tsx. */
function readAppRoutes(): string[] {
  const src = readFileSync(APP_TSX, "utf8");
  const routes = new Set<string>();
  // Match: <Route path="/foo" ... /> — handles single and double quotes.
  const re = /<Route\s+path=["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    routes.add(m[1]!);
  }
  return [...routes];
}

describe("docs matrix module", () => {
  it("has unique sectionIds", () => {
    const ids = DOCS_MATRIX.map((e) => e.sectionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("DOCS_SECTION_IDS mirrors DOCS_MATRIX", () => {
    expect(DOCS_SECTION_IDS).toEqual(DOCS_MATRIX.map((e) => e.sectionId));
  });

  it("every entry has a non-empty label and at least one allowed role", () => {
    for (const e of DOCS_MATRIX) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.route.startsWith("/")).toBe(true);
      expect(e.allowedRoles.length).toBeGreaterThan(0);
    }
  });

  it("getMatrixEntry round-trips by sectionId", () => {
    for (const e of DOCS_MATRIX) {
      expect(getMatrixEntry(e.sectionId)?.sectionId).toBe(e.sectionId);
    }
    expect(getMatrixEntry("nope")).toBeUndefined();
  });
});

describe("entriesForRole", () => {
  it("returns no entries when signed out", () => {
    expect(entriesForRole(null)).toEqual([]);
  });

  it("admin sees every section that allows admin", () => {
    const got = entriesForRole("admin").map((e) => e.sectionId);
    const expected = DOCS_MATRIX.filter((e) =>
      e.allowedRoles.includes("admin"),
    ).map((e) => e.sectionId);
    expect(got).toEqual(expected);
  });

  it("limited_admin doesn't see admin-only Admin/Tools entries", () => {
    const got = entriesForRole("limited_admin").map((e) => e.sectionId);
    expect(got).not.toContain("admin-project-assignments");
    expect(got).not.toContain("admin-git-repos");
    expect(got).not.toContain("tools-validation-traces");
    expect(got).not.toContain("tools-internal-tests");
    expect(got).toContain("admin-approval");
    expect(got).toContain("admin-users");
  });

  it("limited (User) sees Workspace + Settings appearance + Account + About + my-approvals only", () => {
    const got = entriesForRole("limited").map((e) => e.sectionId);
    expect(got).toEqual([
      "landing",
      "dashboard",
      "home",
      "workbench",
      "workbench-generate-pipeline-file",
      "workbench-edit-steps",
      "workbench-assertions",
      "workbench-run-all",
      "workbench-api-checks",
      "workbench-api-solutions",
      "workbench-accessibility",
      "workbench-visual-baseline",
      "workbench-open-browser",
      "workbench-keep-browser-open",
      "workbench-fix-broken-step",
      "workbench-branches",
      // Note: workbench-api-build-test-{python,nodejs,java} and
      // home-new-project-api-language are ADMIN_ONLY — the limited
      // (User) role does not see them.
      "onboarding-tour",
      // Appearance is the only Settings panel exposed to every role
      // after the Settings/Admin/Tools re-org.
      "settings-appearance",
      "my-approvals",
      "profile",
      "about",
    ]);
  });
});

describe("groupByCategory", () => {
  it("emits non-empty groups in canonical order", () => {
    const grouped = groupByCategory(entriesForRole("admin"));
    expect(grouped.map((g) => g.category)).toEqual([
      "Workspace",
      "Admin",
      "Settings",
      "Tools",
      "Account",
      "About",
    ]);
    for (const g of grouped) expect(g.entries.length).toBeGreaterThan(0);
  });

  it("hides categories with no visible entries for the role", () => {
    const grouped = groupByCategory(entriesForRole("limited"));
    // limited has no Admin or Tools entries; Settings is reachable
    // for the all-roles Appearance panel only.
    expect(grouped.map((g) => g.category)).not.toContain("Admin");
    expect(grouped.map((g) => g.category)).not.toContain("Tools");
    expect(grouped.map((g) => g.category)).toContain("Settings");
  });
});

describe("permissionsNote", () => {
  it("collapses 'every role' to a single sentence", () => {
    const e = getMatrixEntry("home")!;
    expect(permissionsNote(e)).toMatch(/every signed-in role/i);
  });

  it("uses 'and' for ADMIN_ONLY (Memento Admin + Admin) entries", () => {
    const e = getMatrixEntry("settings-architectures")!;
    expect(permissionsNote(e)).toBe("Visible to Memento Admin and Admin.");
  });

  it("joins multiple admin roles with 'and'", () => {
    const e = getMatrixEntry("admin-approval")!;
    expect(permissionsNote(e)).toBe(
      "Visible to Memento Admin, Admin and Limited Admin.",
    );
  });

  it("labels the limited role as 'User'", () => {
    const e = getMatrixEntry("my-approvals")!;
    expect(permissionsNote(e)).toBe("Visible to User only.");
  });
});

describe("screenshot helpers", () => {
  it("screenshotKey defaults to sectionId", () => {
    for (const e of DOCS_MATRIX) {
      expect(screenshotKey(e)).toBe(e.screenshotKey ?? e.sectionId);
    }
  });

  it("screenshotSrc returns null for signed-out viewers", () => {
    expect(screenshotSrc(DOCS_MATRIX[0]!, null)).toBeNull();
  });

  it("screenshotSrc returns an absolute path so deep-link routes still resolve", () => {
    const e = getMatrixEntry("home")!;
    expect(screenshotSrc(e, "admin")).toBe("/images/docs/admin/home.jpg");
    expect(screenshotSrc(e, "limited")).toBe("/images/docs/limited/home.jpg");
  });

  it("screenshotSrc respects a non-root basePath (vite's BASE_URL)", () => {
    const e = getMatrixEntry("home")!;
    expect(screenshotSrc(e, "admin", "/test-builder/")).toBe(
      "/test-builder/images/docs/admin/home.jpg",
    );
    // Trailing slash should not matter — both forms produce the same URL.
    expect(screenshotSrc(e, "admin", "/test-builder")).toBe(
      "/test-builder/images/docs/admin/home.jpg",
    );
  });
});

describe("workbench sub-section screenshots are section-specific", () => {
  // Task #49: confirm the three new workbench sub-sections render
  // their OWN section-specific JPEG (not a fallback to workbench.jpg)
  // for every role that can reach them.
  const NEW_SECTIONS = [
    "workbench-edit-steps",
    "workbench-assertions",
    "workbench-run-all",
  ] as const;
  const PUBLIC_DOCS = resolve(
    here,
    "..",
    "..",
    "..",
    "..",
    "public",
    "images",
    "docs",
  );

  it.each(NEW_SECTIONS)(
    "%s resolves to its own screenshot key (not 'workbench')",
    (sectionId) => {
      const e = getMatrixEntry(sectionId)!;
      expect(e, `matrix entry for ${sectionId} is missing`).toBeDefined();
      // No explicit override that would silently fall back to the
      // shared workbench shot.
      expect(e.screenshotKey).toBeUndefined();
      expect(screenshotKey(e)).toBe(sectionId);
      for (const role of e.allowedRoles) {
        expect(screenshotSrc(e, role)).toBe(
          `/images/docs/${role}/${sectionId}.jpg`,
        );
      }
    },
  );

  it.each(NEW_SECTIONS)(
    "%s has a unique on-disk JPEG for every allowed role",
    (sectionId) => {
      const e = getMatrixEntry(sectionId)!;
      for (const role of e.allowedRoles) {
        const own = resolve(PUBLIC_DOCS, role, `${sectionId}.jpg`);
        const fallback = resolve(PUBLIC_DOCS, role, "workbench.jpg");
        expect(existsSync(own), `missing ${own}`).toBe(true);
        expect(existsSync(fallback)).toBe(true);
        // The section-specific image must not be a copy of the
        // shared workbench shot (different size = different bytes).
        expect(statSync(own).size).not.toBe(statSync(fallback).size);
      }
    },
  );
});

describe("workbench-keep-browser-open has two screenshots per role", () => {
  // Task #123: the Keep-browser-open doc section ships with two
  // dedicated screenshots — the Start Recording dialog scrolled to
  // the new checkbox, and the same dialog re-opened in attach mode.
  // Both must exist on disk for every role allowed to see the
  // section so the in-app docs page renders without 404s.
  const PUBLIC_DOCS = resolve(
    here,
    "..",
    "..",
    "..",
    "..",
    "public",
    "images",
    "docs",
  );
  const entry = getMatrixEntry("workbench-keep-browser-open")!;

  it("declares an additional screenshot key for the attach-mode shot", () => {
    expect(entry).toBeDefined();
    expect(entry.screenshotKey).toBeUndefined();
    expect(screenshotKey(entry)).toBe("workbench-keep-browser-open");
    expect(entry.additionalScreenshotKeys).toEqual([
      "workbench-keep-browser-open-attach",
    ]);
  });

  it("ships both JPEGs on disk for every allowed role", () => {
    for (const role of entry.allowedRoles) {
      const main = resolve(
        PUBLIC_DOCS,
        role,
        "workbench-keep-browser-open.jpg",
      );
      const attach = resolve(
        PUBLIC_DOCS,
        role,
        "workbench-keep-browser-open-attach.jpg",
      );
      expect(existsSync(main), `missing ${main}`).toBe(true);
      expect(existsSync(attach), `missing ${attach}`).toBe(true);
    }
  });
});

describe("App.tsx ↔ matrix consistency", () => {
  it("every matrix route exists in App.tsx", () => {
    const appRoutes = new Set(readAppRoutes());
    for (const e of DOCS_MATRIX) {
      expect(
        appRoutes.has(e.route),
        `Matrix entry "${e.sectionId}" points at "${e.route}" which is not in App.tsx`,
      ).toBe(true);
    }
  });

  it("every gated app route is covered by at least one matrix entry (or whitelisted)", () => {
    const appRoutes = readAppRoutes();
    const matrixRoutes = new Set(DOCS_MATRIX.map((e) => e.route));
    for (const route of appRoutes) {
      // Skip wouter parameter routes — they're alternates of the
      // base, not new "user-facing pages".
      if (route.includes(":")) continue;
      if (ROUTES_WITHOUT_DOCS.has(route)) continue;
      expect(
        matrixRoutes.has(route),
        `App.tsx route "${route}" has no documentation matrix entry — add one to src/lib/docs/matrix.ts (or whitelist in ROUTES_WITHOUT_DOCS).`,
      ).toBe(true);
    }
  });

  it("every whitelisted route really exists in App.tsx", () => {
    const appRoutes = new Set(readAppRoutes());
    for (const route of ROUTES_WITHOUT_DOCS) {
      expect(
        appRoutes.has(route),
        `ROUTES_WITHOUT_DOCS lists "${route}" but App.tsx no longer has that route — clean up the whitelist.`,
      ).toBe(true);
    }
  });
});
