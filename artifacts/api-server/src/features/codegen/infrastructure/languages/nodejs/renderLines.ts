import {
  type RecordedAction,
  axeAllowedImpacts,
  topLevelKeyFragments,
} from "@/features/codegen/infrastructure/codegen";
import { tsQuotedArg } from "./naming";

/**
 * Render the Node.js Playwright wait line for a UI-added wait.
 */
export function renderWaitLineNodejs(a: RecordedAction): string | null {
  if (a.type !== "wait") return null;
  switch (a.waitKind) {
    case "selector": {
      const sel = a.waitSelector ?? a.selector ?? "";
      if (!sel) return null;
      return `await page.locator(${tsQuotedArg(sel)}).waitFor();`;
    }
    case "networkidle":
      return `await page.waitForLoadState("networkidle");`;
    case "timeout": {
      const ms = typeof a.waitMs === "number" && a.waitMs > 0 ? a.waitMs : 500;
      return `await page.waitForTimeout(${ms});`;
    }
    default:
      return null;
  }
}

export function renderAssertionLineNodejs(a: RecordedAction): string | null {
  if (a.type !== "assert") return null;
  switch (a.assertKind) {
    case "element-has-text": {
      const sel = a.selector ?? "";
      const text = a.assertText ?? "";
      if (!sel) return null;
      return `await expect(page.locator(${tsQuotedArg(sel)})).toHaveText(${tsQuotedArg(text)});`;
    }
    case "url-contains": {
      const sub = a.assertUrl ?? "";
      if (!sub) return null;
      return `expect(page.url()).toContain(${tsQuotedArg(sub)});`;
    }
    case "url-equals": {
      const url = a.assertUrl ?? "";
      if (!url) return null;
      return `await expect(page).toHaveURL(${tsQuotedArg(url)});`;
    }
    case "element-visible": {
      const sel = a.selector ?? "";
      if (!sel) return null;
      return `await expect(page.locator(${tsQuotedArg(sel)})).toBeVisible();`;
    }
    case "element-hidden": {
      const sel = a.selector ?? "";
      if (!sel) return null;
      return `await expect(page.locator(${tsQuotedArg(sel)})).toBeHidden();`;
    }
    case "element-count-equals": {
      const sel = a.selector ?? "";
      const count = Number.isFinite(a.assertCount) ? Number(a.assertCount) : NaN;
      if (!sel || !Number.isFinite(count)) return null;
      return `await expect(page.locator(${tsQuotedArg(sel)})).toHaveCount(${count});`;
    }
    case "attribute-equals": {
      const sel = a.selector ?? "";
      const attr = a.assertAttribute ?? "";
      const val = a.assertAttrValue ?? "";
      if (!sel || !attr) return null;
      return `await expect(page.locator(${tsQuotedArg(sel)})).toHaveAttribute(${tsQuotedArg(attr)}, ${tsQuotedArg(val)});`;
    }
    case "value-equals": {
      const sel = a.selector ?? "";
      const val = a.assertValue ?? "";
      if (!sel) return null;
      return `await expect(page.locator(${tsQuotedArg(sel)})).toHaveValue(${tsQuotedArg(val)});`;
    }
    case "response-status": {
      const code = Number.isFinite(a.assertStatusCode) ? Number(a.assertStatusCode) : NaN;
      if (!Number.isFinite(code)) return null;
      return `expect((await page.goto(page.url()))?.status()).toBe(${code});`;
    }
    case "api-status": {
      const url = a.apiUrl ?? "";
      if (!url) return null;
      const method = (a.apiMethod ?? "GET").toLowerCase();
      const status = a.apiExpectedStatus ?? 200;
      const head = `const apiResp = await page.request.${method}(${tsQuotedArg(url)});\n  expect(apiResp.status()).toBe(${status});`;
      const tail = renderApiBodyCheckNodejs(a.apiExpectedJson);
      return tail ? `${head}${tail}` : head;
    }
    case "accessibility": {
      const impacts = axeAllowedImpacts(a.axeImpactLevel);
      const set = `new Set([${impacts.map((s) => `"${s}"`).join(", ")}])`;
      return [
        `const { default: AxeBuilder } = await import("@axe-core/playwright");`,
        `  const axeResults = await new AxeBuilder({ page }).analyze();`,
        `  const axeAllowed = ${set};`,
        `  const axeFailing = axeResults.violations.filter((v) => axeAllowed.has(((v.impact ?? "minor") + "").toLowerCase()));`,
        `  expect(axeFailing, \`Accessibility violations at impact >= ${a.axeImpactLevel ?? "serious"}: \${axeFailing.map((v) => v.id).join(", ")}\`).toEqual([]);`,
      ].join("\n");
    }
    case "visual-baseline": {
      const name = a.visualName ?? "baseline";
      const threshold = a.visualThreshold ?? 0.02;
      return `await expect(page).toHaveScreenshot(${tsQuotedArg(`${name}.png`)}, { maxDiffPixelRatio: ${threshold} });`;
    }
    default:
      return null;
  }
}

/** Render the Node.js `page.route(...)` line for a `routeMock` action. */
export function renderRouteMockLineNodejs(a: RecordedAction): string | null {
  if (a.type !== "routeMock") return null;
  const pattern = a.apiUrl ?? "";
  if (!pattern) return null;
  const status = a.mockStatus ?? 200;
  const body = a.mockBody ?? "{}";
  return `await page.route(${tsQuotedArg(pattern)}, route => route.fulfill({ status: ${status}, contentType: "application/json", body: ${tsQuotedArg(body)} }));`;
}

/** Render the Node.js `page.request.<method>(...)` line for an apiAssertion action. */
export function renderApiAssertionLineNodejs(a: RecordedAction): string | null {
  if (a.type !== "apiAssertion") return null;
  const url = a.apiUrl ?? "";
  if (!url) return null;
  const method = (a.apiMethod ?? "GET").toLowerCase();
  const status = a.apiExpectedStatus ?? 200;
  const head = `const apiResp = await page.request.${method}(${tsQuotedArg(url)});\n  expect(apiResp.status()).toBe(${status});`;
  const tail = renderApiBodyCheckNodejs(a.apiExpectedJson);
  return tail ? `${head}${tail}` : head;
}

function renderApiBodyCheckNodejs(expectedJson: string | undefined): string {
  const fragments = topLevelKeyFragments(expectedJson);
  if (fragments.length === 0) return "";
  const lines = ["\n  const apiBody = await apiResp.text();"];
  for (const f of fragments) {
    lines.push(`  expect(apiBody).toContain(${tsQuotedArg(f)});`);
  }
  return lines.join("\n");
}
