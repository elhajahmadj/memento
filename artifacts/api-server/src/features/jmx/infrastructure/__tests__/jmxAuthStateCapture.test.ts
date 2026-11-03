/**
 * Unit tests for `cdpJmxAuthStateCapturer` (task #16).
 *
 * The capturer is the JMX equivalent of Playwright's
 * `browserContext.storageState()` and has to produce a byte-compatible
 * payload so JMX-sourced `auth_states` rows are indistinguishable from
 * DOM-recorder rows in the "Reuse logged-in session" picker.
 *
 * Coverage:
 *   1. CDP cookies are mapped into the Playwright `{cookies, origins}`
 *      shape, including the `sameSite` enum mapping and the implicit
 *      "missing attribute → Lax" default.
 *   2. `Runtime.evaluate` for `localStorage` produces a populated
 *      `origins[]` entry keyed by the live page's origin.
 *   3. Empty `localStorage` produces no `origins[]` entry (don't
 *      pollute the picker with empty rows).
 *   4. about:blank / data: URLs are skipped — capture must not write
 *      a bogus origin.
 *   5. A throwing `Runtime.evaluate` does not sink cookie capture —
 *      cookies still land, `origins[]` stays empty.
 */
import { describe, expect, it, vi } from "vitest";
import {
  cdpJmxAuthStateCapturer,
  type JmxCdpClientLike,
} from "@/features/jmx/infrastructure/jmxAuthStateCapture";

function makeCdp(
  handlers: Partial<Record<string, (params?: unknown) => unknown>>,
): JmxCdpClientLike & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async (method: string, params?: unknown) => {
    const handler = handlers[method];
    if (!handler) throw new Error(`unexpected CDP method: ${method}`);
    return handler(params);
  });
  return { send } as JmxCdpClientLike & { send: ReturnType<typeof vi.fn> };
}

describe("cdpJmxAuthStateCapturer", () => {
  it("maps CDP cookies into Playwright shape and snapshots localStorage for the current origin", async () => {
    const cdp = makeCdp({
      "Network.getAllCookies": () => ({
        cookies: [
          {
            name: "session",
            value: "abc",
            domain: "example.com",
            path: "/",
            expires: 1234567890,
            httpOnly: true,
            secure: true,
            sameSite: "Strict",
          },
          {
            // Missing sameSite — must default to "Lax".
            name: "csrf",
            value: "xyz",
            domain: ".example.com",
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
          },
        ],
      }),
      "Runtime.evaluate": () => ({
        result: {
          value: JSON.stringify([
            { name: "token", value: "jwt-1" },
            { name: "user", value: "alice" },
          ]),
        },
      }),
    });

    const out = await cdpJmxAuthStateCapturer.capture(cdp, {
      currentUrl: "https://example.com/dashboard",
    });

    expect(out.cookies).toEqual([
      {
        name: "session",
        value: "abc",
        domain: "example.com",
        path: "/",
        expires: 1234567890,
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
      },
      {
        name: "csrf",
        value: "xyz",
        domain: ".example.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    expect(out.origins).toEqual([
      {
        origin: "https://example.com",
        localStorage: [
          { name: "token", value: "jwt-1" },
          { name: "user", value: "alice" },
        ],
      },
    ]);
  });

  it("omits the origins entry when localStorage is empty", async () => {
    const cdp = makeCdp({
      "Network.getAllCookies": () => ({ cookies: [] }),
      "Runtime.evaluate": () => ({
        result: { value: JSON.stringify([]) },
      }),
    });

    const out = await cdpJmxAuthStateCapturer.capture(cdp, {
      currentUrl: "https://example.com/",
    });
    expect(out.cookies).toEqual([]);
    expect(out.origins).toEqual([]);
  });

  it("skips localStorage capture for about:blank / non-http origins", async () => {
    const evaluated = vi.fn();
    const cdp = makeCdp({
      "Network.getAllCookies": () => ({ cookies: [] }),
      "Runtime.evaluate": () => {
        evaluated();
        return { result: { value: "[]" } };
      },
    });

    const out = await cdpJmxAuthStateCapturer.capture(cdp, {
      currentUrl: "about:blank",
    });
    expect(out.origins).toEqual([]);
    expect(evaluated).not.toHaveBeenCalled();
  });

  it("swallows Runtime.evaluate failures without losing cookie capture", async () => {
    const cdp = makeCdp({
      "Network.getAllCookies": () => ({
        cookies: [
          {
            name: "session",
            value: "abc",
            domain: "example.com",
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: "Lax",
          },
        ],
      }),
      "Runtime.evaluate": () => {
        throw new Error("target closed");
      },
    });

    const out = await cdpJmxAuthStateCapturer.capture(cdp, {
      currentUrl: "https://example.com/",
    });
    expect(out.cookies).toHaveLength(1);
    expect(out.origins).toEqual([]);
  });

  it("handles a null currentUrl by producing no origins[] entry", async () => {
    const cdp = makeCdp({
      "Network.getAllCookies": () => ({ cookies: [] }),
    });
    const out = await cdpJmxAuthStateCapturer.capture(cdp, {
      currentUrl: null,
    });
    expect(out).toEqual({ cookies: [], origins: [] });
  });
});
