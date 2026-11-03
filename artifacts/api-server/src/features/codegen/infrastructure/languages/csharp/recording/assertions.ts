/**
 * Single-line emitters for UI-added assertions, waits, route mocks, and
 * API assertions in the C# / NUnit / Playwright dialect. Pure functions
 * (no I/O); each returns `null` for non-matching action kinds so the
 * caller can `continue` in its loop.
 */
import type {
  AssertionKind,
  RecordedAction,
  WaitKind,
} from "@/features/codegen/domain/types";

/**
 * Break an expected JSON object into top-level `"key":value` fragments
 * suitable for substring matching against a serialized response body.
 * Returns an empty array when the input is missing, blank, unparseable,
 * or not a plain object — body checks only target the common
 * "endpoint returns object with at least these fields" case.
 */
export function axeAllowedImpacts(level: string | undefined): string[] {
  const order = ["minor", "moderate", "serious", "critical"];
  const idx = order.indexOf((level ?? "serious").toLowerCase());
  return order.slice(idx >= 0 ? idx : 2);
}

export function topLevelKeyFragments(
  expectedJson: string | undefined,
): string[] {
  const raw = expectedJson?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const out: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    out.push(`"${k}":${JSON.stringify(v)}`);
  }
  return out;
}

/**
 * C# string-literal quoting for a method argument value emitted by both
 * the live preview (`computeTestBodyPreviewLines`) and `stop()`'s final
 * test-body assembly. Only quotes are escaped — backslashes are left as
 * authored, which matches the historical behavior of the file writer.
 */
export function csQuotedArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Render the C# Playwright `Expect(...)` line for a UI-added assertion.
 * Returns `null` for non-assert actions or assert actions missing the
 * fields required for their kind, so callers can skip them silently
 * instead of emitting malformed C#.
 */
export function renderAssertionLine(a: RecordedAction): string | null {
  if (a.type !== "assert") return null;
  switch (a.assertKind) {
    case "element-has-text": {
      const sel = a.selector ?? "";
      const text = a.assertText ?? "";
      if (!sel) return null;
      return `await Expect(Page.Locator(${csQuotedArg(sel)})).ToHaveTextAsync(${csQuotedArg(text)});`;
    }
    case "url-contains": {
      const sub = a.assertUrl ?? "";
      if (!sub) return null;
      return `await Expect(Page).ToHaveURLAsync(new System.Text.RegularExpressions.Regex(System.Text.RegularExpressions.Regex.Escape(${csQuotedArg(sub)})));`;
    }
    case "url-equals": {
      const url = a.assertUrl ?? "";
      if (!url) return null;
      return `await Expect(Page).ToHaveURLAsync(${csQuotedArg(url)});`;
    }
    case "element-visible": {
      const sel = a.selector ?? "";
      if (!sel) return null;
      return `await Expect(Page.Locator(${csQuotedArg(sel)})).ToBeVisibleAsync();`;
    }
    case "element-hidden": {
      const sel = a.selector ?? "";
      if (!sel) return null;
      return `await Expect(Page.Locator(${csQuotedArg(sel)})).ToBeHiddenAsync();`;
    }
    case "element-count-equals": {
      const sel = a.selector ?? "";
      const count = Number.isFinite(a.assertCount) ? Number(a.assertCount) : NaN;
      if (!sel || !Number.isFinite(count)) return null;
      return `await Expect(Page.Locator(${csQuotedArg(sel)})).ToHaveCountAsync(${count});`;
    }
    case "attribute-equals": {
      const sel = a.selector ?? "";
      const attr = a.assertAttribute ?? "";
      const val = a.assertAttrValue ?? "";
      if (!sel || !attr) return null;
      return `await Expect(Page.Locator(${csQuotedArg(sel)})).ToHaveAttributeAsync(${csQuotedArg(attr)}, ${csQuotedArg(val)});`;
    }
    case "value-equals": {
      const sel = a.selector ?? "";
      const val = a.assertValue ?? "";
      if (!sel) return null;
      return `await Expect(Page.Locator(${csQuotedArg(sel)})).ToHaveValueAsync(${csQuotedArg(val)});`;
    }
    case "response-status": {
      const code = Number.isFinite(a.assertStatusCode) ? Number(a.assertStatusCode) : NaN;
      if (!Number.isFinite(code)) return null;
      // The recorder captures the page's main-frame response status; in
      // generated tests we model this as a reload + status assertion so
      // the line is self-contained without a stored Response handle.
      return `Assert.AreEqual(${code}, (await Page.GotoAsync(Page.Url))!.Status);`;
    }
    case "api-status": {
      const url = a.apiUrl ?? "";
      const method = (a.apiMethod ?? "GET").toLowerCase();
      const status = a.apiExpectedStatus ?? 200;
      if (!url) return null;
      const callExpr = `await Page.APIRequest.${method.charAt(0).toUpperCase()}${method.slice(1)}Async(${csQuotedArg(url)});`;
      const head = `var apiResp = ${callExpr}\n            Assert.That((int)apiResp.Status, Is.EqualTo(${status}));`;
      const bodyTail = renderApiBodyCheckCsharp(a.apiExpectedJson);
      return bodyTail ? `${head}${bodyTail}` : head;
    }
    case "accessibility": {
      const impacts = axeAllowedImpacts(a.axeImpactLevel);
      const list = impacts.map((s) => `"${s}"`).join(", ");
      return [
        `var axeResults = await new Deque.AxeCore.Playwright.AxeBuilder(Page).AnalyzeAsync();`,
        `            var axeAllowed = new System.Collections.Generic.HashSet<string> { ${list} };`,
        `            var axeFailing = axeResults.Violations.Where(v => axeAllowed.Contains((v.Impact ?? "minor").ToString().ToLowerInvariant())).ToList();`,
        `            Assert.That(axeFailing, Is.Empty, $"Accessibility violations at impact >= ${a.axeImpactLevel ?? "serious"}: {string.Join(\\\", \\\", axeFailing.Select(v => v.Id))}");`,
      ].join("\n");
    }
    case "visual-baseline": {
      const name = a.visualName ?? "baseline";
      const threshold = a.visualThreshold ?? 0.02;
      return `await Expect(Page).ToHaveScreenshotAsync(${csQuotedArg(`${name}.png`)}, new() { MaxDiffPixelRatio = ${threshold}f, FullPage = true });`;
    }
    default:
      return null;
  }
}

/**
 * Render an action-call line for the new `routeMock` and `apiAssertion`
 * RecordedAction kinds. These do not go through the page-object
 * actions class, so they are emitted directly into the test body
 * before the `await Page.GotoAsync(...)` line (mocks) or appended in
 * order (api assertions).
 */
export function renderRouteMockLine(a: RecordedAction): string | null {
  if (a.type !== "routeMock") return null;
  const pattern = a.apiUrl ?? "";
  if (!pattern) return null;
  const status = a.mockStatus ?? 200;
  const body = a.mockBody ?? "{}";
  return `await Page.RouteAsync(${csQuotedArg(pattern)}, route => route.FulfillAsync(new() { Status = ${status}, ContentType = "application/json", Body = ${csQuotedArg(body)} }));`;
}

export function renderApiAssertionLine(a: RecordedAction): string | null {
  if (a.type !== "apiAssertion") return null;
  const url = a.apiUrl ?? "";
  if (!url) return null;
  const method = (a.apiMethod ?? "GET").toLowerCase();
  const status = a.apiExpectedStatus ?? 200;
  const verb = method.charAt(0).toUpperCase() + method.slice(1);
  const head = `var apiResp = await Page.APIRequest.${verb}Async(${csQuotedArg(url)});\n            Assert.That((int)apiResp.Status, Is.EqualTo(${status}));`;
  const bodyTail = renderApiBodyCheckCsharp(a.apiExpectedJson);
  return bodyTail ? `${head}${bodyTail}` : head;
}

/**
 * Emit a `StringAssert.Contains` line per top-level key in the
 * expected JSON, comparing against the response body text. Returns an
 * empty string when there is nothing to check or the expected JSON is
 * unparseable.
 */
function renderApiBodyCheckCsharp(expectedJson: string | undefined): string {
  const fragments = topLevelKeyFragments(expectedJson);
  if (fragments.length === 0) return "";
  const lines = [`\n            var apiBody = await apiResp.TextAsync();`];
  for (const f of fragments) {
    lines.push(
      `            StringAssert.Contains(${csQuotedArg(f)}, apiBody);`,
    );
  }
  return lines.join("\n");
}

/**
 * Render the C# Playwright wait line for a UI-added wait. Returns
 * `null` for non-wait actions or wait actions missing the fields
 * required for their kind, so callers can skip them silently instead
 * of emitting malformed C#.
 */
export function renderWaitLine(a: RecordedAction): string | null {
  if (a.type !== "wait") return null;
  switch (a.waitKind) {
    case "selector": {
      const sel = a.waitSelector ?? a.selector ?? "";
      if (!sel) return null;
      return `await Page.Locator(${csQuotedArg(sel)}).WaitForAsync();`;
    }
    case "networkidle":
      return `await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);`;
    case "timeout": {
      const ms = typeof a.waitMs === "number" && a.waitMs > 0 ? a.waitMs : 500;
      return `await Page.WaitForTimeoutAsync(${ms});`;
    }
    default:
      return null;
  }
}

/**
 * Default suggested label for a UI-added wait, used as the actions
 * feed row title before the user renames it.
 */
export function defaultWaitLabel(kind: WaitKind): string {
  switch (kind) {
    case "selector":
      return "WaitForSelector";
    case "networkidle":
      return "WaitForNetworkIdle";
    case "timeout":
      return "WaitForTimeout";
  }
}

/**
 * Default suggested label for a UI-added assertion. Used as the
 * `methodName` hint sent over the websocket so the actions feed shows
 * a meaningful row title (e.g. `AssertElementHasText`) before the user
 * renames it. Assertions never become real C# methods, so this name is
 * purely a display label and does not affect code generation.
 */
export function defaultAssertionLabel(kind: AssertionKind): string {
  switch (kind) {
    case "element-has-text":
      return "AssertElementHasText";
    case "url-contains":
      return "AssertUrlContains";
    case "url-equals":
      return "AssertUrlEquals";
    case "element-visible":
      return "AssertElementVisible";
    case "element-hidden":
      return "AssertElementHidden";
    case "element-count-equals":
      return "AssertElementCountEquals";
    case "attribute-equals":
      return "AssertAttributeEquals";
    case "value-equals":
      return "AssertValueEquals";
    case "response-status":
      return "AssertResponseStatus";
    case "api-status":
      return "AssertApiStatus";
    case "accessibility":
      return "AssertAccessibility";
    case "visual-baseline":
      return "AssertVisualBaseline";
  }
}
