import { randomUUID } from "node:crypto";
import type { Browser, Page } from "playwright";
import { logger } from "@/shared/logger";
import { launchRecordingChromium } from "@/features/recording/infrastructure/browserLauncher";
import { RECORDER_SCRIPT } from "@/features/recording/infrastructure/recorderInjection";

/**
 * "Re-pick element" Chromium session used by the Fix-selector dialog.
 *
 * Each session owns one headless browser + page that has the recorder
 * injection script applied (so the existing `__recorderPickElement(x,y)`
 * binding generates a selector identical to one captured during an
 * initial recording). The dialog calls:
 *
 *   1. `startRepickSession({ pageUrl, viewport })` → browser launches,
 *      navigates, returns `{ sessionId, screenshotBase64, viewport }`.
 *   2. `pickAt({ sessionId, x, y })` → page.evaluate runs the recorder's
 *      `__recorderPickElement` at the supplied viewport coordinates and
 *      returns the resulting `{ selector, strategy }`.
 *   3. `refreshScreenshot({ sessionId })` → optional re-screenshot if
 *      the page has changed (e.g. after a hover or scroll).
 *   4. `cancelRepickSession({ sessionId })` → closes the browser.
 *
 * Sessions auto-expire after 5 minutes so a forgotten dialog doesn't
 * leak a Chromium process indefinitely.
 */

interface RepickSession {
  id: string;
  browser: Browser;
  page: Page;
  viewport: { width: number; height: number };
  pageUrl: string;
  createdAt: number;
  ownerUserId: string;
  expiresTimer: NodeJS.Timeout;
}

const SESSIONS = new Map<string, RepickSession>();
const SESSION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

export interface StartRepickArgs {
  pageUrl: string;
  ownerUserId: string;
  viewport?: { width: number; height: number };
  /** Optional — when supplied, we attempt to scroll + outline this
   *  selector after navigation so the user can see where the broken
   *  match used to land before picking its replacement. Best-effort:
   *  if it no longer resolves we just skip the highlight. */
  oldSelector?: string;
}

/**
 * Block re-pick start when the supplied URL points at a private /
 * loopback / link-local host — otherwise a malicious caller could
 * use our server-side Chromium to probe internal services. Override
 * with `ALLOW_REPICK_PRIVATE=1` only in trusted dev environments.
 */
export function isUrlAllowedForRepick(url: string): {
  ok: boolean;
  reason?: string;
} {
  if (process.env.ALLOW_REPICK_PRIVATE === "1") return { ok: true };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Only http(s) URLs are supported" };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return { ok: false, reason: "Private / loopback hosts are not allowed" };
  }
  // IPv4 numeric ranges
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [parseInt(v4[1]!, 10), parseInt(v4[2]!, 10)];
    if (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    ) {
      return { ok: false, reason: "Private IP ranges are not allowed" };
    }
  }
  // IPv6 ULA / link-local
  if (host.startsWith("[fc") || host.startsWith("[fd") || host.startsWith("[fe80")) {
    return { ok: false, reason: "Private IPv6 ranges are not allowed" };
  }
  return { ok: true };
}

export interface StartRepickResult {
  sessionId: string;
  screenshotBase64: string;
  viewport: { width: number; height: number };
  pageUrl: string;
}

export async function startRepickSession(
  args: StartRepickArgs,
): Promise<StartRepickResult> {
  const guard = isUrlAllowedForRepick(args.pageUrl);
  if (!guard.ok) {
    throw new Error(`Cannot re-pick on this URL: ${guard.reason}`);
  }
  const viewport = args.viewport ?? DEFAULT_VIEWPORT;
  const browser = await launchRecordingChromium();
  const context = await browser.newContext({ viewport });
  await context.addInitScript(RECORDER_SCRIPT);
  const page = await context.newPage();
  try {
    await page.goto(args.pageUrl, { timeout: 20000, waitUntil: "domcontentloaded" });
  } catch (e) {
    await browser.close().catch(() => {});
    throw new Error(
      `Failed to load ${args.pageUrl} for re-pick: ${(e as Error).message}`,
    );
  }
  // Best-effort highlight of the previous selector site so the user
  // can see where the old match used to land — purely visual, never
  // a failure: if the selector no longer resolves we just skip it.
  if (args.oldSelector) {
    try {
      const loc = page.locator(args.oldSelector).first();
      const handle = await loc.elementHandle({ timeout: 1500 });
      if (handle) {
        // Runs inside the page — DOM globals exist there at runtime
        // even though the api-server's TS lib doesn't include `dom`.
        await handle.evaluate(((el: unknown) => {
          const e = el as {
            scrollIntoView: (o: { block: string; inline: string }) => void;
            style: { outline: string; outlineOffset: string };
            dataset: Record<string, string>;
          };
          e.scrollIntoView({ block: "center", inline: "center" });
          e.style.outline = "3px dashed #ef4444";
          e.style.outlineOffset = "2px";
          e.dataset.repickHighlight = "1";
        }) as (el: unknown) => void);
      }
    } catch {
      /* highlight is purely cosmetic — never fail the session for it */
    }
  }
  const buf = await page.screenshot({ type: "png", fullPage: false });
  const id = randomUUID();
  const expiresTimer = setTimeout(() => {
    cancelRepickSession({ sessionId: id }).catch(() => {});
  }, SESSION_TTL_MS);
  expiresTimer.unref?.();
  SESSIONS.set(id, {
    id,
    browser,
    page,
    viewport,
    pageUrl: args.pageUrl,
    createdAt: Date.now(),
    ownerUserId: args.ownerUserId,
    expiresTimer,
  });
  logger.info(
    { event: "selector_heal_repick_start", sessionId: id, pageUrl: args.pageUrl },
    "Re-pick session started",
  );
  return {
    sessionId: id,
    screenshotBase64: buf.toString("base64"),
    viewport,
    pageUrl: args.pageUrl,
  };
}

export interface PickArgs {
  sessionId: string;
  x: number;
  y: number;
  ownerUserId: string;
}

export interface PickResult {
  selector: string;
  strategy: string;
  text: string | null;
  screenshotBase64: string;
}

export async function pickAt(args: PickArgs): Promise<PickResult | null> {
  const session = SESSIONS.get(args.sessionId);
  if (!session || session.ownerUserId !== args.ownerUserId) return null;
  // `__recorderPickElement` is injected by RECORDER_SCRIPT. It returns
  // `{ selector, strategy, text } | null` for viewport-relative
  // coordinates. We re-screenshot afterwards so the UI can show a
  // visual confirmation (e.g. the element is now highlighted by the
  // recorder script's hover decoration).
  const result = await session.page.evaluate(
    ([px, py]: [number, number]) => {
      const w = globalThis as unknown as {
        __recorderPickElement?: (
          x: number,
          y: number,
        ) => { selector: string; strategy: string; text: string } | null;
      };
      return w.__recorderPickElement ? w.__recorderPickElement(px, py) : null;
    },
    [args.x, args.y] as [number, number],
  );
  if (!result || !result.selector) return null;
  const buf = await session.page.screenshot({ type: "png", fullPage: false });
  logger.info(
    {
      event: "selector_heal_repick_pick",
      sessionId: session.id,
      strategy: result.strategy,
    },
    "Re-pick captured selector",
  );
  return {
    selector: result.selector,
    strategy: result.strategy,
    text: result.text || null,
    screenshotBase64: buf.toString("base64"),
  };
}

export async function refreshScreenshot(args: {
  sessionId: string;
  ownerUserId: string;
}): Promise<string | null> {
  const session = SESSIONS.get(args.sessionId);
  if (!session || session.ownerUserId !== args.ownerUserId) return null;
  const buf = await session.page.screenshot({ type: "png", fullPage: false });
  return buf.toString("base64");
}

export async function cancelRepickSession(args: {
  sessionId: string;
  ownerUserId?: string;
}): Promise<boolean> {
  const session = SESSIONS.get(args.sessionId);
  if (!session) return false;
  if (args.ownerUserId !== undefined && session.ownerUserId !== args.ownerUserId) {
    return false;
  }
  clearTimeout(session.expiresTimer);
  SESSIONS.delete(args.sessionId);
  try {
    await session.browser.close();
  } catch {
    /* ignore */
  }
  logger.info(
    { event: "selector_heal_repick_cancel", sessionId: session.id },
    "Re-pick session ended",
  );
  return true;
}

export function _sessionCount(): number {
  return SESSIONS.size;
}
