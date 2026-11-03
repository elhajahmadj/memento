import { describe, it, expect } from "vitest";
import {
  buildJmxTree,
  detectCsrf,
  CSRF_VAR,
} from "@/features/jmx/infrastructure/jmxIr";
import { serializeJmxTree } from "@/features/jmx/infrastructure/jmxSerializer";
import { emitJmxXml } from "@/features/jmx/infrastructure/jmxEmitter";
import type {
  JmxExportOptions,
  JmxHttpEvent,
} from "@/features/jmx/domain/types";

function event(partial: Partial<JmxHttpEvent>): JmxHttpEvent {
  return {
    method: "GET",
    url: "https://api.example.com/items",
    headers: {},
    contentType: "",
    bodyText: "",
    statusCode: 200,
    responseBody: "",
    timestamp: 0,
    ...partial,
  };
}

const baseOptions = (
  overrides: Partial<JmxExportOptions> = {},
): JmxExportOptions => ({
  embedCredentials: false,
  jwtAuth: false,
  baseUrl: "https://api.example.com",
  csvMode: "off",
  bff: true,
  ...overrides,
});

describe("detectCsrf", () => {
  it("finds hidden form CSRF fields and lists subsequent consumers", () => {
    const events: JmxHttpEvent[] = [
      event({
        url: "https://api.example.com/form",
        responseBody: `<html><form><input type="hidden" name="_csrf" value="TOKEN-ABC-123" /></form></html>`,
      }),
      event({
        method: "POST",
        url: "https://api.example.com/submit",
        contentType: "application/x-www-form-urlencoded",
        bodyText: "_csrf=TOKEN-ABC-123&foo=bar",
      }),
    ];
    const hits = detectCsrf(events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "form",
      fieldName: "_csrf",
      value: "TOKEN-ABC-123",
      producerIdx: 0,
      consumerIdxs: [1],
    });
  });

  it("tolerates value-before-name attribute order and __RequestVerificationToken", () => {
    const events: JmxHttpEvent[] = [
      event({
        url: "https://api.example.com/page",
        responseBody: `<input type='hidden' value='AFV-9' name='__RequestVerificationToken'>`,
      }),
      event({
        method: "POST",
        url: "https://api.example.com/post",
        contentType: "application/x-www-form-urlencoded",
        bodyText: "__RequestVerificationToken=AFV-9",
      }),
    ];
    const hits = detectCsrf(events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      fieldName: "__RequestVerificationToken",
      value: "AFV-9",
    });
  });

  it("detects double-submit cookies with mixed-case headers", () => {
    const tokenValue = "abc.def.ghi-XSRF";
    const events: JmxHttpEvent[] = [
      event({
        method: "POST",
        url: "https://api.example.com/api/save",
        headers: {
          Cookie: `session=s1; XSRF-TOKEN=${tokenValue}; other=x`,
          "x-XSRF-token": tokenValue,
        },
        bodyText: '{"x":1}',
      }),
    ];
    const hits = detectCsrf(events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "cookie",
      cookieName: "XSRF-TOKEN",
      value: tokenValue,
      consumerIdxs: [0],
    });
    expect((hits[0] as { headerName: string }).headerName).toBe("x-XSRF-token");
  });

  it("returns no hits when no CSRF patterns are present", () => {
    const events: JmxHttpEvent[] = [
      event({
        url: "https://api.example.com/x",
        responseBody: `<html><input name="email" value="me@x" /></html>`,
      }),
      event({
        method: "POST",
        url: "https://api.example.com/y",
        contentType: "application/json",
        bodyText: '{"foo":"bar"}',
      }),
    ];
    expect(detectCsrf(events)).toEqual([]);
  });
});

describe("buildJmxTree CSRF emission (BFF mode)", () => {
  it("emits a form Regex Extractor on the producer and substitutes the consumer body", () => {
    const events: JmxHttpEvent[] = [
      event({
        url: "https://api.example.com/form",
        responseBody: `<input type="hidden" name="_csrf" value="HIDDEN-XYZ-9999" />`,
      }),
      event({
        method: "POST",
        url: "https://api.example.com/save",
        contentType: "application/x-www-form-urlencoded",
        bodyText: "_csrf=HIDDEN-XYZ-9999&payload=42",
      }),
    ];
    const xml = serializeJmxTree(buildJmxTree(events, baseOptions()));
    expect(xml).toContain("RegexExtractor");
    expect(xml).toContain(`CSRF extractor (form _csrf)`);
    expect(xml).toContain(`>${CSRF_VAR}<`);
    // The literal token must be gone from the consumer body and the
    // variable reference inserted in its place.
    expect(xml).not.toContain("HIDDEN-XYZ-9999");
    expect(xml).toContain("${csrf_token}");
  });

  it("emits a TG-scoped cookie Regex Extractor + a per-sampler HeaderManager with ${csrf_token}", () => {
    const tokenValue = "cookie-token-1234";
    const events: JmxHttpEvent[] = [
      event({
        method: "POST",
        url: "https://api.example.com/api/do",
        headers: {
          Cookie: `XSRF-TOKEN=${tokenValue}`,
          "X-XSRF-TOKEN": tokenValue,
        },
        contentType: "application/json",
        bodyText: '{"a":1}',
      }),
    ];
    const tree = buildJmxTree(events, baseOptions());
    const xml = serializeJmxTree(tree);
    expect(xml).toContain("CSRF extractor (cookie XSRF-TOKEN)");
    expect(xml).toContain("Set-Cookie");
    expect(xml).toContain("HTTP Header Manager (CSRF)");
    expect(xml).toContain("X-XSRF-TOKEN");
    expect(xml).toContain("${csrf_token}");
    // The TG-scoped extractor sits *above* the sampler in the tree.
    const tg = tree.testPlan.children?.[0];
    const extractorIdx = (tg?.children ?? []).findIndex(
      (c) => c.tag === "RegexExtractor",
    );
    const samplerIdx = (tg?.children ?? []).findIndex(
      (c) => c.tag === "HTTPSamplerProxy",
    );
    expect(extractorIdx).toBeGreaterThanOrEqual(0);
    expect(samplerIdx).toBeGreaterThan(extractorIdx);
  });

  it("non-BFF projects: zero behavioral change even when CSRF patterns are present", () => {
    const tokenValue = "would-be-csrf-1234";
    const events: JmxHttpEvent[] = [
      event({
        url: "https://api.example.com/form",
        responseBody: `<input type="hidden" name="_csrf" value="HIDDEN-NO-BFF-XYZ" />`,
      }),
      event({
        method: "POST",
        url: "https://api.example.com/api/do",
        headers: {
          Cookie: `XSRF-TOKEN=${tokenValue}`,
          "X-XSRF-TOKEN": tokenValue,
        },
        bodyText: "_csrf=HIDDEN-NO-BFF-XYZ&z=1",
        contentType: "application/x-www-form-urlencoded",
      }),
    ];
    const bff = serializeJmxTree(buildJmxTree(events, baseOptions({ bff: true })));
    const nonBff = serializeJmxTree(
      buildJmxTree(events, baseOptions({ bff: false })),
    );
    // Sanity: BFF path rewrote things.
    expect(bff).toContain("CSRF extractor");
    expect(bff).toContain("${csrf_token}");
    // Non-BFF: no CSRF artefacts, original token values preserved.
    expect(nonBff).not.toContain("CSRF extractor");
    expect(nonBff).not.toContain("${csrf_token}");
    expect(nonBff).toContain("HIDDEN-NO-BFF-XYZ");
    // tokenValue lives only in the request Cookie / X-XSRF-TOKEN header,
    // which the sampler doesn't bake into the plan today — so we don't
    // assert on it here. The point of this case is that the cookie
    // pattern triggers no extractor/UDV/header rewrites in non-BFF mode.
    void tokenValue;
  });

  it("emit pipeline: BFF CSRF substitution still passes the validator", () => {
    const events: JmxHttpEvent[] = [
      event({
        url: "https://api.example.com/form",
        responseBody: `<input type="hidden" name="authenticity_token" value="AUTH-7777" />`,
      }),
      event({
        method: "POST",
        url: "https://api.example.com/things",
        contentType: "application/x-www-form-urlencoded",
        bodyText: "authenticity_token=AUTH-7777&q=1",
      }),
    ];
    const out = emitJmxXml(events, baseOptions({ embedCredentials: true }));
    expect(out.validation.ok).toBe(true);
    expect(out.xml).toContain("${csrf_token}");
    expect(out.xml).not.toContain("AUTH-7777");
  });
});
