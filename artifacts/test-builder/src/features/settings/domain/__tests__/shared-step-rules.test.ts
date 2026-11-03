import { describe, expect, it } from "vitest";
import { parseSharedStepActions } from "../shared-step-rules";

describe("parseSharedStepActions", () => {
  it("parses a non-empty array", () => {
    const r = parseSharedStepActions('[{"type":"click"}]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([{ type: "click" }]);
  });

  it("rejects invalid JSON", () => {
    expect(parseSharedStepActions("{not json")).toEqual({
      ok: false,
      error: "Actions JSON is not valid JSON.",
    });
  });

  it("rejects an empty array", () => {
    expect(parseSharedStepActions("[]")).toEqual({
      ok: false,
      error: "Actions must be a non-empty JSON array.",
    });
  });

  it("rejects a non-array value", () => {
    expect(parseSharedStepActions('{"type":"click"}')).toEqual({
      ok: false,
      error: "Actions must be a non-empty JSON array.",
    });
  });
});
