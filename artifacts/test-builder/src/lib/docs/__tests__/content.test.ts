import { describe, expect, it } from "vitest";
import { DOCS_MATRIX } from "../matrix";
import {
  DOCS_CONTENT,
  combinedSections,
  contentForSection,
} from "../content";

describe("docs content module", () => {
  it("has no duplicate sectionIds (only the first match would ever be shown)", () => {
    const ids = DOCS_CONTENT.map((c) => c.sectionId);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    expect(dupes, `duplicate sectionIds: ${dupes.join(", ")}`).toEqual([]);
  });

  it("has one content entry per matrix entry (no orphans either way)", () => {
    const matrixIds = new Set(DOCS_MATRIX.map((e) => e.sectionId));
    const contentIds = new Set(DOCS_CONTENT.map((c) => c.sectionId));
    expect([...contentIds].sort()).toEqual([...matrixIds].sort());
  });

  it("every section has an intro, walkthrough steps, and at least one field", () => {
    for (const c of DOCS_CONTENT) {
      expect(c.heading.length, c.sectionId).toBeGreaterThan(0);
      expect(c.intro.length, c.sectionId).toBeGreaterThan(40);
      expect(c.walkthrough.length, c.sectionId).toBeGreaterThan(0);
      expect(c.fields.length, c.sectionId).toBeGreaterThan(0);
      for (const f of c.fields) {
        expect(f.name.length, `${c.sectionId}/${f.name}`).toBeGreaterThan(0);
        expect(
          f.description.length,
          `${c.sectionId}/${f.name}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("contentForSection looks up by sectionId", () => {
    for (const c of DOCS_CONTENT) {
      expect(contentForSection(c.sectionId)?.sectionId).toBe(c.sectionId);
    }
    expect(contentForSection("nope")).toBeUndefined();
  });

  it("combinedSections pairs matrix and content for every entry", () => {
    const combined = combinedSections();
    expect(combined.length).toBe(DOCS_MATRIX.length);
    for (const c of combined) {
      expect(c.entry.sectionId).toBe(c.content.sectionId);
    }
  });
});
