import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { normalizeSelectorForLocator } from "@/features/codegen/infrastructure/codegen";
import { jsonSubsetMismatch } from "../domain/jsonSubset";
import { sanitizeForPath } from "../domain/sanitize";
import {
  PER_STEP_TIMEOUT_MS,
  type ValidationStep,
} from "../domain/validationStep";

export interface AssertContext {
  lastMainFrameStatus: number | null;
}

export interface AssertRunnerHooks {
  push(event: unknown): void;
}

/**
 * Evaluate a recorded `assert` step. Throws on failure with an actionable
 * message; the caller turns the throw into a step-failed event. We don't
 * pull in @playwright/test's `expect` here — the API server only depends
 * on the runtime `playwright` package.
 */
export async function runAssertStep(
  page: Page,
  step: ValidationStep,
  ctx: AssertContext,
  projectName: string,
  hooks: AssertRunnerHooks,
): Promise<void> {
  const kind = step.assertKind ?? null;
  if (kind === "element-has-text") {
    const sel = step.selector;
    const expected = step.value ?? "";
    if (!sel) throw new Error("assert element-has-text has no selector");
    const loc = page
      .locator(normalizeSelectorForLocator(sel, step.selectorStrategy ?? undefined))
      .first();
    await loc.waitFor({ state: "visible", timeout: PER_STEP_TIMEOUT_MS });
    const actual = (await loc.textContent({ timeout: PER_STEP_TIMEOUT_MS })) ?? "";
    if (!actual.includes(expected)) {
      throw new Error(
        `Expected element to contain text "${expected}" but got "${actual.trim().slice(0, 200)}"`,
      );
    }
    return;
  }
  if (kind === "url-contains") {
    const expected = step.value ?? "";
    const actual = page.url();
    if (!actual.includes(expected)) {
      throw new Error(
        `Expected URL to contain "${expected}" but current URL is "${actual}"`,
      );
    }
    return;
  }
  if (kind === "url-equals") {
    const expected = step.value ?? "";
    const actual = page.url();
    if (actual !== expected) {
      throw new Error(
        `Expected URL to equal "${expected}" but current URL is "${actual}"`,
      );
    }
    return;
  }
  if (kind === "element-visible") {
    const sel = step.selector;
    if (!sel) throw new Error("assert element-visible has no selector");
    const loc = page
      .locator(normalizeSelectorForLocator(sel, step.selectorStrategy ?? undefined))
      .first();
    await loc.waitFor({ state: "visible", timeout: PER_STEP_TIMEOUT_MS });
    return;
  }
  if (kind === "element-hidden") {
    const sel = step.selector;
    if (!sel) throw new Error("assert element-hidden has no selector");
    const loc = page
      .locator(normalizeSelectorForLocator(sel, step.selectorStrategy ?? undefined))
      .first();
    await loc.waitFor({ state: "hidden", timeout: PER_STEP_TIMEOUT_MS });
    return;
  }
  if (kind === "element-count-equals") {
    const sel = step.selector;
    const expected = step.assertCount ?? null;
    if (!sel) throw new Error("assert element-count-equals has no selector");
    if (expected === null)
      throw new Error("assert element-count-equals has no count");
    const actual = await page
      .locator(normalizeSelectorForLocator(sel, step.selectorStrategy ?? undefined))
      .count();
    if (actual !== expected) {
      throw new Error(`Expected element count ${expected} but got ${actual}`);
    }
    return;
  }
  if (kind === "api-status") {
    const raw = step.value ?? "";
    const [head, ...rest] = raw.split("\n");
    const expectedJsonRaw = rest.length > 0 ? rest.join("\n") : null;
    const m = (head ?? "").match(/^(\S+)\s+(\S+)\s+->\s+(\d{3})$/);
    if (!m) throw new Error(`api-status step is malformed: ${raw}`);
    const method = m[1]!.toUpperCase();
    const url = m[2]!;
    const expected = Number(m[3]);
    const context = page.context();
    const resp = await context.request.fetch(url, {
      method,
      timeout: PER_STEP_TIMEOUT_MS,
    });
    if (resp.status() !== expected) {
      throw new Error(
        `Expected ${method} ${url} to respond with ${expected} but got ${resp.status()}`,
      );
    }
    if (expectedJsonRaw && expectedJsonRaw.trim()) {
      let expectedShape: unknown;
      try {
        expectedShape = JSON.parse(expectedJsonRaw);
      } catch {
        throw new Error(
          `api-status expected JSON is not valid JSON: ${expectedJsonRaw.slice(0, 80)}`,
        );
      }
      let actualShape: unknown;
      try {
        actualShape = await resp.json();
      } catch {
        throw new Error(
          `Expected JSON body for ${method} ${url} but response was not JSON`,
        );
      }
      const mismatch = jsonSubsetMismatch(expectedShape, actualShape, "$");
      if (mismatch) throw new Error(mismatch);
    }
    return;
  }
  if (kind === "attribute-equals") {
    const sel = step.selector;
    const attr = step.assertAttribute ?? "";
    const expected = step.assertAttrValue ?? "";
    if (!sel) throw new Error("assert attribute-equals has no selector");
    if (!attr) throw new Error("assert attribute-equals has no attribute");
    const loc = page
      .locator(normalizeSelectorForLocator(sel, step.selectorStrategy ?? undefined))
      .first();
    await loc.waitFor({ state: "attached", timeout: PER_STEP_TIMEOUT_MS });
    const actual = (await loc.getAttribute(attr, { timeout: PER_STEP_TIMEOUT_MS })) ?? "";
    if (actual !== expected) {
      throw new Error(
        `Expected attribute "${attr}" to equal "${expected}" but got "${actual}"`,
      );
    }
    return;
  }
  if (kind === "accessibility") {
    let axeScriptPath: string | null = null;
    try {
      const axeCore = await import("axe-core");
      const dirname = path.dirname(require.resolve("axe-core/package.json"));
      axeScriptPath = path.join(dirname, "axe.min.js");
      void axeCore;
    } catch {
      throw new Error(
        "axe-core is not installed on the server; install it to enable accessibility assertions",
      );
    }
    await page.addScriptTag({ path: axeScriptPath! });
    type AxeNode = { target: string[]; html: string };
    type AxeRunViolation = {
      id: string;
      impact: string | null;
      help: string;
      description: string;
      nodes: AxeNode[];
    };
    const result: { violations: AxeRunViolation[] } = await page.evaluate(
      async () => {
        type AxeRunner = {
          run: (
            ctx: unknown,
            opts: { runOnly: { type: string; values: string[] } },
          ) => Promise<{ violations: AxeRunViolation[] }>;
        };
        const g = globalThis as unknown as {
          axe: AxeRunner;
          document: unknown;
        };
        const r = await g.axe.run(g.document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        });
        return {
          violations: r.violations.map((v) => ({
            id: v.id,
            impact: v.impact ?? "minor",
            help: v.help,
            description: v.description,
            nodes: v.nodes.map((n) => ({ target: n.target, html: n.html })),
          })),
        };
      },
    );
    const minImpact = (step.value ?? "serious").toLowerCase();
    const order: Record<string, number> = {
      minor: 0,
      moderate: 1,
      serious: 2,
      critical: 3,
    };
    const threshold = order[minImpact] ?? 2;
    const failing = result.violations.filter(
      (v) => (order[(v.impact ?? "minor").toLowerCase()] ?? 0) >= threshold,
    );
    hooks.push({
      type: "a11y-violations",
      stepIndex: step.index,
      violations: result.violations,
    });
    if (failing.length > 0) {
      throw new Error(
        `Found ${failing.length} accessibility violation${
          failing.length === 1 ? "" : "s"
        } at impact >= ${minImpact}: ${failing
          .slice(0, 3)
          .map((v) => v.id)
          .join(", ")}`,
      );
    }
    return;
  }
  if (kind === "value-equals") {
    const sel = step.selector;
    const expected = step.value ?? step.assertValue ?? "";
    if (!sel) throw new Error("assert value-equals has no selector");
    const loc = page
      .locator(normalizeSelectorForLocator(sel, step.selectorStrategy ?? undefined))
      .first();
    await loc.waitFor({ state: "attached", timeout: PER_STEP_TIMEOUT_MS });
    const actual = await loc.inputValue({ timeout: PER_STEP_TIMEOUT_MS });
    if (actual !== expected) {
      throw new Error(`Expected value "${expected}" but got "${actual}"`);
    }
    return;
  }
  if (kind === "response-status") {
    const expected = step.assertStatusCode ?? null;
    if (expected === null)
      throw new Error("assert response-status has no status code");
    const actual = ctx.lastMainFrameStatus;
    if (actual === null) {
      throw new Error(
        `Expected response status ${expected} but no main-frame response was captured`,
      );
    }
    if (actual !== expected) {
      throw new Error(`Expected response status ${expected} but got ${actual}`);
    }
    return;
  }
  if (kind === "visual-baseline") {
    const raw = step.value ?? "baseline|0.02";
    const [name, thresholdStr] = raw.split("|");
    const threshold = Number(thresholdStr ?? "0.02");
    const baselinesDir = path.join(
      process.cwd(),
      ".validation-baselines",
      sanitizeForPath(projectName),
    );
    await fs.mkdir(baselinesDir, { recursive: true });
    const baselinePath = path.join(baselinesDir, `${name}.png`);
    const fresh = await page.screenshot({ fullPage: true, type: "png" });
    let baselineExists = false;
    try {
      await fs.access(baselinePath);
      baselineExists = true;
    } catch {
      baselineExists = false;
    }
    if (!baselineExists) {
      await fs.writeFile(baselinePath, fresh);
      hooks.push({
        type: "visual-baseline-created",
        stepIndex: step.index,
        name,
      });
      return;
    }
    let pngjs: typeof import("pngjs");
    let pixelmatch: typeof import("pixelmatch").default;
    try {
      pngjs = await import("pngjs");
      pixelmatch = (await import("pixelmatch")).default;
    } catch {
      throw new Error(
        "pngjs and/or pixelmatch are not installed; install them to enable visual baseline assertions",
      );
    }
    const baselineBuf = await fs.readFile(baselinePath);
    const baseline = pngjs.PNG.sync.read(baselineBuf);
    const candidate = pngjs.PNG.sync.read(fresh);
    const w = Math.min(baseline.width, candidate.width);
    const h = Math.min(baseline.height, candidate.height);
    const diff = new pngjs.PNG({ width: w, height: h });
    const baselineCropped = new pngjs.PNG({ width: w, height: h });
    pngjs.PNG.bitblt(baseline, baselineCropped, 0, 0, w, h, 0, 0);
    const candidateCropped = new pngjs.PNG({ width: w, height: h });
    pngjs.PNG.bitblt(candidate, candidateCropped, 0, 0, w, h, 0, 0);
    const diffPixels = pixelmatch(
      baselineCropped.data,
      candidateCropped.data,
      diff.data,
      w,
      h,
      { threshold: 0.1 },
    );
    const ratio = diffPixels / (w * h);
    const diffPath = path.join(
      baselinesDir,
      `${name}.diff.${Date.now()}.png`,
    );
    await fs.writeFile(diffPath, pngjs.PNG.sync.write(diff));
    hooks.push({
      type: "visual-diff",
      stepIndex: step.index,
      name,
      ratio,
      threshold,
      diffPath,
    });
    if (ratio > threshold) {
      throw new Error(
        `Visual diff for "${name}" exceeded threshold (${(ratio * 100).toFixed(2)}% > ${(threshold * 100).toFixed(2)}%)`,
      );
    }
    return;
  }
  throw new Error(`Unsupported assertKind: ${String(kind)}`);
}
