import { describe, it, expect } from "vitest";
import {
  buildJmxTree,
  detectOAuthFlow,
  OAUTH_CODE_VAR,
  OAUTH_NONCE_VAR,
  OAUTH_STATE_VAR,
  PKCE_CHALLENGE_VAR,
  PKCE_VERIFIER_VAR,
  replaceLiterals,
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
    url: "https://app.example.com/",
    headers: {},
    contentType: "",
    bodyText: "",
    statusCode: 200,
    responseBody: "",
    timestamp: 0,
    ...partial,
  };
}

const STATE = "STATE-1234567890";
const NONCE = "NONCE-1234567890";
const CODE = "CODE-1234567890ABCDEF";
const CHALLENGE = "CHAL-1234567890ABCDEF";
const VERIFIER = "VERIFIER-1234567890ABCDEF";

function fullOauthEvents(opts: { pkce: boolean }): JmxHttpEvent[] {
  const authorizeUrl =
    `https://idp.example.com/oauth/authorize?response_type=code&client_id=bff` +
    `&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&state=${STATE}&nonce=${NONCE}` +
    (opts.pkce ? `&code_challenge=${CHALLENGE}&code_challenge_method=S256` : "");
  const callbackUrl =
    `https://app.example.com/callback?code=${CODE}&state=${STATE}&nonce=${NONCE}`;
  const tokenBody = opts.pkce
    ? `grant_type=authorization_code&code=${CODE}&code_verifier=${VERIFIER}&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback`
    : `grant_type=authorization_code&code=${CODE}&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback`;

  return [
    event({
      method: "GET",
      url: authorizeUrl,
      statusCode: 302,
      locationHeader: callbackUrl,
      responseBody: "",
    }),
    event({
      method: "GET",
      url: callbackUrl,
      statusCode: 302,
    }),
    event({
      method: "POST",
      url: "https://idp.example.com/oauth/token",
      contentType: "application/x-www-form-urlencoded",
      bodyText: tokenBody,
      statusCode: 200,
    }),
  ];
}

const baseOptions = (
  overrides: Partial<JmxExportOptions> = {},
): JmxExportOptions => ({
  embedCredentials: true,
  jwtAuth: false,
  baseUrl: "https://app.example.com",
  csvMode: "off",
  bff: true,
  ...overrides,
});

describe("detectOAuthFlow", () => {
  it("returns null when no authorize request is present", () => {
    expect(
      detectOAuthFlow([
        event({ url: "https://app.example.com/api/x" }),
        event({ url: "https://app.example.com/api/y" }),
      ]),
    ).toBeNull();
  });

  it("returns null when authorize is present but no callback carries code", () => {
    const events: JmxHttpEvent[] = [
      event({
        url: `https://idp.example.com/oauth/authorize?response_type=code&state=${STATE}`,
      }),
      event({ url: "https://app.example.com/api/x" }),
    ];
    expect(detectOAuthFlow(events)).toBeNull();
  });

  it("returns the plan with PKCE flag set when code_challenge is present", () => {
    const plan = detectOAuthFlow(fullOauthEvents({ pkce: true }));
    expect(plan).not.toBeNull();
    expect(plan).toMatchObject({
      authorizeIdx: 0,
      callbackIdx: 1,
      tokenIdx: 2,
      hasPkce: true,
      state: STATE,
      nonce: NONCE,
      code: CODE,
      codeChallenge: CHALLENGE,
      codeVerifier: VERIFIER,
    });
  });

  it("returns the plan with hasPkce=false when no code_challenge / verifier", () => {
    const plan = detectOAuthFlow(fullOauthEvents({ pkce: false }));
    expect(plan).not.toBeNull();
    expect(plan?.hasPkce).toBe(false);
    expect(plan?.codeChallenge).toBeUndefined();
    expect(plan?.codeVerifier).toBeUndefined();
  });
});

describe("replaceLiterals", () => {
  it("substitutes each known value with its variable reference", () => {
    expect(
      replaceLiterals("a=ABCDEFG&b=HIJKLMN", [
        ["ABCDEFG", "${x}"],
        ["HIJKLMN", "${y}"],
      ]),
    ).toBe("a=${x}&b=${y}");
  });

  it("skips empty or too-short values", () => {
    expect(replaceLiterals("a=1&b=22", [["1", "${x}"], ["", "${y}"]])).toBe(
      "a=1&b=22",
    );
  });
});

describe("buildJmxTree OAuth emission (BFF mode)", () => {
  it("emits extractors for state, nonce, code on the producing sampler and substitutes them on later samplers", () => {
    const events = fullOauthEvents({ pkce: false });
    const tree = buildJmxTree(events, baseOptions());
    const xml = serializeJmxTree(tree);

    expect(xml).toContain("OAuth extractor (state from Location)");
    expect(xml).toContain("OAuth extractor (nonce from Location)");
    expect(xml).toContain("OAuth extractor (code from Location)");
    expect(xml).toContain(`>${OAUTH_STATE_VAR}<`);
    expect(xml).toContain(`>${OAUTH_NONCE_VAR}<`);
    expect(xml).toContain(`>${OAUTH_CODE_VAR}<`);

    // Authorize keeps its literal state/nonce; later samplers substitute.
    expect(xml).toContain(`state=${STATE}`); // on authorize request URL
    expect(xml).toContain(`\${${OAUTH_STATE_VAR}}`);
    expect(xml).toContain(`\${${OAUTH_CODE_VAR}}`);

    // The callback URL's literal code/state must be replaced.
    expect(xml).not.toContain(`code=${CODE}&state=${STATE}`);
  });

  it("emits a PKCE JSR223 PreProcessor and substitutes code_challenge / code_verifier when PKCE is detected", () => {
    const events = fullOauthEvents({ pkce: true });
    const tree = buildJmxTree(events, baseOptions());
    const xml = serializeJmxTree(tree);

    expect(xml).toContain("JSR223PreProcessor");
    expect(xml).toContain("PKCE verifier/challenge generator");
    expect(xml).toContain(PKCE_VERIFIER_VAR);
    expect(xml).toContain(PKCE_CHALLENGE_VAR);
    expect(xml).toContain(`\${${PKCE_CHALLENGE_VAR}}`);
    expect(xml).toContain(`\${${PKCE_VERIFIER_VAR}}`);

    // The verifier is per-session and must not leak anywhere.
    expect(xml).not.toContain(VERIFIER);
    // The challenge is substituted on the executable HTTPSampler.path,
    // even though the GUI-only `recordedUrl` hint preserves the
    // original capture for the JMeter tree-view label.
    expect(xml).not.toContain(`HTTPSampler.path">/oauth/authorize?response_type=code&amp;client_id=bff&amp;redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&amp;state=${STATE}&amp;nonce=${NONCE}&amp;code_challenge=${CHALLENGE}`);
  });

  it("does NOT emit a PKCE PreProcessor when no code_challenge / verifier was observed", () => {
    const events = fullOauthEvents({ pkce: false });
    const xml = serializeJmxTree(buildJmxTree(events, baseOptions()));
    expect(xml).not.toContain("JSR223PreProcessor");
    expect(xml).not.toContain(PKCE_VERIFIER_VAR);
    expect(xml).not.toContain(PKCE_CHALLENGE_VAR);
  });

  it("non-BFF projects produce identical output regardless of OAuth shape", () => {
    const events = fullOauthEvents({ pkce: true });
    const nonBff = serializeJmxTree(
      buildJmxTree(events, baseOptions({ bff: false })),
    );
    expect(nonBff).not.toContain("OAuth extractor");
    expect(nonBff).not.toContain("JSR223PreProcessor");
    expect(nonBff).not.toContain(OAUTH_STATE_VAR);
    expect(nonBff).not.toContain(PKCE_VERIFIER_VAR);
    // Literals remain untouched.
    expect(nonBff).toContain(STATE);
    expect(nonBff).toContain(CODE);
    expect(nonBff).toContain(CHALLENGE);
    expect(nonBff).toContain(VERIFIER);
  });

  it("extracts state/nonce from an HTML login form when the IdP doesn't redirect immediately", () => {
    const authorizeUrl = `https://idp.example.com/oauth/authorize?response_type=code&state=${STATE}&nonce=${NONCE}`;
    const events: JmxHttpEvent[] = [
      event({
        method: "GET",
        url: authorizeUrl,
        statusCode: 200,
        responseBody:
          `<html><form method="POST" action="/idp/login">` +
          `<input type="hidden" name="state" value="${STATE}">` +
          `<input type="hidden" name="nonce" value="${NONCE}">` +
          `</form></html>`,
      }),
      event({
        method: "GET",
        url: `https://app.example.com/callback?code=${CODE}&state=${STATE}&nonce=${NONCE}`,
      }),
    ];
    const xml = serializeJmxTree(buildJmxTree(events, baseOptions()));
    expect(xml).toContain("OAuth extractor (state from form)");
    expect(xml).toContain("OAuth extractor (nonce from form)");
    expect(xml).toContain(`\${${OAUTH_STATE_VAR}}`);
    expect(xml).toContain(`\${${OAUTH_NONCE_VAR}}`);
  });

  it("emit pipeline: full OAuth + PKCE flow passes the validator", () => {
    const events = fullOauthEvents({ pkce: true });
    const out = emitJmxXml(events, baseOptions());
    expect(out.validation.errors).toEqual([]);
    expect(out.validation.ok).toBe(true);
  });

  it("end-to-end snapshot: synthetic BFF OAuth dance round-trips into a stable plan shape", () => {
    const events = fullOauthEvents({ pkce: true });
    const xml = serializeJmxTree(buildJmxTree(events, baseOptions()));

    // Plan signature checks — single combined snapshot so a downstream
    // refactor that re-orders or re-names any of the OAuth elements is
    // surfaced as a single intentional diff.
    expect({
      hasPkcePreProcessor: xml.includes("PKCE verifier/challenge generator"),
      stateExtractor: xml.includes("OAuth extractor (state from Location)"),
      nonceExtractor: xml.includes("OAuth extractor (nonce from Location)"),
      codeExtractor: xml.includes("OAuth extractor (code from Location)"),
      authorizeStillHasLiteralState: xml.includes(`state=${STATE}`),
      callbackCodeSubstituted: xml.includes(`\${${OAUTH_CODE_VAR}}`),
      tokenVerifierSubstituted: xml.includes(`\${${PKCE_VERIFIER_VAR}}`),
      authorizeChallengeSubstituted: xml.includes(`\${${PKCE_CHALLENGE_VAR}}`),
      // The verifier is private to the captured session and must not
      // leak verbatim anywhere in the emitted plan.
      noLiteralVerifier: !xml.includes(VERIFIER),
    }).toEqual({
      hasPkcePreProcessor: true,
      stateExtractor: true,
      nonceExtractor: true,
      codeExtractor: true,
      authorizeStillHasLiteralState: true,
      callbackCodeSubstituted: true,
      tokenVerifierSubstituted: true,
      authorizeChallengeSubstituted: true,
      noLiteralVerifier: true,
    });
  });
});
