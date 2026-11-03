import { describe, it, expect } from "vitest";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";
import { actionsToSteps } from "../actionsToSteps";

function click(over: Partial<RecordedAction> = {}): RecordedAction {
  return {
    type: "click",
    selector: "#go",
    selectorStrategy: "css",
    ...over,
  } as RecordedAction;
}

describe("actionsToSteps", () => {
  it("always emits an initial navigate step at index 0", () => {
    const steps = actionsToSteps([]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.type).toBe("navigate");
    expect(steps[0]!.index).toBe(0);
    expect(steps[0]!.status).toBe("pending");
    expect(steps[0]!.value).toBeNull();
  });

  it("skips deleted actions entirely", () => {
    const steps = actionsToSteps([
      click({ deleted: true } as Partial<RecordedAction>),
      click({ selector: "#keep" }),
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[1]!.selector).toBe("#keep");
  });

  it("drops non-assert/non-routeMock/non-apiAssertion actions without a selector", () => {
    const steps = actionsToSteps([
      click({ selector: undefined } as unknown as Partial<RecordedAction>),
      click({ selector: "#ok" }),
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[1]!.selector).toBe("#ok");
  });

  it("drops navigate actions without a url and preserves valid ones", () => {
    const steps = actionsToSteps([
      { type: "navigate" } as RecordedAction,
      { type: "navigate", url: "https://example.com/next" } as RecordedAction,
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[1]!.type).toBe("navigate");
    expect(steps[1]!.value).toBe("https://example.com/next");
  });

  it("represents wait[selector|timeout|networkidle] steps natively", () => {
    const steps = actionsToSteps([
      { type: "wait", waitKind: "selector", waitSelector: "#ready" } as RecordedAction,
      { type: "wait", waitKind: "timeout", waitMs: 750 } as RecordedAction,
      { type: "wait", waitKind: "networkidle" } as RecordedAction,
    ]);
    expect(steps.slice(1).map((s) => s.waitKind)).toEqual([
      "selector",
      "timeout",
      "networkidle",
    ]);
    expect(steps[1]!.waitSelector).toBe("#ready");
    expect(steps[2]!.waitMs).toBe(750);
  });

  it("encodes routeMock and apiAssertion as synthetic assert steps", () => {
    const steps = actionsToSteps([
      {
        type: "routeMock",
        apiUrl: "**/api/x",
        apiMethod: "POST",
        mockStatus: 201,
        mockBody: "{}",
      } as RecordedAction,
      {
        type: "apiAssertion",
        apiMethod: "GET",
        apiUrl: "/api/health",
        apiExpectedStatus: 200,
      } as RecordedAction,
    ]);
    expect(steps[1]!.type).toBe("assert");
    expect(steps[1]!.assertKind).toBe("route-mock");
    expect(JSON.parse(steps[1]!.value ?? "{}")).toMatchObject({
      urlPattern: "**/api/x",
      method: "POST",
      status: 201,
    });
    expect(steps[2]!.assertKind).toBe("api-status");
    expect(steps[2]!.value).toBe("GET /api/health -> 200");
  });

  it("drops selector-less asserts unless they are url/response-status", () => {
    const steps = actionsToSteps([
      { type: "assert", assertKind: "element-visible" } as RecordedAction,
      {
        type: "assert",
        assertKind: "url-contains",
        assertUrl: "/dash",
      } as RecordedAction,
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[1]!.assertKind).toBe("url-contains");
    expect(steps[1]!.value).toBe("/dash");
  });
});
