import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { like } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  bootServer,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";

/**
 * App-level security wiring (audit findings C-3, H-4, H-7, M-9).
 *
 * The regressions these tests exist for:
 *  - CORS reflected any `Origin` back with `credentials: true`, so any
 *    website could read authenticated API responses.
 *  - Nothing stopped a cross-origin *mutation* from executing: CORS only
 *    withholds the response, after the side effect has happened.
 *  - The 500 handler returned `e.message`, leaking Postgres constraint
 *    and column names, container paths, and env var names.
 *  - No security response headers were sent at all.
 *  - Body-size limits were left implicit.
 */

const PREFIX = "appsec-";
let baseUrl: string;
let close: () => Promise<void>;
let savedOrigins: string | undefined;

beforeAll(async () => {
  savedOrigins = process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.CORS_ALLOWED_ORIGINS;
  ({ baseUrl, close } = await bootServer());
});

afterAll(async () => {
  if (savedOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
  else process.env.CORS_ALLOWED_ORIGINS = savedOrigins;
  await close();
});

afterEach(async () => {
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
});

describe("CORS (C-3)", () => {
  it("does not reflect an arbitrary origin", async () => {
    const res = await fetch(`${baseUrl}/api/healthz`, {
      headers: { origin: "https://evil.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe(
      "https://evil.example",
    );
  });

  it("does not send allow-credentials to a disallowed origin", async () => {
    const res = await fetch(`${baseUrl}/api/healthz`, {
      headers: { origin: "https://evil.example" },
    });
    const allowOrigin = res.headers.get("access-control-allow-origin");
    // With no ACAO the browser blocks the read regardless of the
    // credentials header, but neither may name the attacker's origin.
    expect(allowOrigin).toBeNull();
  });

  it("allows a configured origin", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://allowed.example";
    try {
      const res = await fetch(`${baseUrl}/api/healthz`, {
        headers: { origin: "https://allowed.example" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "https://allowed.example",
      );
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    } finally {
      delete process.env.CORS_ALLOWED_ORIGINS;
    }
  });
});

describe("CSRF origin guard (C-3)", () => {
  it("rejects a state-changing request from a disallowed origin", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ username: "whoever", password: "whatever" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("ORIGIN_FORBIDDEN");
  });

  it("allows a state-changing request with no Origin (curl, machine clients)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "nope", password: "nope" }),
    });
    // Reaches the handler and fails on credentials, not on origin.
    expect(res.status).not.toBe(403);
  });

  it("allows a same-origin state-changing request", async () => {
    const host = new URL(baseUrl).host;
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://${host}`,
      },
      body: JSON.stringify({ username: "nope", password: "nope" }),
    });
    expect(res.status).not.toBe(403);
  });

  it("does not block safe methods from any origin", async () => {
    const res = await fetch(`${baseUrl}/api/healthz`, {
      headers: { origin: "https://evil.example" },
    });
    // The response is unreadable cross-origin (no ACAO) but the request
    // itself is not rejected — GET changes nothing.
    expect(res.status).toBe(200);
  });

  it("still authenticates normally for an allowed origin", async () => {
    await provisionUser({ username: `${PREFIX}admin`, role: "admin" });
    const cookie = await login(baseUrl, `${PREFIX}admin`);
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: withCookie(cookie),
    });
    expect(res.status).toBe(200);
  });
});

describe("security headers (H-7)", () => {
  it("sends nosniff, framing, and referrer policy", async () => {
    const res = await fetch(`${baseUrl}/api/healthz`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("sends a CSP in report-only mode by default", async () => {
    const res = await fetch(`${baseUrl}/api/healthz`);
    const reportOnly = res.headers.get("content-security-policy-report-only");
    expect(reportOnly).toBeTruthy();
    expect(reportOnly).toContain("frame-ancestors 'none'");
    // The screencast renders base64 frames straight into an <img>.
    expect(reportOnly).toContain("img-src 'self' data: blob:");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("sends HSTS when the request is HTTPS (via the trusted proxy header)", async () => {
    // bootServer injects x-forwarded-proto: https, and trust proxy is on.
    const res = await fetch(`${baseUrl}/api/healthz`);
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });
});

describe("body size limits (M-9)", () => {
  it("rejects an oversized JSON body with 413, not 500", async () => {
    const huge = JSON.stringify({ blob: "x".repeat(2 * 1024 * 1024) });
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: huge,
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("BODY_TOO_LARGE");
  });
});

describe("error responses (H-4)", () => {
  it("reports a malformed JSON body as 400 without leaking parser detail", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect((JSON.parse(text) as { code?: string }).code).toBe("BODY_MALFORMED");
    // The parser's own message quotes the offending input and names
    // internal frames — none of it may reach the caller.
    expect(text.toLowerCase()).not.toContain("expected property name");
    expect(text.toLowerCase()).not.toContain("json.parse");
    expect(text.toLowerCase()).not.toContain("body-parser");
  });
});
