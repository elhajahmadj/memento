import { describe, expect, it } from "vitest";
import {
  renderAssertionLinePython,
  renderRouteMockLinePython,
  renderApiAssertionLinePython,
} from "@/features/codegen/infrastructure/pythonCodegen";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

describe("Python codegen — Tier 3 actions", () => {
  it("renders routeMock as page.route(...) lambda fulfill(...)", () => {
    const line = renderRouteMockLinePython({
      type: "routeMock",
      apiUrl: "**/api/users/me",
      apiMethod: "GET",
      mockStatus: 200,
      mockBody: '{"id":"u1"}',
    });
    expect(line).toContain('page.route("**/api/users/me"');
    expect(line).toContain("lambda route: route.fulfill(");
    expect(line).toContain("status=200");
    expect(line).toContain('content_type="application/json"');
  });

  it("renders apiAssertion via page.request.<method>(url)", () => {
    const line = renderApiAssertionLinePython({
      type: "apiAssertion",
      apiMethod: "DELETE",
      apiUrl: "https://api.example.com/u/1",
      apiExpectedStatus: 204,
    });
    expect(line).toContain("api_resp = page.request.delete(");
    expect(line).toContain("assert api_resp.status == 204");
  });

  it("renders accessibility assertion with axe-playwright-python", () => {
    const a: RecordedAction = {
      type: "assert",
      assertKind: "accessibility",
      axeImpactLevel: "serious",
    };
    const line = renderAssertionLinePython(a);
    expect(line).toContain("from axe_playwright_python.sync_playwright import Axe");
    expect(line).toContain('axe_allowed = {"serious", "critical"}');
    expect(line).toContain("axe_failing == []");
  });

  it("renders visual-baseline as expect(page).to_have_screenshot(...)", () => {
    const line = renderAssertionLinePython({
      type: "assert",
      assertKind: "visual-baseline",
      visualName: "dash",
      visualThreshold: 0.03,
    });
    expect(line).toBe(
      'expect(page).to_have_screenshot("dash.png", max_diff_pixel_ratio=0.03)',
    );
  });
});
