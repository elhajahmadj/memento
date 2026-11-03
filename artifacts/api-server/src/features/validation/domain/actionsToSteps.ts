import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";
import type { ValidationStep } from "./validationStep";

/**
 * Pure conversion of a recorded action list into the validation step
 * plan that the runner executes. All filtering rules around deleted
 * actions, selector-less asserts, route-mocks, and wait kinds live
 * here so they are unit-testable in isolation.
 */
export function actionsToSteps(actions: RecordedAction[]): ValidationStep[] {
  const steps: ValidationStep[] = [];
  // Initial navigation to startUrl is the first step.
  steps.push({
    index: 0,
    type: "navigate",
    selector: null,
    selectorStrategy: null,
    value: null,
    status: "pending",
    durationMs: null,
    error: null,
  });
  let i = 1;
  for (const a of actions) {
    if (a.deleted) continue;
    // Recorded `navigate` actions are kept and replayed as page.goto so
    // recordings that depend on intermediate route transitions or
    // explicit URL changes are faithfully reproduced. They have no
    // selector; the URL is carried in `value`.
    if (a.type === "navigate") {
      const url = typeof a.url === "string" ? a.url : null;
      if (!url) continue;
      steps.push({
        index: i++,
        type: "navigate",
        selector: null,
        selectorStrategy: null,
        value: url,
        status: "pending",
        durationMs: null,
        error: null,
        assertKind: null,
      });
      continue;
    }
    // wait steps are kept and replayed natively by the per-kind switch
    // in the run loop. They never have a selector for selector-strategy
    // dispatch (the locator is built from `waitSelector` instead) so the
    // common-path `if (!a.selector) continue;` guard would drop them.
    if (a.type === "wait") {
      steps.push({
        index: i++,
        type: "wait",
        selector: null,
        selectorStrategy: null,
        value: null,
        status: "pending",
        durationMs: null,
        error: null,
        assertKind: null,
        waitKind: a.waitKind ?? null,
        waitSelector: a.waitSelector ?? null,
        waitMs: typeof a.waitMs === "number" ? a.waitMs : null,
      });
      continue;
    }
    // assert steps may carry their expected text/url instead of a value;
    // url-based and response-status asserts have no selector.
    // routeMock and apiAssertion never have a selector — they execute
    // against the page's request context instead.
    if (
      a.type !== "assert" &&
      a.type !== "routeMock" &&
      a.type !== "apiAssertion" &&
      !a.selector
    )
      continue;
    if (
      a.type === "assert" &&
      a.assertKind !== "url-contains" &&
      a.assertKind !== "url-equals" &&
      a.assertKind !== "response-status" &&
      !a.selector
    )
      continue;
    let value: string | null = null;
    if (a.type === "assert") {
      if (a.assertKind === "element-has-text") value = a.assertText ?? null;
      else if (a.assertKind === "url-contains" || a.assertKind === "url-equals")
        value = a.assertUrl ?? null;
      else if (a.assertKind === "value-equals") value = a.assertValue ?? null;
      else if (a.assertKind === "api-status") {
        const head = `${a.apiMethod ?? "GET"} ${a.apiUrl ?? ""} -> ${a.apiExpectedStatus ?? 200}`;
        value = a.apiExpectedJson?.trim()
          ? `${head}\n${a.apiExpectedJson}`
          : head;
      } else if (a.assertKind === "accessibility") {
        value = a.axeImpactLevel ?? "serious";
      } else if (a.assertKind === "visual-baseline") {
        value = `${a.visualName ?? "baseline"}|${a.visualThreshold ?? 0.02}`;
      }
    } else if (a.type === "apiAssertion") {
      const head = `${a.apiMethod ?? "GET"} ${a.apiUrl ?? ""} -> ${a.apiExpectedStatus ?? 200}`;
      value = a.apiExpectedJson?.trim()
        ? `${head}\n${a.apiExpectedJson}`
        : head;
    } else if (a.type === "routeMock") {
      // routeMock is replayed as a setup step that installs a
      // page.route() before navigation. We mark it as type=assert so
      // the existing step pipeline treats it uniformly; the runtime
      // arm reads `assertKind === "route-mock"` to apply it.
      value = JSON.stringify({
        urlPattern: a.apiUrl ?? "",
        method: a.apiMethod ?? "GET",
        status: a.mockStatus ?? 200,
        body: a.mockBody ?? "",
      });
    } else {
      value = typeof a.value === "string" ? a.value : null;
    }
    const assertKindResolved =
      a.type === "assert"
        ? (a.assertKind ?? null)
        : a.type === "apiAssertion"
          ? "api-status"
          : a.type === "routeMock"
            ? "route-mock"
            : null;
    // Both routeMock and apiAssertion are rendered to the dashboard as
    // assert-shaped steps (their replay logic short-circuits the
    // selector branch in `executeRun`).
    const stepType: ValidationStep["type"] =
      a.type === "apiAssertion" || a.type === "routeMock" ? "assert" : a.type;
    steps.push({
      index: i++,
      type: stepType,
      selector: a.selector ?? null,
      selectorStrategy: a.selectorStrategy ?? null,
      value,
      status: "pending",
      durationMs: null,
      error: null,
      assertKind: assertKindResolved as ValidationStep["assertKind"],
      assertCount:
        a.type === "assert" && typeof a.assertCount === "number"
          ? a.assertCount
          : null,
      assertAttribute:
        a.type === "assert" && typeof a.assertAttribute === "string"
          ? a.assertAttribute
          : null,
      assertAttrValue:
        a.type === "assert" && typeof a.assertAttrValue === "string"
          ? a.assertAttrValue
          : null,
      assertValue:
        a.type === "assert" && typeof a.assertValue === "string"
          ? a.assertValue
          : null,
      assertStatusCode:
        a.type === "assert" && typeof a.assertStatusCode === "number"
          ? a.assertStatusCode
          : null,
    });
  }
  return steps;
}
