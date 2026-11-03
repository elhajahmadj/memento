import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  allowedOrigins,
  describeAllowedOrigins,
  isOriginAllowed,
} from "@/shared/security/origins";

/**
 * Cross-origin allow-list (audit findings C-3 and H-1).
 *
 * The regressions these tests exist for:
 *  - CORS reflected any `Origin` back with `credentials: true`, letting
 *    any website read authenticated API responses.
 *  - WebSocket upgrades checked no `Origin` at all, so a malicious page
 *    could open an authenticated socket (cross-site WS hijacking).
 *
 * The single rule both now share: an `Origin` that is present and not
 * allow-listed is REJECTED, never reflected.
 */

let saved: string | undefined;

beforeEach(() => {
  saved = process.env.CORS_ALLOWED_ORIGINS;
});

afterEach(() => {
  if (saved === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
  else process.env.CORS_ALLOWED_ORIGINS = saved;
});

describe("isOriginAllowed", () => {
  it("allows a missing Origin (same-origin navigation, curl, server-to-server)", () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed(null)).toBe(true);
    expect(isOriginAllowed("")).toBe(true);
  });

  it("rejects an arbitrary cross-origin when nothing is allow-listed", () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    expect(isOriginAllowed("https://evil.example")).toBe(false);
  });

  it("allows an explicitly allow-listed origin", () => {
    process.env.CORS_ALLOWED_ORIGINS = "http://localhost:5173";
    expect(isOriginAllowed("http://localhost:5173")).toBe(true);
  });

  it("still rejects everything not on a non-empty allow-list", () => {
    process.env.CORS_ALLOWED_ORIGINS = "http://localhost:5173";
    expect(isOriginAllowed("https://evil.example")).toBe(false);
  });

  it("accepts a comma-separated list with surrounding whitespace", () => {
    process.env.CORS_ALLOWED_ORIGINS =
      " http://localhost:5173 , https://memento.example ";
    expect(isOriginAllowed("http://localhost:5173")).toBe(true);
    expect(isOriginAllowed("https://memento.example")).toBe(true);
    expect(isOriginAllowed("https://other.example")).toBe(false);
  });

  it("ignores a path on a configured entry and matches on scheme+host+port", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://memento.example/some/path";
    expect(isOriginAllowed("https://memento.example")).toBe(true);
  });

  it("is case-insensitive on scheme and host", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://Memento.Example";
    expect(isOriginAllowed("HTTPS://memento.example")).toBe(true);
  });

  it("treats a different port as a different origin", () => {
    process.env.CORS_ALLOWED_ORIGINS = "http://localhost:5173";
    expect(isOriginAllowed("http://localhost:5174")).toBe(false);
  });

  it("rejects an opaque or malformed Origin rather than trying to match it", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://memento.example";
    // Sandboxed iframes and file:// pages send the literal string "null".
    expect(isOriginAllowed("null")).toBe(false);
    expect(isOriginAllowed("not-a-url")).toBe(false);
  });

  it("allows the request's own host without configuration (production same-origin SPA)", () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    expect(
      isOriginAllowed("https://memento-playwright.fly.dev", "memento-playwright.fly.dev"),
    ).toBe(true);
  });

  it("allows same-host even when the Origin scheme differs from the inbound scheme", () => {
    // The Fly edge terminates TLS, so the browser says https while the
    // request reaching Express may be http.
    delete process.env.CORS_ALLOWED_ORIGINS;
    expect(isOriginAllowed("https://app.example", "app.example")).toBe(true);
  });

  it("does not treat a different host as same-origin", () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    expect(isOriginAllowed("https://evil.example", "app.example")).toBe(false);
  });
});

describe("allowedOrigins", () => {
  it("re-parses when the env var changes", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://a.example";
    expect([...allowedOrigins()]).toEqual(["https://a.example"]);
    process.env.CORS_ALLOWED_ORIGINS = "https://b.example";
    expect([...allowedOrigins()]).toEqual(["https://b.example"]);
  });

  it("drops unparseable entries instead of failing open", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://good.example,,garbage,   ";
    expect([...allowedOrigins()]).toEqual(["https://good.example"]);
  });
});

describe("describeAllowedOrigins", () => {
  it("says so explicitly when nothing is configured", () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    expect(describeAllowedOrigins()).toContain("only same-origin");
  });

  it("lists the configured origins", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://a.example";
    expect(describeAllowedOrigins()).toContain("https://a.example");
  });
});
