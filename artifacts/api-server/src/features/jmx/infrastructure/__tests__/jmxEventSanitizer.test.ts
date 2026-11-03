/**
 * Unit tests for the JSONB-safe sanitiser that scrubs captured
 * `JmxHttpEvent`s before they are written to `jmx_recording_sessions`.
 *
 * Regression coverage for task #25: a JMX recording with auto-
 * captured traffic containing `\u0000` (Chromium response body / a
 * header value) used to fail the Drizzle update with
 * `unsupported Unicode escape sequence … \u0000 cannot be converted
 * to text`. The sanitiser replaces every JSONB-hostile code unit
 * with U+FFFD so the row persists.
 */
import { describe, it, expect } from "vitest";
import type { JmxHttpEvent } from "@/features/jmx/domain/types";
import {
  sanitizeJmxEvents,
  sanitizeJsonbString,
} from "@/features/jmx/infrastructure/jmxEventSanitizer";

function ev(overrides: Partial<JmxHttpEvent> = {}): JmxHttpEvent {
  return {
    method: "GET",
    url: "https://example.com/",
    headers: {},
    contentType: "",
    bodyText: "",
    statusCode: 200,
    responseBody: "",
    timestamp: 0,
    ...overrides,
  };
}

describe("sanitizeJsonbString", () => {
  it("returns the same string when there is nothing to scrub", () => {
    const s = "plain ascii + UTF-8 ✓ é 漢字";
    expect(sanitizeJsonbString(s)).toBe(s);
  });

  it("replaces an embedded null byte with U+FFFD and preserves length", () => {
    const s = "abc\u0000def";
    const out = sanitizeJsonbString(s);
    expect(out).toBe("abc\uFFFDdef");
    expect(out.length).toBe(s.length);
  });

  it("replaces a lone high surrogate with U+FFFD", () => {
    // U+D800 with no trailing low surrogate.
    const s = `pre${String.fromCharCode(0xd800)}post`;
    const out = sanitizeJsonbString(s);
    expect(out).toBe("pre\uFFFDpost");
    expect(out.length).toBe(s.length);
  });

  it("replaces a lone low surrogate with U+FFFD", () => {
    const s = `pre${String.fromCharCode(0xdc00)}post`;
    expect(sanitizeJsonbString(s)).toBe("pre\uFFFDpost");
  });

  it("preserves a valid surrogate pair (astral code point)", () => {
    // U+1F600 GRINNING FACE encodes as D83D DE00.
    const s = "hi 😀!";
    expect(sanitizeJsonbString(s)).toBe(s);
  });

  it("scrubs multiple bad code units in one pass", () => {
    const s = `a\u0000b${String.fromCharCode(0xd800)}c\u0000d`;
    expect(sanitizeJsonbString(s)).toBe("a\uFFFDb\uFFFDc\uFFFDd");
  });

  it("returns empty string untouched", () => {
    expect(sanitizeJsonbString("")).toBe("");
  });
});

describe("sanitizeJmxEvents", () => {
  it("scrubs null bytes from a header value", () => {
    const events = [
      ev({
        headers: { "x-trace": "abc\u0000def", "content-type": "text/html" },
      }),
    ];
    const out = sanitizeJmxEvents(events);
    expect(out[0]!.headers["x-trace"]).toBe("abc\uFFFDdef");
    expect(out[0]!.headers["content-type"]).toBe("text/html");
  });

  it("scrubs null bytes from responseBody", () => {
    const events = [ev({ responseBody: "<html>\u0000</html>" })];
    const out = sanitizeJmxEvents(events);
    expect(out[0]!.responseBody).toBe("<html>\uFFFD</html>");
  });

  it("scrubs lone surrogates from bodyText, url, and locationHeader", () => {
    const lone = String.fromCharCode(0xd800);
    const events = [
      ev({
        url: `https://example.com/?q=${lone}`,
        bodyText: `payload${lone}`,
        locationHeader: `/next?to=${lone}`,
      }),
    ];
    const out = sanitizeJmxEvents(events);
    expect(out[0]!.url).toBe("https://example.com/?q=\uFFFD");
    expect(out[0]!.bodyText).toBe("payload\uFFFD");
    expect(out[0]!.locationHeader).toBe("/next?to=\uFFFD");
  });

  it("leaves clean events byte-identical (no needless copies of strings)", () => {
    const events = [ev({ responseBody: "<html>ok</html>" })];
    const out = sanitizeJmxEvents(events);
    expect(out[0]!.responseBody).toBe(events[0]!.responseBody);
  });

  it("preserves numeric fields untouched", () => {
    const events = [ev({ statusCode: 302, timestamp: 1717171717171 })];
    const out = sanitizeJmxEvents(events);
    expect(out[0]!.statusCode).toBe(302);
    expect(out[0]!.timestamp).toBe(1717171717171);
  });

  it("omits locationHeader when the source event omitted it", () => {
    const events = [ev()];
    const out = sanitizeJmxEvents(events);
    expect(out[0]!.locationHeader).toBeUndefined();
  });

  it("yields a JSON.stringify-able payload even when input was hostile", () => {
    const events = [
      ev({
        headers: { "x-trace": "abc\u0000" },
        responseBody: `body${String.fromCharCode(0xd800)}tail`,
      }),
    ];
    const out = sanitizeJmxEvents(events);
    expect(() => JSON.stringify(out)).not.toThrow();
    const round = JSON.parse(JSON.stringify(out)) as JmxHttpEvent[];
    expect(round[0]!.headers["x-trace"]).toBe("abc\uFFFD");
  });
});
