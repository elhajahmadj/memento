/**
 * Per-language snapshot coverage for the Tier-2 "Add wait" feature.
 * Each language's renderWaitLine* must emit the right Playwright `await`
 * call for each wait kind:
 *
 *   selector    -> Locator(...).WaitForAsync() / .wait_for() / .waitFor()
 *   networkidle -> Page.WaitForLoadStateAsync(NetworkIdle) /
 *                  page.wait_for_load_state("networkidle") /
 *                  page.waitForLoadState(LoadState.NETWORKIDLE) /
 *                  page.waitForLoadState("networkidle")
 *   timeout     -> Page.WaitForTimeoutAsync(ms) /
 *                  page.wait_for_timeout(ms) /
 *                  page.waitForTimeout(ms)
 *
 * Also asserts the shared fallbacks: missing waitSelector falls back to
 * `selector`, missing/zero waitMs falls back to 500, and any unknown
 * waitKind / non-wait action returns null.
 */
import { describe, expect, it } from "vitest";
import { renderWaitLine as renderWaitLineCsharp } from "@/features/codegen/infrastructure/codegen";
import { renderWaitLineNodejs } from "@/features/codegen/infrastructure/nodejsCodegen";
import { renderWaitLinePython } from "@/features/codegen/infrastructure/pythonCodegen";
import { renderWaitLineJava } from "@/features/codegen/infrastructure/javaCodegen";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

describe("renderWaitLine — C# (Page.*)", () => {
  it("selector -> await Page.Locator(sel).WaitForAsync()", () => {
    expect(
      renderWaitLineCsharp({
        type: "wait",
        waitKind: "selector",
        waitSelector: "#hello",
      }),
    ).toBe('await Page.Locator("#hello").WaitForAsync();');
  });

  it("selector falls back to action.selector when waitSelector is absent", () => {
    expect(
      renderWaitLineCsharp({
        type: "wait",
        waitKind: "selector",
        selector: "#fallback",
      } as RecordedAction),
    ).toBe('await Page.Locator("#fallback").WaitForAsync();');
  });

  it("selector with no usable selector returns null", () => {
    expect(
      renderWaitLineCsharp({ type: "wait", waitKind: "selector" }),
    ).toBeNull();
  });

  it("networkidle -> await Page.WaitForLoadStateAsync(LoadState.NetworkIdle)", () => {
    expect(
      renderWaitLineCsharp({ type: "wait", waitKind: "networkidle" }),
    ).toBe("await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);");
  });

  it("timeout -> await Page.WaitForTimeoutAsync(ms)", () => {
    expect(
      renderWaitLineCsharp({ type: "wait", waitKind: "timeout", waitMs: 1500 }),
    ).toBe("await Page.WaitForTimeoutAsync(1500);");
  });

  it("timeout defaults to 500ms when waitMs is missing or non-positive", () => {
    expect(
      renderWaitLineCsharp({ type: "wait", waitKind: "timeout" }),
    ).toBe("await Page.WaitForTimeoutAsync(500);");
    expect(
      renderWaitLineCsharp({ type: "wait", waitKind: "timeout", waitMs: 0 }),
    ).toBe("await Page.WaitForTimeoutAsync(500);");
  });

  it("returns null for non-wait actions", () => {
    expect(
      renderWaitLineCsharp({ type: "click", selector: "#x" }),
    ).toBeNull();
  });
});

describe("renderWaitLineNodejs — @playwright/test (page.*)", () => {
  it("selector -> await page.locator(sel).waitFor()", () => {
    expect(
      renderWaitLineNodejs({
        type: "wait",
        waitKind: "selector",
        waitSelector: "#hello",
      }),
    ).toBe('await page.locator("#hello").waitFor();');
  });

  it("networkidle -> await page.waitForLoadState(\"networkidle\")", () => {
    expect(
      renderWaitLineNodejs({ type: "wait", waitKind: "networkidle" }),
    ).toBe('await page.waitForLoadState("networkidle");');
  });

  it("timeout -> await page.waitForTimeout(ms)", () => {
    expect(
      renderWaitLineNodejs({ type: "wait", waitKind: "timeout", waitMs: 750 }),
    ).toBe("await page.waitForTimeout(750);");
  });

  it("timeout defaults to 500", () => {
    expect(
      renderWaitLineNodejs({ type: "wait", waitKind: "timeout" }),
    ).toBe("await page.waitForTimeout(500);");
  });

  it("returns null for non-wait actions", () => {
    expect(
      renderWaitLineNodejs({ type: "click", selector: "#x" }),
    ).toBeNull();
  });
});

describe("renderWaitLinePython — playwright sync API (page.*)", () => {
  it("selector -> page.locator(sel).wait_for()", () => {
    expect(
      renderWaitLinePython({
        type: "wait",
        waitKind: "selector",
        waitSelector: "#hello",
      }),
    ).toBe('page.locator("#hello").wait_for()');
  });

  it("networkidle -> page.wait_for_load_state(\"networkidle\")", () => {
    expect(
      renderWaitLinePython({ type: "wait", waitKind: "networkidle" }),
    ).toBe('page.wait_for_load_state("networkidle")');
  });

  it("timeout -> page.wait_for_timeout(ms)", () => {
    expect(
      renderWaitLinePython({ type: "wait", waitKind: "timeout", waitMs: 250 }),
    ).toBe("page.wait_for_timeout(250)");
  });

  it("timeout defaults to 500", () => {
    expect(
      renderWaitLinePython({ type: "wait", waitKind: "timeout" }),
    ).toBe("page.wait_for_timeout(500)");
  });

  it("returns null for non-wait actions", () => {
    expect(
      renderWaitLinePython({ type: "click", selector: "#x" }),
    ).toBeNull();
  });
});

describe("renderWaitLineJava — playwright-java (page.*)", () => {
  it("selector -> page.locator(sel).waitFor()", () => {
    expect(
      renderWaitLineJava({
        type: "wait",
        waitKind: "selector",
        waitSelector: "#hello",
      }),
    ).toBe('page.locator("#hello").waitFor();');
  });

  it("networkidle -> page.waitForLoadState(LoadState.NETWORKIDLE)", () => {
    expect(
      renderWaitLineJava({ type: "wait", waitKind: "networkidle" }),
    ).toBe("page.waitForLoadState(LoadState.NETWORKIDLE);");
  });

  it("timeout -> page.waitForTimeout(ms)", () => {
    expect(
      renderWaitLineJava({ type: "wait", waitKind: "timeout", waitMs: 1234 }),
    ).toBe("page.waitForTimeout(1234);");
  });

  it("timeout defaults to 500", () => {
    expect(
      renderWaitLineJava({ type: "wait", waitKind: "timeout" }),
    ).toBe("page.waitForTimeout(500);");
  });

  it("returns null for non-wait actions", () => {
    expect(
      renderWaitLineJava({ type: "click", selector: "#x" }),
    ).toBeNull();
  });
});
