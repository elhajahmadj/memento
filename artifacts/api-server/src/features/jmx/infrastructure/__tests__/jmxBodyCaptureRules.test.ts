/**
 * Unit tests for the pure body-capture decision helper that drives
 * the JMX recorder's "should I persist this response body?" gate.
 *
 * The matrix the helper has to honor:
 *  - non-BFF project + 3xx  → skip (preserves pre-task #13 behavior)
 *  - BFF project     + 3xx  → capture (OAuth/IdP HTML needed for
 *                              downstream PKCE/state correlation)
 *  - any project    + 2xx html/json/form-urlencoded → capture
 *  - any project    + 2xx binary (octet-stream, image, …)        → skip
 *  - oversize body  → truncated with marker, never silently dropped
 */
import { describe, it, expect } from "vitest";
import {
  applyBodySizeCap,
  readLocationHeader,
  shouldCaptureBody,
} from "@/features/jmx/infrastructure/jmxBodyCaptureRules";
import {
  BODY_TRUNCATION_MARKER,
  MAX_RESPONSE_BODY_BYTES,
} from "@/features/jmx/domain/types";

describe("shouldCaptureBody", () => {
  it("captures 2xx HTML on any project", () => {
    expect(
      shouldCaptureBody({
        headers: { "content-type": "text/html; charset=utf-8" },
        status: 200,
        bff: false,
      }),
    ).toEqual({ capture: true });
    expect(
      shouldCaptureBody({
        headers: { "content-type": "text/html" },
        status: 200,
        bff: true,
      }),
    ).toEqual({ capture: true });
  });

  it("captures 2xx JSON and +json variants", () => {
    expect(
      shouldCaptureBody({
        headers: { "content-type": "application/json" },
        status: 200,
        bff: false,
      }),
    ).toEqual({ capture: true });
    expect(
      shouldCaptureBody({
        headers: { "content-type": "application/problem+json" },
        status: 200,
        bff: false,
      }),
    ).toEqual({ capture: true });
  });

  it("captures 2xx form-urlencoded (OAuth token responses)", () => {
    expect(
      shouldCaptureBody({
        headers: { "content-type": "application/x-www-form-urlencoded" },
        status: 200,
        bff: true,
      }),
    ).toEqual({ capture: true });
  });

  it("skips 2xx binary content-types regardless of bff flag", () => {
    for (const bff of [false, true]) {
      expect(
        shouldCaptureBody({
          headers: { "content-type": "application/octet-stream" },
          status: 200,
          bff,
        }),
      ).toEqual({ capture: false, reason: "unsupported_content_type" });
      expect(
        shouldCaptureBody({
          headers: { "content-type": "image/png" },
          status: 200,
          bff,
        }),
      ).toEqual({ capture: false, reason: "unsupported_content_type" });
    }
  });

  it("skips 3xx redirects on non-BFF projects (pre-task #13 behavior)", () => {
    expect(
      shouldCaptureBody({
        headers: { "content-type": "text/html" },
        status: 302,
        bff: false,
      }),
    ).toEqual({ capture: false, reason: "redirect_non_bff" });
    // Even an empty CT redirect is dropped on non-BFF.
    expect(
      shouldCaptureBody({ headers: {}, status: 301, bff: false }),
    ).toEqual({ capture: false, reason: "redirect_non_bff" });
  });

  it("captures 3xx redirect bodies on BFF projects", () => {
    expect(
      shouldCaptureBody({
        headers: { "content-type": "text/html; charset=utf-8" },
        status: 302,
        bff: true,
      }),
    ).toEqual({ capture: true });
    // No Content-Type set (common on bare 302s) — captured anyway,
    // the body may still be the IdP's interstitial HTML.
    expect(
      shouldCaptureBody({ headers: {}, status: 302, bff: true }),
    ).toEqual({ capture: true });
  });

  it("on BFF projects still refuses 3xx bodies advertised as binary", () => {
    expect(
      shouldCaptureBody({
        headers: { "content-type": "image/png" },
        status: 302,
        bff: true,
      }),
    ).toEqual({ capture: false, reason: "redirect_unsupported_content_type" });
  });

  it("is case-insensitive on header names", () => {
    expect(
      shouldCaptureBody({
        headers: { "Content-Type": "application/json" },
        status: 200,
        bff: false,
      }),
    ).toEqual({ capture: true });
  });
});

describe("applyBodySizeCap", () => {
  it("returns the body untouched when within budget", () => {
    expect(applyBodySizeCap("hello")).toBe("hello");
    expect(applyBodySizeCap("")).toBe("");
  });

  it("truncates oversize bodies and appends the truncation marker", () => {
    const oversize = "x".repeat(MAX_RESPONSE_BODY_BYTES + 1024);
    const capped = applyBodySizeCap(oversize);
    expect(capped.endsWith(BODY_TRUNCATION_MARKER)).toBe(true);
    expect(Buffer.byteLength(capped, "utf8")).toBeLessThanOrEqual(
      MAX_RESPONSE_BODY_BYTES,
    );
    // Original prefix preserved.
    expect(capped.startsWith("xxxx")).toBe(true);
  });

  it("honors a custom byte cap larger than the marker", () => {
    const markerBytes = Buffer.byteLength(BODY_TRUNCATION_MARKER, "utf8");
    const cap = markerBytes + 16;
    const body = "abcdefghijklmnopqrstuvwxyz".repeat(10);
    const capped = applyBodySizeCap(body, cap);
    expect(capped.endsWith(BODY_TRUNCATION_MARKER)).toBe(true);
    expect(Buffer.byteLength(capped, "utf8")).toBeLessThanOrEqual(cap);
  });
});

describe("readLocationHeader", () => {
  it("reads Location case-insensitively", () => {
    expect(readLocationHeader({ Location: "/next" })).toBe("/next");
    expect(readLocationHeader({ location: "https://idp/auth" })).toBe(
      "https://idp/auth",
    );
  });

  it("returns empty string when absent", () => {
    expect(readLocationHeader({})).toBe("");
    expect(readLocationHeader(undefined)).toBe("");
  });
});
