import { describe, expect, it } from "vitest";
import {
  renderAssertionLineJava,
  renderRouteMockLineJava,
  renderApiAssertionLineJava,
} from "@/features/codegen/infrastructure/javaCodegen";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

describe("Java codegen — Tier 3 actions", () => {
  it("renders routeMock as page.route(...).fulfill(Route.FulfillOptions)", () => {
    const line = renderRouteMockLineJava({
      type: "routeMock",
      apiUrl: "**/api/users/me",
      apiMethod: "GET",
      mockStatus: 200,
      mockBody: '{"id":"u1"}',
    });
    expect(line).toContain('page.route("**/api/users/me"');
    expect(line).toContain("Route.FulfillOptions()");
    expect(line).toContain("setStatus(200)");
    expect(line).toContain('setContentType("application/json")');
  });

  it("renders apiAssertion via page.request().<method>()", () => {
    const line = renderApiAssertionLineJava({
      type: "apiAssertion",
      apiMethod: "PUT",
      apiUrl: "https://api.example.com/u/1",
      apiExpectedStatus: 204,
    });
    expect(line).toContain("APIResponse apiResp = page.request().put(");
    expect(line).toContain("Assertions.assertEquals(204, apiResp.status());");
  });

  it("renders accessibility assertion with axe-core java bindings", () => {
    const a: RecordedAction = {
      type: "assert",
      assertKind: "accessibility",
      axeImpactLevel: "moderate",
    };
    const line = renderAssertionLineJava(a);
    expect(line).toContain("com.deque.html.axecore.playwright.AxeBuilder(page)");
    expect(line).toContain('"moderate"');
    expect(line).toContain('"serious"');
    expect(line).toContain('"critical"');
  });

  it("renders visual-baseline as assertThat(page).hasScreenshot(...)", () => {
    const line = renderAssertionLineJava({
      type: "assert",
      assertKind: "visual-baseline",
      visualName: "home",
      visualThreshold: 0.02,
    });
    expect(line).toBe(
      'assertThat(page).hasScreenshot("home.png", new PageAssertions.HasScreenshotOptions().setMaxDiffPixelRatio(0.02).setFullPage(true));',
    );
  });
});
