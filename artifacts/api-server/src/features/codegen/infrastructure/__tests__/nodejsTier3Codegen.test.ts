import { describe, expect, it } from "vitest";
import {
  renderAssertionLineNodejs,
  renderRouteMockLineNodejs,
  renderApiAssertionLineNodejs,
} from "@/features/codegen/infrastructure/nodejsCodegen";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

describe("Node.js codegen — Tier 3 actions", () => {
  it("renders routeMock as page.route(...).fulfill(...)", () => {
    const line = renderRouteMockLineNodejs({
      type: "routeMock",
      apiUrl: "**/api/users/me",
      apiMethod: "GET",
      mockStatus: 200,
      mockBody: '{"id":"u1"}',
    });
    expect(line).toBe(
      'await page.route("**/api/users/me", route => route.fulfill({ status: 200, contentType: "application/json", body: "{\\"id\\":\\"u1\\"}" }));',
    );
  });

  it("renders apiAssertion as page.request.<method>(url) + status check", () => {
    const line = renderApiAssertionLineNodejs({
      type: "apiAssertion",
      apiMethod: "POST",
      apiUrl: "https://api.example.com/x",
      apiExpectedStatus: 201,
    });
    expect(line).toContain("page.request.post(");
    expect(line).toContain('"https://api.example.com/x"');
    expect(line).toContain("expect(apiResp.status()).toBe(201);");
  });

  it("renders accessibility assertion with @axe-core/playwright", () => {
    const a: RecordedAction = {
      type: "assert",
      assertKind: "accessibility",
      axeImpactLevel: "critical",
    };
    const line = renderAssertionLineNodejs(a);
    expect(line).toContain('import("@axe-core/playwright")');
    expect(line).toContain('new Set(["critical"])');
    expect(line).toContain("axeFailing");
  });

  it("renders visual-baseline as page.toHaveScreenshot with maxDiffPixelRatio", () => {
    const line = renderAssertionLineNodejs({
      type: "assert",
      assertKind: "visual-baseline",
      visualName: "checkout",
      visualThreshold: 0.1,
    });
    expect(line).toBe(
      'await expect(page).toHaveScreenshot("checkout.png", { maxDiffPixelRatio: 0.1 });',
    );
  });

  it("returns null for non-matching action types", () => {
    expect(
      renderRouteMockLineNodejs({ type: "navigate", url: "x" } as RecordedAction),
    ).toBeNull();
    expect(
      renderApiAssertionLineNodejs({ type: "navigate", url: "x" } as RecordedAction),
    ).toBeNull();
  });
});
