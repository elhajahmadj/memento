/**
 * Pure decision helper for the JMX recorder's "should I persist this
 * response body?" gate.
 *
 * Centralised here (rather than inlined in `jmxRecordingService`) so
 * the rule is testable in isolation and is the single point future
 * correlation slices (PKCE/state, CSRF, storageState) can extend
 * without re-deriving the same content-type / size / redirect logic.
 *
 * The rule has three inputs that interact:
 *  - The project's `bff` flag. Non-BFF projects keep the historical
 *    behavior: redirect bodies are NOT captured (they're almost
 *    always empty and just bloat the row). BFF projects need them —
 *    the OAuth/OIDC authorize step's HTML carries the `state`/`nonce`
 *    the downstream PKCE correlator extracts.
 *  - The response `Content-Type`. We only persist text payloads we
 *    can reason about later: HTML, JSON, form-urlencoded. Binary
 *    blobs (images, fonts, octet-stream) are dropped to keep the
 *    captured-events JSONB column from ballooning.
 *  - Body size. A configurable cap (default `MAX_RESPONSE_BODY_BYTES`)
 *    truncates oversized bodies; the truncation is observable via
 *    `BODY_TRUNCATION_MARKER` rather than silently discarded.
 *
 * Pure, framework-free, side-effect-free.
 */
import {
  BODY_TRUNCATION_MARKER,
  MAX_RESPONSE_BODY_BYTES,
} from "@/features/jmx/domain/types";

export interface ShouldCaptureBodyInput {
  /** Response headers, lower-cased keys preferred but tolerated otherwise. */
  headers: Record<string, string>;
  /** HTTP status code (0 when unknown). */
  status: number;
  /**
   * `true` when the recording's project is flagged BFF — the only
   * mode in which 3xx redirect bodies are captured.
   */
  bff: boolean;
}

export type ShouldCaptureBodyDecision =
  | { capture: true }
  | {
      capture: false;
      /** Stable reason tag — useful in logs and tests. */
      reason:
        | "redirect_non_bff"
        | "unsupported_content_type"
        | "redirect_unsupported_content_type";
    };

/**
 * Decide whether the recorder should attempt to persist the response
 * body for a captured request. See module-level doc for the rules.
 */
export function shouldCaptureBody(
  input: ShouldCaptureBodyInput,
): ShouldCaptureBodyDecision {
  const headers = lowerCaseHeaders(input.headers);
  const contentType = (headers["content-type"] ?? "").toLowerCase();
  const isRedirect = input.status >= 300 && input.status < 400;
  const typeAllowed = isAllowedTextContentType(contentType);

  if (isRedirect) {
    if (!input.bff) return { capture: false, reason: "redirect_non_bff" };
    // 3xx responses often carry no Content-Type at all. Allow those
    // through on BFF projects (the body, if any, is the IdP's
    // interstitial HTML); only refuse when CT is set AND not a text
    // type we understand.
    if (contentType && !typeAllowed) {
      return { capture: false, reason: "redirect_unsupported_content_type" };
    }
    return { capture: true };
  }

  if (!typeAllowed) {
    return { capture: false, reason: "unsupported_content_type" };
  }
  return { capture: true };
}

/**
 * Apply the size cap to a captured body. Returns the original body
 * unchanged when within budget, otherwise truncates to
 * `maxBytes - BODY_TRUNCATION_MARKER.byteLength` and appends the
 * marker. Operates on UTF-8 byte length so the cap is honored even
 * when the input contains multi-byte characters.
 */
export function applyBodySizeCap(
  body: string,
  maxBytes: number = MAX_RESPONSE_BODY_BYTES,
): string {
  if (typeof body !== "string" || body.length === 0) return body;
  const buf = Buffer.from(body, "utf8");
  if (buf.byteLength <= maxBytes) return body;
  const headroom = Math.max(0, maxBytes - Buffer.byteLength(BODY_TRUNCATION_MARKER, "utf8"));
  // Slice on byte boundary, then decode with `fatal: false` (default)
  // so any split multi-byte char is replaced rather than throwing.
  const sliced = buf.subarray(0, headroom).toString("utf8");
  return sliced + BODY_TRUNCATION_MARKER;
}

/** Case-insensitive lookup of the `Location` response header. */
export function readLocationHeader(
  headers: Record<string, string> | undefined,
): string {
  if (!headers) return "";
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "location" && typeof v === "string") return v;
  }
  return "";
}

function isAllowedTextContentType(ct: string): boolean {
  if (!ct) return false;
  return (
    ct.includes("text/html") ||
    ct.includes("application/json") ||
    ct.includes("+json") ||
    ct.includes("application/x-www-form-urlencoded")
  );
}

function lowerCaseHeaders(
  raw: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = v;
  return out;
}
