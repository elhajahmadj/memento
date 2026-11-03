import type { AiRunStep } from "@/features/ai-agent/domain/types";
import { pascal, safeIdentifier } from "./identifiers";

export interface PageMethodSpec {
  /** Method name (no `Async` suffix; appended by emitter). */
  name: string;
  /** Verb-noun-Async signature, e.g. `ClickLoginButtonAsync()`. */
  signature: string;
  /** Method body (excluding braces), single-line. */
  body: string;
  selectorKey?: string | undefined;
  rawSelector?: string | undefined;
}

export function stepToPageMethod(
  step: AiRunStep,
  call: NonNullable<AiRunStep["playwrightCalls"]>[number],
  suiteStem: string,
): PageMethodSpec | null {
  const safeName = step.method?.name?.trim();
  if (!safeName) return null;

  // page.goto isn't a page-object method — it's invoked directly from
  // the test (using TestConfig.BaseUrl). Skip here.
  if (call.method === "page.goto") return null;

  const verbBase = safeIdentifier(pascal(safeName), "Action");
  const selectorsClass = `${suiteStem}PageSelectors`;
  switch (call.method) {
    case "page.click": {
      const selKey = `${verbBase}Selector`;
      return {
        name: verbBase,
        signature: `${verbBase}Async()`,
        body: `await _page.ClickAsync(${selectorsClass}.${selKey});`,
        selectorKey: selKey,
        rawSelector: call.rawSelector ?? call.selector,
      };
    }
    case "page.fill": {
      const selKey = `${verbBase}Selector`;
      return {
        name: verbBase,
        signature: `${verbBase}Async(string value)`,
        body: `await _page.FillAsync(${selectorsClass}.${selKey}, value);`,
        selectorKey: selKey,
        rawSelector: call.rawSelector ?? call.selector,
      };
    }
    case "expect.toBeVisible": {
      const selKey = `${verbBase}Selector`;
      return {
        name: verbBase,
        signature: `${verbBase}Async()`,
        body: `await Microsoft.Playwright.Assertions.Expect(_page.Locator(${selectorsClass}.${selKey})).ToBeVisibleAsync();`,
        selectorKey: selKey,
        rawSelector: call.rawSelector ?? call.selector,
      };
    }
    default:
      return null;
  }
}
