import { describe, expect, it } from "vitest";
import { validateMockDraft, type MockDraft } from "../mock-rules";

function draft(overrides: Partial<MockDraft> = {}): MockDraft {
  return {
    name: "stub",
    method: "GET",
    urlPattern: "**/api/users/me",
    status: "200",
    bodyJson: "",
    enabled: true,
    ...overrides,
  };
}

describe("validateMockDraft", () => {
  it("accepts a valid draft with empty body", () => {
    const r = validateMockDraft(draft());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        name: "stub",
        method: "GET",
        urlPattern: "**/api/users/me",
        status: 200,
        bodyJson: null,
        enabled: true,
      });
    }
  });

  it("trims name and URL", () => {
    const r = validateMockDraft(draft({ name: "  a  ", urlPattern: "  /x  " }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("a");
      expect(r.value.urlPattern).toBe("/x");
    }
  });

  it("rejects empty name", () => {
    expect(validateMockDraft(draft({ name: "  " }))).toEqual({
      ok: false,
      error: "Name and URL pattern are required",
    });
  });

  it("rejects empty url", () => {
    expect(validateMockDraft(draft({ urlPattern: "" }))).toEqual({
      ok: false,
      error: "Name and URL pattern are required",
    });
  });

  it("rejects out-of-range status", () => {
    expect(validateMockDraft(draft({ status: "99" })).ok).toBe(false);
    expect(validateMockDraft(draft({ status: "600" })).ok).toBe(false);
    expect(validateMockDraft(draft({ status: "abc" })).ok).toBe(false);
    expect(validateMockDraft(draft({ status: "200.5" })).ok).toBe(false);
  });

  it("parses a JSON body", () => {
    const r = validateMockDraft(draft({ bodyJson: '{"id":"u1"}' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.bodyJson).toEqual({ id: "u1" });
  });

  it("rejects invalid JSON body", () => {
    expect(validateMockDraft(draft({ bodyJson: "{bad" }))).toEqual({
      ok: false,
      error: "Body must be valid JSON",
    });
  });
});
