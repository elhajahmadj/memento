// Per-line rendering for Java Playwright bodies (waits, assertions,
// route mocks, API assertions).
import {
  type RecordedAction,
  axeAllowedImpacts,
  topLevelKeyFragments,
} from "@/features/codegen/infrastructure/codegen";
import { javaQuotedArg } from "./naming";

// Render the Java Playwright wait line. Returns null when the action is
// not a wait or is missing fields required for its kind.
export function renderWaitLineJava(a: RecordedAction): string | null {
  if (a.type !== "wait") return null;
  switch (a.waitKind) {
    case "selector": {
      const sel = a.waitSelector ?? a.selector ?? "";
      if (!sel) return null;
      return `page.locator(${javaQuotedArg(sel)}).waitFor();`;
    }
    case "networkidle":
      return `page.waitForLoadState(LoadState.NETWORKIDLE);`;
    case "timeout": {
      const ms = typeof a.waitMs === "number" && a.waitMs > 0 ? a.waitMs : 500;
      return `page.waitForTimeout(${ms});`;
    }
    default:
      return null;
  }
}

export function renderAssertionLineJava(a: RecordedAction): string | null {
  if (a.type !== "assert") return null;
  switch (a.assertKind) {
    case "element-has-text": {
      const sel = a.selector ?? "";
      const text = a.assertText ?? "";
      if (!sel) return null;
      return `Assertions.assertEquals(${javaQuotedArg(text)}, page.locator(${javaQuotedArg(sel)}).textContent());`;
    }
    case "url-contains": {
      const sub = a.assertUrl ?? "";
      if (!sub) return null;
      return `Assertions.assertTrue(page.url().contains(${javaQuotedArg(sub)}));`;
    }
    case "url-equals": {
      const url = a.assertUrl ?? "";
      if (!url) return null;
      return `Assertions.assertEquals(${javaQuotedArg(url)}, page.url());`;
    }
    case "element-visible": {
      const sel = a.selector ?? "";
      if (!sel) return null;
      return `Assertions.assertTrue(page.locator(${javaQuotedArg(sel)}).first().isVisible());`;
    }
    case "element-hidden": {
      const sel = a.selector ?? "";
      if (!sel) return null;
      return `Assertions.assertTrue(page.locator(${javaQuotedArg(sel)}).first().isHidden());`;
    }
    case "element-count-equals": {
      const sel = a.selector ?? "";
      const count = Number.isFinite(a.assertCount) ? Number(a.assertCount) : NaN;
      if (!sel || !Number.isFinite(count)) return null;
      return `Assertions.assertEquals(${count}, page.locator(${javaQuotedArg(sel)}).count());`;
    }
    case "attribute-equals": {
      const sel = a.selector ?? "";
      const attr = a.assertAttribute ?? "";
      const val = a.assertAttrValue ?? "";
      if (!sel || !attr) return null;
      return `Assertions.assertEquals(${javaQuotedArg(val)}, page.locator(${javaQuotedArg(sel)}).first().getAttribute(${javaQuotedArg(attr)}));`;
    }
    case "value-equals": {
      const sel = a.selector ?? "";
      const val = a.assertValue ?? "";
      if (!sel) return null;
      return `Assertions.assertEquals(${javaQuotedArg(val)}, page.locator(${javaQuotedArg(sel)}).first().inputValue());`;
    }
    case "response-status": {
      const code = Number.isFinite(a.assertStatusCode) ? Number(a.assertStatusCode) : NaN;
      if (!Number.isFinite(code)) return null;
      return `Assertions.assertEquals(${code}, page.navigate(page.url()).status());`;
    }
    case "api-status": {
      const url = a.apiUrl ?? "";
      if (!url) return null;
      const method = (a.apiMethod ?? "GET").toLowerCase();
      const status = a.apiExpectedStatus ?? 200;
      const head = `APIResponse apiResp = page.request().${method}(${javaQuotedArg(url)});\n        Assertions.assertEquals(${status}, apiResp.status());`;
      const tail = renderApiBodyCheckJava(a.apiExpectedJson);
      return tail ? `${head}${tail}` : head;
    }
    case "accessibility": {
      const impacts = axeAllowedImpacts(a.axeImpactLevel);
      const set = impacts.map((s) => `"${s}"`).join(", ");
      return [
        `com.deque.html.axecore.results.Results axeResults = new com.deque.html.axecore.playwright.AxeBuilder(page).analyze();`,
        `        java.util.Set<String> axeAllowed = new java.util.HashSet<>(java.util.Arrays.asList(${set}));`,
        `        java.util.List<com.deque.html.axecore.results.Rule> axeFailing = axeResults.getViolations().stream().filter(v -> axeAllowed.contains((v.getImpact() == null ? "minor" : v.getImpact().toLowerCase()))).collect(java.util.stream.Collectors.toList());`,
        `        Assertions.assertTrue(axeFailing.isEmpty(), "Accessibility violations at impact >= ${a.axeImpactLevel ?? "serious"}: " + axeFailing.stream().map(com.deque.html.axecore.results.Rule::getId).collect(java.util.stream.Collectors.joining(", ")));`,
      ].join("\n");
    }
    case "visual-baseline": {
      const name = a.visualName ?? "baseline";
      const threshold = a.visualThreshold ?? 0.02;
      return `assertThat(page).hasScreenshot(${javaQuotedArg(`${name}.png`)}, new PageAssertions.HasScreenshotOptions().setMaxDiffPixelRatio(${threshold}).setFullPage(true));`;
    }
    default:
      return null;
  }
}

/** Render the Java `page.route(...)` line for a `routeMock` action. */
export function renderRouteMockLineJava(a: RecordedAction): string | null {
  if (a.type !== "routeMock") return null;
  const pattern = a.apiUrl ?? "";
  if (!pattern) return null;
  const status = a.mockStatus ?? 200;
  const body = a.mockBody ?? "{}";
  return `page.route(${javaQuotedArg(pattern)}, route -> route.fulfill(new Route.FulfillOptions().setStatus(${status}).setContentType("application/json").setBody(${javaQuotedArg(body)})));`;
}

/** Render the Java `page.request().<method>(...)` line for an apiAssertion action. */
export function renderApiAssertionLineJava(a: RecordedAction): string | null {
  if (a.type !== "apiAssertion") return null;
  const url = a.apiUrl ?? "";
  if (!url) return null;
  const method = (a.apiMethod ?? "GET").toLowerCase();
  const status = a.apiExpectedStatus ?? 200;
  const head = `APIResponse apiResp = page.request().${method}(${javaQuotedArg(url)});\n        Assertions.assertEquals(${status}, apiResp.status());`;
  const tail = renderApiBodyCheckJava(a.apiExpectedJson);
  return tail ? `${head}${tail}` : head;
}

function renderApiBodyCheckJava(expectedJson: string | undefined): string {
  const fragments = topLevelKeyFragments(expectedJson);
  if (fragments.length === 0) return "";
  const lines = ["\n        String apiBody = apiResp.text();"];
  for (const f of fragments) {
    lines.push(`        Assertions.assertTrue(apiBody.contains(${javaQuotedArg(f)}));`);
  }
  return lines.join("\n");
}
