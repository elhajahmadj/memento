/**
 * JSONB-safe sanitiser for captured `JmxHttpEvent` payloads.
 *
 * Postgres' `jsonb` type refuses two classes of characters that the
 * Chromium recorder can plausibly capture verbatim from the wire:
 *
 *  1. U+0000 (`\u0000`) null bytes. Real-world response bodies —
 *     gzipped HTML re-decoded by CDP, inline binary fragments, the
 *     occasional header value — contain them. Any single null byte
 *     anywhere in the persisted JSON fails the whole row update with
 *     `unsupported Unicode escape sequence … \u0000 cannot be
 *     converted to text`, which historically returned a 500 with the
 *     raw Drizzle SQL dumped into the response body (task #25).
 *  2. Lone UTF-16 surrogates (high without matching low, or vice
 *     versa). These can't be encoded to valid UTF-8, so JSON
 *     serialisation either throws or emits an invalid string that
 *     Postgres later rejects.
 *
 * We walk every string-valued field of every event and replace each
 * offending code unit with U+FFFD (REPLACEMENT CHARACTER). U+FFFD is
 * a single-code-unit character so length-sensitive downstream code
 * (the PKCE correlator's index math, the body-size cap, the
 * generated JMeter sampler bodies) keeps working without silent
 * wholesale truncation. Lone surrogates *are* expanded 1→1 as well —
 * we only swap the orphan unit, not the whole pair.
 *
 * The sanitiser is applied in `finalizeSessionRow` so every persist
 * path — armed stop, preview-only stop, and any future caller — is
 * covered without each having to remember.
 */
import type { JmxHttpEvent } from "@/features/jmx/domain/types";

const REPLACEMENT = "\uFFFD";

/**
 * Scrub a single string of JSONB-hostile code units (null bytes,
 * lone UTF-16 surrogates). Preserves length so callers that have
 * already size-bounded the input stay within budget.
 */
export function sanitizeJsonbString(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;
  let needsRewrite = false;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 0) {
      needsRewrite = true;
      break;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        needsRewrite = true;
        break;
      }
      i++; // valid surrogate pair, skip the low half
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      needsRewrite = true;
      break;
    }
  }
  if (!needsRewrite) return input;

  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 0) {
      out += REPLACEMENT;
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i]! + input[i + 1]!;
        i++;
        continue;
      }
      out += REPLACEMENT;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += REPLACEMENT;
      continue;
    }
    out += input[i];
  }
  return out;
}

function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = sanitizeJsonbString(v);
  }
  return out;
}

/**
 * Return a copy of `events` with every JSONB-hostile string field
 * scrubbed. Non-string fields (`statusCode`, `timestamp`) pass
 * through unchanged.
 */
export function sanitizeJmxEvents(events: JmxHttpEvent[]): JmxHttpEvent[] {
  return events.map((ev) => {
    const sanitized: JmxHttpEvent = {
      method: sanitizeJsonbString(ev.method),
      url: sanitizeJsonbString(ev.url),
      headers: sanitizeHeaders(ev.headers),
      contentType: sanitizeJsonbString(ev.contentType),
      bodyText: sanitizeJsonbString(ev.bodyText),
      statusCode: ev.statusCode,
      responseBody: sanitizeJsonbString(ev.responseBody),
      timestamp: ev.timestamp,
    };
    if (ev.locationHeader !== undefined) {
      sanitized.locationHeader = sanitizeJsonbString(ev.locationHeader);
    }
    return sanitized;
  });
}
