import { describe, expect, it } from "vitest";
import {
  renderAssertionLine,
  renderRouteMockLine,
  renderApiAssertionLine,
  type RecordedAction,
} from "@/features/codegen/infrastructure/codegen";

describe("C# codegen — Tier 3 actions", () => {
  it("renders routeMock as Page.RouteAsync(...).FulfillAsync(...)", () => {
    const a: RecordedAction = {
      type: "routeMock",
      apiUrl: "**/api/users/me",
      apiMethod: "GET",
      mockStatus: 200,
      mockBody: '{"id":"u1"}',
    };
    expect(renderRouteMockLine(a)).toBe(
      'await Page.RouteAsync("**/api/users/me", route => route.FulfillAsync(new() { Status = 200, ContentType = "application/json", Body = "{\\"id\\":\\"u1\\"}" }));',
    );
  });

  it("renders apiAssertion using Page.APIRequest.<Verb>Async(...)", () => {
    const a: RecordedAction = {
      type: "apiAssertion",
      apiMethod: "GET",
      apiUrl: "https://example.com/api/users/me",
      apiExpectedStatus: 200,
    };
    const line = renderApiAssertionLine(a);
    expect(line).toContain("Page.APIRequest.GetAsync(");
    expect(line).toContain('"https://example.com/api/users/me"');
    expect(line).toContain("Is.EqualTo(200)");
  });

  it("renders accessibility assertion with axe-core impact filter", () => {
    const a: RecordedAction = {
      type: "assert",
      assertKind: "accessibility",
      axeImpactLevel: "serious",
    };
    const line = renderAssertionLine(a);
    expect(line).toContain("Deque.AxeCore.Playwright.AxeBuilder(Page).AnalyzeAsync()");
    expect(line).toContain('"serious"');
    expect(line).toContain('"critical"');
    expect(line).not.toContain('"moderate"');
  });

  it("renders visual-baseline assertion with maxDiffPixelRatio", () => {
    const a: RecordedAction = {
      type: "assert",
      assertKind: "visual-baseline",
      visualName: "home-page",
      visualThreshold: 0.05,
    };
    expect(renderAssertionLine(a)).toBe(
      'await Expect(Page).ToHaveScreenshotAsync("home-page.png", new() { MaxDiffPixelRatio = 0.05f, FullPage = true });',
    );
  });

  it("returns null for malformed routeMock / apiAssertion (missing url)", () => {
    expect(
      renderRouteMockLine({ type: "routeMock", apiUrl: "", mockStatus: 200, mockBody: "{}" }),
    ).toBeNull();
    expect(
      renderApiAssertionLine({ type: "apiAssertion", apiUrl: "", apiMethod: "GET" }),
    ).toBeNull();
  });
});
