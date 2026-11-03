/**
 * JMX-side equivalent of the Playwright recorder's `captureAndSaveAuthState`.
 *
 * The DOM recorder calls `browserContext.storageState()` which gives
 * back the canonical Playwright shape (`{ cookies, origins[] }`). The
 * JMX recorder doesn't drive the browser through Playwright's high-
 * level API — it only owns a CDP session attached to a Chromium page
 * — so the same snapshot has to be reconstructed by hand:
 *
 *   - `Network.getAllCookies` gives the full cookie jar across every
 *     origin the recorded session touched (this is what Playwright
 *     uses internally too, so the shapes line up after a small
 *     `sameSite` enum mapping).
 *   - `Runtime.evaluate` on the current page reads its `localStorage`
 *     for the live origin. We deliberately only snapshot the live
 *     origin's storage — capturing every same-process origin would
 *     require iframe-walking and is out of scope (see task #16
 *     "out of scope").
 *
 * The output is byte-compatible with Playwright's `storageState()`
 * payload so `auth_states.state` rows written from a JMX session are
 * indistinguishable from DOM-recorder rows downstream — the "Reuse
 * logged-in session" surface works without any per-source branching.
 */
import type { CDPSession, Page } from "playwright";

export interface JmxStorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface JmxStorageOrigin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

export interface JmxStorageState {
  cookies: JmxStorageCookie[];
  origins: JmxStorageOrigin[];
}

export interface JmxAuthCaptureContext {
  /** URL of the recorder's live page; used to scope `localStorage` capture. */
  currentUrl: string | null;
}

/**
 * Narrow surface of `CDPSession.send` actually used here. Kept loose so
 * tests can pass a hand-rolled stub without depending on Playwright.
 */
export interface JmxCdpClientLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface JmxAuthStateCapturer {
  capture(
    cdp: JmxCdpClientLike,
    ctx: JmxAuthCaptureContext,
  ): Promise<JmxStorageState>;
}

interface CdpRawCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

function normalizeSameSite(raw: string | undefined): "Strict" | "Lax" | "None" {
  // CDP returns "Strict" | "Lax" | "None" | undefined (cookie with no
  // SameSite attribute). Playwright defaults the missing case to "Lax"
  // when re-applying via storageState, which is the modern browser
  // default, so we mirror that here.
  if (raw === "Strict" || raw === "Lax" || raw === "None") return raw;
  return "Lax";
}

function cdpCookieToPlaywright(raw: CdpRawCookie): JmxStorageCookie {
  return {
    name: raw.name,
    value: raw.value,
    domain: raw.domain,
    path: raw.path,
    expires: typeof raw.expires === "number" ? raw.expires : -1,
    httpOnly: Boolean(raw.httpOnly),
    secure: Boolean(raw.secure),
    sameSite: normalizeSameSite(raw.sameSite),
  };
}

const LOCAL_STORAGE_SNAPSHOT_JS = `JSON.stringify(
  Object.keys(window.localStorage).map((k) => ({
    name: k,
    value: window.localStorage.getItem(k) ?? "",
  }))
)`;

/**
 * Default CDP-backed implementation. Production code wires this into
 * the JMX recording service's stop path; tests inject their own
 * implementation via `setJmxAuthStateCapturerForTests`.
 */
export const cdpJmxAuthStateCapturer: JmxAuthStateCapturer = {
  async capture(cdp, ctx) {
    const rawCookies = (await cdp.send("Network.getAllCookies")) as {
      cookies?: CdpRawCookie[];
    };
    const cookies = Array.isArray(rawCookies?.cookies)
      ? rawCookies.cookies.map(cdpCookieToPlaywright)
      : [];

    const origins: JmxStorageOrigin[] = [];
    const url = ctx.currentUrl?.trim();
    if (url) {
      let origin: string | null = null;
      try {
        origin = new URL(url).origin;
      } catch {
        origin = null;
      }
      // about:blank / data: URLs have no usable origin — skip rather
      // than write a bogus row.
      if (origin && /^https?:\/\//.test(origin)) {
        try {
          const evalResult = (await cdp.send("Runtime.evaluate", {
            expression: LOCAL_STORAGE_SNAPSHOT_JS,
            returnByValue: true,
          })) as { result?: { value?: unknown } };
          const value = evalResult?.result?.value;
          if (typeof value === "string") {
            const parsed = JSON.parse(value) as unknown;
            if (Array.isArray(parsed)) {
              const items = parsed
                .filter(
                  (e): e is { name: unknown; value: unknown } =>
                    typeof e === "object" && e !== null,
                )
                .map((e) => ({
                  name: String(e.name ?? ""),
                  value: String(e.value ?? ""),
                }))
                .filter((e) => e.name !== "");
              if (items.length > 0) {
                origins.push({ origin, localStorage: items });
              }
            }
          }
        } catch {
          // Page may have navigated away or be cross-origin under a
          // strict CSP — leave origins empty rather than fail the
          // whole capture.
        }
      }
    }

    return { cookies, origins };
  },
};

/**
 * Helper used by the JMX recording service so the unit test for
 * `cdpJmxAuthStateCapturer` doesn't need a real `CDPSession` /
 * `Page`. Production callers pass the live `CDPSession`.
 */
export function safePageUrl(page: Pick<Page, "url"> | null): string | null {
  if (!page) return null;
  try {
    const url = page.url();
    return typeof url === "string" && url ? url : null;
  } catch {
    return null;
  }
}

/** Re-export the Playwright type alias so callers don't import it twice. */
export type { CDPSession };
