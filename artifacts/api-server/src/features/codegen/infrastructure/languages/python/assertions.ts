/**
 * Per-line renderers used by the recordingService (and the live preview)
 * to assemble a Python test method body. Each render function returns
 * `null` for unsupported / malformed actions so callers can skip silently
 * instead of emitting bad code.
 */
import {
  type RecordedAction,
  axeAllowedImpacts,
  topLevelKeyFragments,
} from "@/features/codegen/infrastructure/codegen";
import { pyQuotedArg } from "./naming";

/** Render the Python Playwright wait line for a UI-added wait. */
export function renderWaitLinePython(a: RecordedAction): string | null {
  if (a.type !== "wait") return null;
  switch (a.waitKind) {
    case "selector": {
      const sel = a.waitSelector ?? a.selector ?? "";
      if (!sel) return null;
      return `page.locator(${pyQuotedArg(sel)}).wait_for()`;
    }
    case "networkidle":
      return `page.wait_for_load_state("networkidle")`;
    case "timeout": {
      const ms = typeof a.waitMs === "number" && a.waitMs > 0 ? a.waitMs : 500;
      return `page.wait_for_timeout(${ms})`;
    }
    default:
      return null;
  }
}

/**
 * Render the Python Playwright `expect(...)` line for a UI-added assertion.
 */
export function renderAssertionLinePython(a: RecordedAction): string | null {
  if (a.type !== "assert") return null;
  switch (a.assertKind) {
    case "element-has-text": {
      const sel = a.selector ?? "";
      const text = a.assertText ?? "";
      if (!sel) return null;
      return `expect(page.locator(${pyQuotedArg(sel)})).to_have_text(${pyQuotedArg(text)})`;
    }
    case "url-contains": {
      const sub = a.assertUrl ?? "";
      if (!sub) return null;
      return `assert ${pyQuotedArg(sub)} in page.url`;
    }
    case "url-equals": {
      const url = a.assertUrl ?? "";
      if (!url) return null;
      return `expect(page).to_have_url(${pyQuotedArg(url)})`;
    }
    case "element-visible": {
      const sel = a.selector ?? "";
      if (!sel) return null;
      return `expect(page.locator(${pyQuotedArg(sel)})).to_be_visible()`;
    }
    case "element-hidden": {
      const sel = a.selector ?? "";
      if (!sel) return null;
      return `expect(page.locator(${pyQuotedArg(sel)})).to_be_hidden()`;
    }
    case "element-count-equals": {
      const sel = a.selector ?? "";
      const count = Number.isFinite(a.assertCount) ? Number(a.assertCount) : NaN;
      if (!sel || !Number.isFinite(count)) return null;
      return `expect(page.locator(${pyQuotedArg(sel)})).to_have_count(${count})`;
    }
    case "attribute-equals": {
      const sel = a.selector ?? "";
      const attr = a.assertAttribute ?? "";
      const val = a.assertAttrValue ?? "";
      if (!sel || !attr) return null;
      return `expect(page.locator(${pyQuotedArg(sel)})).to_have_attribute(${pyQuotedArg(attr)}, ${pyQuotedArg(val)})`;
    }
    case "value-equals": {
      const sel = a.selector ?? "";
      const val = a.assertValue ?? "";
      if (!sel) return null;
      return `expect(page.locator(${pyQuotedArg(sel)})).to_have_value(${pyQuotedArg(val)})`;
    }
    case "response-status": {
      const code = Number.isFinite(a.assertStatusCode) ? Number(a.assertStatusCode) : NaN;
      if (!Number.isFinite(code)) return null;
      return `assert page.goto(page.url).status == ${code}`;
    }
    case "api-status": {
      const url = a.apiUrl ?? "";
      if (!url) return null;
      const method = (a.apiMethod ?? "GET").toLowerCase();
      const status = a.apiExpectedStatus ?? 200;
      const head = `api_resp = page.request.${method}(${pyQuotedArg(url)})\n    assert api_resp.status == ${status}`;
      const tail = renderApiBodyCheckPython(a.apiExpectedJson);
      return tail ? `${head}${tail}` : head;
    }
    case "accessibility": {
      const impacts = axeAllowedImpacts(a.axeImpactLevel);
      const set = `{${impacts.map((s) => `"${s}"`).join(", ")}}`;
      return [
        `from axe_playwright_python.sync_playwright import Axe`,
        `    axe_results = Axe().run(self.page)`,
        `    axe_allowed = ${set}`,
        `    axe_failing = [v for v in (axe_results.response or {}).get("violations", []) if (v.get("impact") or "minor").lower() in axe_allowed]`,
        `    assert axe_failing == [], f"Accessibility violations at impact >= ${a.axeImpactLevel ?? "serious"}: {[v.get('id') for v in axe_failing]}"`,
      ].join("\n");
    }
    case "visual-baseline": {
      const name = a.visualName ?? "baseline";
      const threshold = a.visualThreshold ?? 0.02;
      return `expect(page).to_have_screenshot(${pyQuotedArg(`${name}.png`)}, max_diff_pixel_ratio=${threshold})`;
    }
    default:
      return null;
  }
}

/** Render the Python `page.route(...)` line for a `routeMock` action. */
export function renderRouteMockLinePython(a: RecordedAction): string | null {
  if (a.type !== "routeMock") return null;
  const pattern = a.apiUrl ?? "";
  if (!pattern) return null;
  const status = a.mockStatus ?? 200;
  const body = a.mockBody ?? "{}";
  return `page.route(${pyQuotedArg(pattern)}, lambda route: route.fulfill(status=${status}, content_type="application/json", body=${pyQuotedArg(body)}))`;
}

/** Render the Python `page.request.<method>(...)` line for an apiAssertion action. */
export function renderApiAssertionLinePython(a: RecordedAction): string | null {
  if (a.type !== "apiAssertion") return null;
  const url = a.apiUrl ?? "";
  if (!url) return null;
  const method = (a.apiMethod ?? "GET").toLowerCase();
  const status = a.apiExpectedStatus ?? 200;
  const head = `api_resp = page.request.${method}(${pyQuotedArg(url)})\n    assert api_resp.status == ${status}`;
  const tail = renderApiBodyCheckPython(a.apiExpectedJson);
  return tail ? `${head}${tail}` : head;
}

function renderApiBodyCheckPython(expectedJson: string | undefined): string {
  const fragments = topLevelKeyFragments(expectedJson);
  if (fragments.length === 0) return "";
  const lines = ["\n    api_body = api_resp.text()"];
  for (const f of fragments) {
    lines.push(`    assert ${pyQuotedArg(f)} in api_body`);
  }
  return lines.join("\n");
}
