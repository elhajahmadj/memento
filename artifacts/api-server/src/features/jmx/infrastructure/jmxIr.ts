/**
 * Typed JMX tree IR.
 *
 * Two phases keep emission testable: `buildJmxTree(events, options)`
 * produces this IR from captured CDP events; a separate serializer
 * (`jmxSerializer.ts`) walks the IR and renders XML with the
 * mandatory `<hashTree>` pairing JMeter requires. Splitting them
 * means tree shape can be asserted structurally without parsing XML.
 */
import type { JmxExportOptions, JmxHttpEvent } from "@/features/jmx/domain/types";
import {
  classifyEventStream,
  type BffEndpointClass,
} from "@/features/jmx/infrastructure/bffEndpointClassifier";

/**
 * A single XML element in the tree. `body` is pre-rendered XML
 * (stringProp / elementProp / etc.) emitted between the open/close
 * tags; `children` are *tree* children, emitted in the sibling
 * `<hashTree>` JMeter requires for every non-leaf element.
 */
export interface IrNode {
  tag: string;
  attrs?: Record<string, string>;
  body?: string;
  children?: IrNode[];
}

export interface JmxTree {
  /** The <TestPlan> element. The serializer wraps it in <jmeterTestPlan><hashTree>...</hashTree></jmeterTestPlan>. */
  testPlan: IrNode;
}

/** Stable name for the JSON-extracted login token JMeter variable. */
export const TOKEN_VAR = "access_token";
/** Stable name for the CSRF / double-submit JMeter variable. */
export const CSRF_VAR = "csrf_token";

/**
 * Hidden-form-field CSRF token names recognised by `detectCsrf`. The
 * set is intentionally narrow: well-known framework defaults only, so
 * we don't false-positive on user form fields named `_token`-ish.
 */
const CSRF_FORM_NAMES = [
  "csrf_token",
  "_csrf",
  "__RequestVerificationToken",
  "authenticity_token",
  "_token",
];

/** Double-submit cookie names recognised by `detectCsrf`. */
const CSRF_COOKIE_NAMES = ["XSRF-TOKEN", "csrf-token"];

/** Headers that pair with the double-submit cookie (mixed-case tolerant). */
const CSRF_HEADER_PATTERN = /^x-(?:x|c)srf-token$/i;

export interface CsrfFormHit {
  kind: "form";
  fieldName: string;
  value: string;
  /** Index of the event whose response *rendered* the hidden field. */
  producerIdx: number;
  /** Indices of events whose body/url carry the token value verbatim. */
  consumerIdxs: number[];
}

export interface CsrfCookieHit {
  kind: "cookie";
  cookieName: string;
  /** Header name as observed on the consumer request (preserved casing). */
  headerName: string;
  value: string;
  consumerIdxs: number[];
}

export type CsrfHit = CsrfFormHit | CsrfCookieHit;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return undefined;
}

function parseCookies(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Walk the recorded session and surface CSRF patterns the emitter
 * knows how to correlate.
 *
 *  - **Form**: a captured response body that contains a hidden input
 *    whose `name=` matches a well-known CSRF field. Producer is the
 *    event that rendered the HTML; consumers are subsequent events
 *    whose body or URL contains the token value verbatim.
 *  - **Cookie**: a captured request whose `Cookie` header carries
 *    `XSRF-TOKEN=<v>` (or `csrf-token=<v>`) AND whose request headers
 *    echo the same `<v>` back in any header matching
 *    `X-(X|C)SRF-Token` (mixed-case). Multiple consumers are grouped
 *    by `(cookieName, headerName)`.
 *
 * Returns an empty array when nothing matches. Pure — no I/O.
 */
export function detectCsrf(events: JmxHttpEvent[]): CsrfHit[] {
  const hits: CsrfHit[] = [];

  // --- Form hidden-field detection ----------------------------------------
  for (let i = 0; i < events.length; i++) {
    const body = events[i]?.responseBody ?? "";
    if (!body || !/<input\b/i.test(body)) continue;
    for (const name of CSRF_FORM_NAMES) {
      const en = escapeRegex(name);
      // Tolerate either attribute order: name-then-value or value-then-name.
      const re = new RegExp(
        `<input\\b[^>]*\\bname=["']${en}["'][^>]*\\bvalue=["']([^"']+)["']` +
          `|<input\\b[^>]*\\bvalue=["']([^"']+)["'][^>]*\\bname=["']${en}["']`,
        "gi",
      );
      let m: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((m = re.exec(body)) !== null) {
        const value = m[1] ?? m[2];
        if (!value || seen.has(value)) continue;
        seen.add(value);
        const consumerIdxs: number[] = [];
        for (let j = i + 1; j < events.length; j++) {
          const e = events[j]!;
          if (
            (e.bodyText && e.bodyText.includes(value)) ||
            (e.url && e.url.includes(value))
          ) {
            consumerIdxs.push(j);
          }
        }
        if (consumerIdxs.length > 0) {
          hits.push({
            kind: "form",
            fieldName: name,
            value,
            producerIdx: i,
            consumerIdxs,
          });
        }
      }
    }
  }

  // --- Double-submit cookie detection -------------------------------------
  const grouped = new Map<string, CsrfCookieHit>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const cookieHeader = getHeader(e.headers, "cookie");
    if (!cookieHeader) continue;
    const cookies = parseCookies(cookieHeader);
    for (const cookieName of CSRF_COOKIE_NAMES) {
      const cookieValue =
        cookies[cookieName] ?? cookies[cookieName.toLowerCase()];
      if (!cookieValue) continue;
      for (const [hk, hv] of Object.entries(e.headers)) {
        if (CSRF_HEADER_PATTERN.test(hk) && hv === cookieValue) {
          const key = `${cookieName}|${hk.toLowerCase()}`;
          let hit = grouped.get(key);
          if (!hit) {
            hit = {
              kind: "cookie",
              cookieName,
              headerName: hk,
              value: cookieValue,
              consumerIdxs: [],
            };
            grouped.set(key, hit);
          }
          if (!hit.consumerIdxs.includes(i)) hit.consumerIdxs.push(i);
        }
      }
    }
  }
  for (const v of grouped.values()) hits.push(v);

  return hits;
}

interface ParsedBase {
  protocol: string;
  host: string;
  port: string;
}

function parseBaseUrl(baseUrl: string): ParsedBase {
  const u = new URL(baseUrl);
  const protocol = u.protocol.replace(/:$/, "");
  const explicitPort = u.port;
  const port =
    explicitPort !== ""
      ? explicitPort
      : protocol === "https"
        ? "443"
        : "80";
  return { protocol, host: u.hostname, port };
}

function pickLoginEventIndex(
  events: JmxHttpEvent[],
  loginPath: string | undefined,
): number {
  if (loginPath) {
    for (let i = 0; i < events.length; i++) {
      try {
        const p = new URL(events[i]!.url).pathname;
        if (p === loginPath) return i;
      } catch {
        // skip malformed URLs
      }
    }
    return -1;
  }
  // Fallback: auto-detect by looking for the first event whose body
  // parses as JSON or form data and contains both a username-like and
  // a password-like field. This lets the emitter wire up bearer-token
  // correlation (and credential substitution) even when the project
  // marker did not pin an explicit `loginPath`.
  for (let i = 0; i < events.length; i++) {
    if (extractCredentials(events[i]!)) return i;
  }
  return -1;
}

/**
 * Best-effort: enumerate every (username, password) literal pair found
 * across every captured event. The leak-scan validator uses this so
 * its safety check does not depend on a single nominated login event —
 * if any credential-shaped pair appears verbatim in a dynamic-mode
 * plan, emission is refused.
 */
export function scanAllCredentialLiterals(
  events: JmxHttpEvent[],
): Array<{ username: string; password: string }> {
  const out: Array<{ username: string; password: string }> = [];
  for (const e of events) {
    const c = extractCredentials(e);
    if (c) out.push(c);
  }
  return out;
}

/** Extract the captured `username` / `password` literal pair (best-effort, JSON body). */
export function extractCredentials(
  event: JmxHttpEvent | undefined,
): { username: string; password: string } | null {
  if (!event) return null;
  const body = event.bodyText;
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const username = pickStr(parsed, ["username", "user", "email", "login"]);
    const password = pickStr(parsed, ["password", "pass", "pwd"]);
    if (username !== null && password !== null) return { username, password };
  } catch {
    // not JSON; try form-encoded
    const params = new URLSearchParams(body);
    const username =
      params.get("username") ?? params.get("user") ?? params.get("email");
    const password = params.get("password") ?? params.get("pass");
    if (username && password) return { username, password };
  }
  return null;
}

function pickStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string") return v;
  }
  return null;
}

/** XML-escape a literal value for use inside text or attribute. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stringProp(name: string, value: string): string {
  return `<stringProp name="${xmlEscape(name)}">${xmlEscape(value)}</stringProp>`;
}

function boolProp(name: string, value: boolean): string {
  return `<boolProp name="${xmlEscape(name)}">${value ? "true" : "false"}</boolProp>`;
}

function testPlanNode(): IrNode {
  return {
    tag: "TestPlan",
    attrs: {
      guiclass: "TestPlanGui",
      testclass: "TestPlan",
      testname: "Recorded plan",
      enabled: "true",
    },
    body: [
      stringProp("TestPlan.comments", ""),
      boolProp("TestPlan.functional_mode", false),
      boolProp("TestPlan.tearDown_on_shutdown", true),
      boolProp("TestPlan.serialize_threadgroups", false),
      `<elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true"><collectionProp name="Arguments.arguments"/></elementProp>`,
      stringProp("TestPlan.user_define_classpath", ""),
    ].join(""),
  };
}

function threadGroupNode(): IrNode {
  return {
    tag: "ThreadGroup",
    attrs: {
      guiclass: "ThreadGroupGui",
      testclass: "ThreadGroup",
      testname: "Thread Group",
      enabled: "true",
    },
    body: [
      stringProp("ThreadGroup.on_sample_error", "continue"),
      `<elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">${boolProp("LoopController.continue_forever", false)}${stringProp("LoopController.loops", "1")}</elementProp>`,
      stringProp("ThreadGroup.num_threads", "1"),
      stringProp("ThreadGroup.ramp_time", "1"),
      boolProp("ThreadGroup.scheduler", false),
      stringProp("ThreadGroup.duration", ""),
      stringProp("ThreadGroup.delay", ""),
      boolProp("ThreadGroup.same_user_on_next_iteration", true),
    ].join(""),
  };
}

function httpDefaultsNode(p: ParsedBase): IrNode {
  return {
    tag: "ConfigTestElement",
    attrs: {
      guiclass: "HttpDefaultsGui",
      testclass: "ConfigTestElement",
      testname: "HTTP Request Defaults",
      enabled: "true",
    },
    body: [
      `<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true"><collectionProp name="Arguments.arguments"/></elementProp>`,
      stringProp("HTTPSampler.domain", `\${__P(host,${p.host})}`),
      stringProp("HTTPSampler.port", `\${__P(port,${p.port})}`),
      stringProp("HTTPSampler.protocol", `\${__P(protocol,${p.protocol})}`),
      stringProp("HTTPSampler.contentEncoding", ""),
      stringProp("HTTPSampler.path", ""),
      stringProp("HTTPSampler.concurrentPool", "6"),
      stringProp("HTTPSampler.connect_timeout", ""),
      stringProp("HTTPSampler.response_timeout", ""),
    ].join(""),
  };
}

function cookieManagerNode(): IrNode {
  return {
    tag: "CookieManager",
    attrs: {
      guiclass: "CookiePanel",
      testclass: "CookieManager",
      testname: "HTTP Cookie Manager",
      enabled: "true",
    },
    body: [
      `<collectionProp name="CookieManager.cookies"/>`,
      boolProp("CookieManager.clearEachIteration", false),
      boolProp("CookieManager.controlledByThreadGroup", false),
    ].join(""),
  };
}

function headerManagerNode(
  headers: Array<[string, string]>,
  name: string = "HTTP Header Manager",
): IrNode {
  const collection = headers
    .map(
      ([k, v]) =>
        `<elementProp name="${xmlEscape(k)}" elementType="Header">${stringProp("Header.name", k)}${stringProp("Header.value", v)}</elementProp>`,
    )
    .join("");
  return {
    tag: "HeaderManager",
    attrs: {
      guiclass: "HeaderPanel",
      testclass: "HeaderManager",
      testname: name,
      enabled: "true",
    },
    body: `<collectionProp name="HeaderManager.headers">${collection}</collectionProp>`,
  };
}

function udvNode(entries: Array<[string, string]>): IrNode {
  const args = entries
    .map(
      ([k, v]) =>
        `<elementProp name="${xmlEscape(k)}" elementType="Argument">${stringProp("Argument.name", k)}${stringProp("Argument.value", v)}${stringProp("Argument.metadata", "=")}</elementProp>`,
    )
    .join("");
  return {
    tag: "Arguments",
    attrs: {
      guiclass: "ArgumentsPanel",
      testclass: "Arguments",
      testname: "User Defined Variables",
      enabled: "true",
    },
    body: `<collectionProp name="Arguments.arguments">${args}</collectionProp>`,
  };
}

function csvDataSetNode(filename: string, vars: string[]): IrNode {
  return {
    tag: "CSVDataSet",
    attrs: {
      guiclass: "TestBeanGUI",
      testclass: "CSVDataSet",
      testname: "CSV Data Set Config",
      enabled: "true",
    },
    body: [
      stringProp("delimiter", ","),
      stringProp("fileEncoding", "UTF-8"),
      stringProp("filename", filename),
      boolProp("ignoreFirstLine", true),
      boolProp("quotedData", true),
      boolProp("recycle", true),
      stringProp("shareMode", "shareMode.all"),
      boolProp("stopThread", false),
      stringProp("variableNames", vars.join(",")),
    ].join(""),
  };
}

/**
 * Human-readable prefix added to a sampler's name when BFF
 * classification is on. Keeps the GUI tree scannable.
 */
function classLabelPrefix(cls: BffEndpointClass): string {
  switch (cls) {
    case "bff":
      return "[BFF]";
    case "idp":
      return "[IdP]";
    case "upstream":
      return "[Upstream]";
  }
}

/** Display name for the GenericController bucket that holds a class. */
function classGroupName(cls: BffEndpointClass): string {
  switch (cls) {
    case "bff":
      return "BFF";
    case "idp":
      return "IdP";
    case "upstream":
      return "Upstream API";
  }
}

/**
 * Group a parallel `(samplers, classes)` pair into one GenericController
 * per class, preserving relative order within each bucket. Empty
 * buckets are omitted so a session that never hit an IdP doesn't get
 * an empty "IdP" controller cluttering the GUI.
 */
function bucketByClass(
  samplers: IrNode[],
  classes: BffEndpointClass[],
): IrNode[] {
  const order: BffEndpointClass[] = ["bff", "idp", "upstream"];
  const out: IrNode[] = [];
  for (const cls of order) {
    const children: IrNode[] = [];
    for (let i = 0; i < samplers.length; i++) {
      if (classes[i] === cls) children.push(samplers[i]!);
    }
    if (children.length === 0) continue;
    const controller = genericControllerNode(classGroupName(cls));
    controller.children = children;
    out.push(controller);
  }
  return out;
}

function genericControllerNode(name: string): IrNode {
  return {
    tag: "GenericController",
    attrs: {
      guiclass: "LogicControllerGui",
      testclass: "GenericController",
      testname: name,
      enabled: "true",
    },
    body: "",
  };
}

function csrfFormExtractorNode(fieldName: string): IrNode {
  const en = escapeRegex(fieldName);
  // One regex, two alternates so the extractor matches either
  // `name="x" ... value="y"` or `value="y" ... name="x"`. JMeter's
  // RegexExtractor only writes one capture group per match, so we use
  // an alternation and let the template pick whichever side fired.
  const regex =
    `name=[\"']${en}[\"'][^>]*value=[\"']([^\"']+)[\"']` +
    `|value=[\"']([^\"']+)[\"'][^>]*name=[\"']${en}[\"']`;
  return {
    tag: "RegexExtractor",
    attrs: {
      guiclass: "RegexExtractorGui",
      testclass: "RegexExtractor",
      testname: `CSRF extractor (form ${fieldName})`,
      enabled: "true",
    },
    body: [
      stringProp("RegexExtractor.useHeaders", "false"),
      stringProp("RegexExtractor.refname", CSRF_VAR),
      stringProp("RegexExtractor.regex", regex),
      stringProp("RegexExtractor.template", "$1$$2$"),
      stringProp("RegexExtractor.default", ""),
      stringProp("RegexExtractor.match_number", "1"),
    ].join(""),
  };
}

function csrfCookieExtractorNode(cookieName: string): IrNode {
  // useHeaders=true tells JMeter to scan *response* headers, which
  // includes Set-Cookie. The HTTP Cookie Manager still handles the
  // cookie jar; this extractor just lifts the value into ${csrf_token}
  // for the matching X-XSRF-TOKEN-style header substitution.
  const regex = `Set-Cookie:\\s*${escapeRegex(cookieName)}=([^;\\r\\n]+)`;
  return {
    tag: "RegexExtractor",
    attrs: {
      guiclass: "RegexExtractorGui",
      testclass: "RegexExtractor",
      testname: `CSRF extractor (cookie ${cookieName})`,
      enabled: "true",
    },
    body: [
      stringProp("RegexExtractor.useHeaders", "true"),
      stringProp("RegexExtractor.refname", CSRF_VAR),
      stringProp("RegexExtractor.regex", regex),
      stringProp("RegexExtractor.template", "$1$"),
      stringProp("RegexExtractor.default", ""),
      stringProp("RegexExtractor.match_number", "1"),
    ].join(""),
  };
}

/**
 * Structured plan returned by `detectOAuthFlow`. Holds indices into
 * the captured event list for the three samplers the OAuth dance
 * needs correlated, plus the literal dynamic values observed on the
 * wire so the IR emitter can both (a) lift them out via Regex
 * Extractors and (b) substitute the same literals with JMeter
 * variables on subsequent samplers.
 */
export interface OAuthFlowPlan {
  /** Event index of the authorize request (carries `response_type=code`). */
  authorizeIdx: number;
  /** Event index of the BFF callback request (its URL carries `code=`). */
  callbackIdx: number;
  /** Event index of the token exchange POST when present. */
  tokenIdx?: number;
  /** True when the authorize request carried `code_challenge` (PKCE). */
  hasPkce: boolean;
  /** Captured `state` literal — populated when observed on authorize. */
  state?: string;
  /** Captured `nonce` literal — populated when observed on authorize. */
  nonce?: string;
  /** Captured `code` literal — populated when observed on callback. */
  code?: string;
  /** Captured `code_verifier` literal — populated when observed on token POST. */
  codeVerifier?: string;
  /** Captured `code_challenge` literal — populated when observed on authorize. */
  codeChallenge?: string;
}

/** JMeter variable names used by the OAuth correlation slice. */
export const OAUTH_STATE_VAR = "oauth_state";
export const OAUTH_NONCE_VAR = "oauth_nonce";
export const OAUTH_CODE_VAR = "oauth_code";
export const PKCE_VERIFIER_VAR = "pkce_verifier";
export const PKCE_CHALLENGE_VAR = "pkce_challenge";

function readQueryParam(rawUrl: string, name: string): string | null {
  try {
    return new URL(rawUrl).searchParams.get(name);
  } catch {
    return null;
  }
}

/**
 * Walk a recorded session and detect a single OAuth authorization-code
 * dance. Returns `null` when no authorize request is found or no
 * follow-up callback carries a `code` query param.
 *
 *  - **authorize** — first request whose URL declares
 *    `response_type=code` OR carries both `state` and `code_challenge`.
 *  - **callback**  — earliest later request whose URL has a `code=`
 *    query param.
 *  - **token**     — earliest later POST whose body declares
 *    `grant_type=authorization_code` or carries `code_verifier=`.
 *  - **hasPkce**   — true when the authorize URL carries
 *    `code_challenge` OR a token POST carries `code_verifier`.
 *
 * Pure — no I/O.
 */
export function detectOAuthFlow(
  events: JmxHttpEvent[],
): OAuthFlowPlan | null {
  let authorizeIdx = -1;
  let state: string | undefined;
  let nonce: string | undefined;
  let codeChallenge: string | undefined;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const responseType = readQueryParam(e.url, "response_type");
    const s = readQueryParam(e.url, "state");
    const cc = readQueryParam(e.url, "code_challenge");
    if (responseType === "code" || (s && cc)) {
      authorizeIdx = i;
      if (s) state = s;
      const n = readQueryParam(e.url, "nonce");
      if (n) nonce = n;
      if (cc) codeChallenge = cc;
      break;
    }
  }
  if (authorizeIdx < 0) return null;

  let callbackIdx = -1;
  let code: string | undefined;
  for (let i = authorizeIdx + 1; i < events.length; i++) {
    const c = readQueryParam(events[i]!.url, "code");
    if (c) {
      callbackIdx = i;
      code = c;
      break;
    }
  }
  if (callbackIdx < 0) return null;

  let tokenIdx: number | undefined;
  let codeVerifier: string | undefined;
  for (let i = callbackIdx; i < events.length; i++) {
    const e = events[i]!;
    if (e.method !== "POST" || !e.bodyText) continue;
    const body = e.bodyText;
    const looksTokenLike =
      /grant_type=authorization_code/.test(body) || /code_verifier=/.test(body);
    if (!looksTokenLike) {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (
          parsed["grant_type"] !== "authorization_code" &&
          typeof parsed["code_verifier"] !== "string"
        ) {
          continue;
        }
      } catch {
        continue;
      }
    }
    tokenIdx = i;
    try {
      const params = new URLSearchParams(body);
      const cv = params.get("code_verifier");
      if (cv) codeVerifier = cv;
    } catch {
      // not form-encoded
    }
    if (!codeVerifier) {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const cv = parsed["code_verifier"];
        if (typeof cv === "string") codeVerifier = cv;
      } catch {
        // not JSON
      }
    }
    break;
  }

  const hasPkce = codeChallenge !== undefined || codeVerifier !== undefined;
  const plan: OAuthFlowPlan = { authorizeIdx, callbackIdx, hasPkce };
  if (tokenIdx !== undefined) plan.tokenIdx = tokenIdx;
  if (state) plan.state = state;
  if (nonce) plan.nonce = nonce;
  if (code) plan.code = code;
  if (codeVerifier) plan.codeVerifier = codeVerifier;
  if (codeChallenge) plan.codeChallenge = codeChallenge;
  return plan;
}

/**
 * Replace literal values on a string with their `${var}` references.
 * Single shared helper so CSRF, OAuth, and PKCE substitution all
 * agree on the guards (skip empty / short values that would
 * false-positive across the captured payload).
 */
export function replaceLiterals(
  s: string,
  subs: Array<[value: string, varRef: string]>,
): string {
  let out = s;
  for (const [value, varRef] of subs) {
    if (!value || value.length < 4) continue;
    out = out.split(value).join(varRef);
  }
  return out;
}

function oauthRegexExtractorNode(args: {
  refName: string;
  regex: string;
  useHeaders: boolean;
  testname: string;
}): IrNode {
  return {
    tag: "RegexExtractor",
    attrs: {
      guiclass: "RegexExtractorGui",
      testclass: "RegexExtractor",
      testname: args.testname,
      enabled: "true",
    },
    body: [
      stringProp("RegexExtractor.useHeaders", args.useHeaders ? "true" : "false"),
      stringProp("RegexExtractor.refname", args.refName),
      stringProp("RegexExtractor.regex", args.regex),
      stringProp("RegexExtractor.template", "$1$"),
      stringProp("RegexExtractor.default", ""),
      stringProp("RegexExtractor.match_number", "1"),
    ].join(""),
  };
}

/**
 * Build a Regex Extractor that lifts an OAuth parameter (`state`,
 * `nonce`, `code`) out of a producer response. Prefers a `Location`
 * header extractor when the value was observed on the redirect
 * header; otherwise scans the response body for a hidden form input
 * or a query-param-like literal.
 */
function buildOauthExtractor(args: {
  paramName: string;
  refName: string;
  value: string;
  event: JmxHttpEvent;
}): IrNode {
  const { paramName, refName, value, event } = args;
  const enParam = escapeRegex(paramName);
  if (event.locationHeader && event.locationHeader.includes(value)) {
    return oauthRegexExtractorNode({
      refName,
      regex: `Location:[^\\r\\n]*[?&]${enParam}=([^&\\s\\r\\n]+)`,
      useHeaders: true,
      testname: `OAuth extractor (${paramName} from Location)`,
    });
  }
  const body = event.responseBody ?? "";
  const nameFirst = new RegExp(
    `name=["']${enParam}["'][^>]*value=["']([^"']+)["']`,
  );
  const valueFirst = new RegExp(
    `value=["']([^"']+)["'][^>]*name=["']${enParam}["']`,
  );
  if (nameFirst.test(body) || valueFirst.test(body)) {
    return oauthRegexExtractorNode({
      refName,
      regex:
        `name=[\"']${enParam}[\"'][^>]*value=[\"']([^\"']+)[\"']` +
        `|value=[\"']([^\"']+)[\"'][^>]*name=[\"']${enParam}[\"']`,
      useHeaders: false,
      testname: `OAuth extractor (${paramName} from form)`,
    });
  }
  return oauthRegexExtractorNode({
    refName,
    regex: `[?&]${enParam}=([^&\\s\\r\\n\"'<>]+)`,
    useHeaders: false,
    testname: `OAuth extractor (${paramName})`,
  });
}

/**
 * JSR223 PreProcessor that generates a fresh PKCE `code_verifier` /
 * `code_challenge` pair per iteration and exposes them as
 * `${pkce_verifier}` / `${pkce_challenge}`. Placed on the authorize
 * sampler so the variables are set BEFORE the sampler runs.
 */
function pkcePreProcessorNode(): IrNode {
  const script = [
    "import java.security.SecureRandom",
    "import java.security.MessageDigest",
    "def rnd = new SecureRandom()",
    "byte[] buf = new byte[32]",
    "rnd.nextBytes(buf)",
    "def verifier = java.util.Base64.urlEncoder.withoutPadding().encodeToString(buf)",
    "def digest = MessageDigest.getInstance(\"SHA-256\").digest(verifier.getBytes(\"UTF-8\"))",
    "def challenge = java.util.Base64.urlEncoder.withoutPadding().encodeToString(digest)",
    `vars.put("${PKCE_VERIFIER_VAR}", verifier)`,
    `vars.put("${PKCE_CHALLENGE_VAR}", challenge)`,
  ].join("\n");
  return {
    tag: "JSR223PreProcessor",
    attrs: {
      guiclass: "TestBeanGUI",
      testclass: "JSR223PreProcessor",
      testname: "PKCE verifier/challenge generator",
      enabled: "true",
    },
    body: [
      stringProp("cacheKey", "true"),
      stringProp("filename", ""),
      stringProp("parameters", ""),
      stringProp("script", script),
      stringProp("scriptLanguage", "groovy"),
    ].join(""),
  };
}

function jsonExtractorNode(varName: string, jsonPath: string): IrNode {
  return {
    tag: "JSONPostProcessor",
    attrs: {
      guiclass: "JSONPostProcessorGui",
      testclass: "JSONPostProcessor",
      testname: "JSON Extractor (login token)",
      enabled: "true",
    },
    body: [
      stringProp("JSONPostProcessor.referenceNames", varName),
      stringProp("JSONPostProcessor.jsonPathExprs", jsonPath),
      stringProp("JSONPostProcessor.match_numbers", "1"),
      stringProp("JSONPostProcessor.defaultValues", ""),
    ].join(""),
  };
}

/** Build an HTTPSamplerProxy from a captured event. */
function samplerNode(
  event: JmxHttpEvent,
  pathOverride: string,
  bodyOverride: string | null,
  testname: string,
): IrNode {
  const url = (() => {
    try {
      return new URL(event.url);
    } catch {
      return null;
    }
  })();
  const pathAndQuery = pathOverride;
  const contentType = (event.contentType ?? "").toLowerCase();
  const isForm = contentType.includes("application/x-www-form-urlencoded");
  const isMultipart = contentType.includes("multipart/form-data");
  const bodyText = bodyOverride ?? event.bodyText ?? "";

  // Build the Arguments collection. JSON / text → "Body Data" (raw post body
  // toggled on, single argument carrying the raw bytes). form-urlencoded →
  // parsed key/value Arguments. multipart → empty stub + a TODO comment in
  // a dummy stringProp so the user sees it in the GUI.
  let argsBody: string;
  let postBodyRaw = false;
  if (isMultipart) {
    argsBody = [
      `<collectionProp name="Arguments.arguments"/>`,
      // Files Upload stub — JMeter renders this as the "Files Upload" tab.
      `<elementProp name="HTTPsampler.Files" elementType="HTTPFileArgs"><collectionProp name="HTTPFileArgs.files"/></elementProp>`,
    ].join("");
  } else if (isForm && bodyText.length > 0) {
    const params = new URLSearchParams(bodyText);
    const items: string[] = [];
    for (const [k, v] of params) {
      items.push(
        `<elementProp name="${xmlEscape(k)}" elementType="HTTPArgument">${boolProp("HTTPArgument.always_encode", true)}${stringProp("Argument.value", v)}${stringProp("Argument.metadata", "=")}${boolProp("HTTPArgument.use_equals", true)}${stringProp("Argument.name", k)}</elementProp>`,
      );
    }
    argsBody = `<collectionProp name="Arguments.arguments">${items.join("")}</collectionProp>`;
  } else if (bodyText.length > 0) {
    postBodyRaw = true;
    argsBody = `<collectionProp name="Arguments.arguments"><elementProp name="" elementType="HTTPArgument">${boolProp("HTTPArgument.always_encode", false)}${stringProp("Argument.value", bodyText)}${stringProp("Argument.metadata", "=")}</elementProp></collectionProp>`;
  } else {
    argsBody = `<collectionProp name="Arguments.arguments"/>`;
  }

  const argsElement = `<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="HTTP Request" enabled="true">${argsBody}</elementProp>`;

  return {
    tag: "HTTPSamplerProxy",
    attrs: {
      guiclass: "HttpTestSampleGui",
      testclass: "HTTPSamplerProxy",
      testname,
      enabled: "true",
    },
    body: [
      argsElement,
      // domain / port / protocol intentionally blank — HTTP Request Defaults
      // supplies them so the plan can be re-pointed at a different env.
      stringProp("HTTPSampler.domain", ""),
      stringProp("HTTPSampler.port", ""),
      stringProp("HTTPSampler.protocol", ""),
      stringProp("HTTPSampler.contentEncoding", ""),
      stringProp("HTTPSampler.path", pathAndQuery),
      stringProp("HTTPSampler.method", event.method),
      boolProp("HTTPSampler.follow_redirects", true),
      boolProp("HTTPSampler.auto_redirects", false),
      boolProp("HTTPSampler.use_keepalive", true),
      boolProp("HTTPSampler.DO_MULTIPART_POST", isMultipart),
      stringProp("HTTPSampler.embedded_url_re", ""),
      stringProp("HTTPSampler.connect_timeout", ""),
      stringProp("HTTPSampler.response_timeout", ""),
      boolProp("HTTPSampler.postBodyRaw", postBodyRaw),
      // url isn't required by JMeter but is useful in the GUI.
      stringProp("HTTPSampler.recordedUrl", url ? url.toString() : event.url),
    ].join(""),
  };
}

/**
 * Compute the path+query relative to the export base URL, dropping
 * the scheme/host/port portion (those move into HTTP Request Defaults).
 * Absolute paths from a different origin are kept verbatim — they
 * almost always indicate third-party calls the load test should not
 * re-issue, but we don't drop them silently.
 */
function pathAndQueryOf(event: JmxHttpEvent): string {
  try {
    const u = new URL(event.url);
    return `${u.pathname}${u.search}`;
  } catch {
    return event.url;
  }
}

/** Sampler "name" shown in the JMeter GUI tree. */
function sampleNameOf(event: JmxHttpEvent): string {
  const path = pathAndQueryOf(event);
  return `${event.method} ${path}`;
}

/**
 * Build the full JMX tree IR from captured events + options. Pure —
 * no I/O, no `Date.now()`, deterministic given the inputs.
 */
export function buildJmxTree(
  events: JmxHttpEvent[],
  options: JmxExportOptions,
): JmxTree {
  const parsed = parseBaseUrl(options.baseUrl);
  const loginIdx = pickLoginEventIndex(events, options.loginPath);
  const loginEvent = loginIdx >= 0 ? events[loginIdx] : undefined;
  const captured = extractCredentials(loginEvent);

  const tgChildren: IrNode[] = [];
  tgChildren.push(httpDefaultsNode(parsed));
  tgChildren.push(cookieManagerNode());
  // Empty common header manager — per-sampler Content-Type is derived
  // from each captured request's own `contentType` (JSON vs form vs
  // multipart) at sampler build time. Adding a default `Content-Type`
  // here would override the captured behavior for form/multipart
  // requests and break replay against endpoints that expect those
  // semantics.
  tgChildren.push(
    headerManagerNode([], "HTTP Header Manager (defaults)"),
  );

  // UDV / CSV for credentials in dynamic mode.
  if (!options.embedCredentials && captured) {
    if (options.csvMode === "global" || options.csvMode === "perRequest") {
      tgChildren.push(csvDataSetNode("users.csv", ["username", "password"]));
    } else {
      // __P() lets users override on the JMeter CLI without editing the plan.
      tgChildren.push(
        udvNode([
          ["username", "${__P(username,)}"],
          ["password", "${__P(password,)}"],
        ]),
      );
    }
  }

  // --- CSRF correlation (BFF projects only) ------------------------------
  // Walk the captured session for the supported patterns and build the
  // per-event substitution plan. For non-BFF projects this returns an
  // empty array and the rest of the pipeline behaves identically.
  const csrfHits = options.bff === true ? detectCsrf(events) : [];
  const formHitsByProducer = new Map<number, CsrfFormHit[]>();
  const cookieHeadersByConsumer = new Map<
    number,
    Array<{ headerName: string }>
  >();
  const csrfValuesByConsumer = new Map<number, string[]>();
  const cookieHits: CsrfCookieHit[] = [];
  for (const h of csrfHits) {
    if (h.kind === "form") {
      const arr = formHitsByProducer.get(h.producerIdx) ?? [];
      arr.push(h);
      formHitsByProducer.set(h.producerIdx, arr);
      for (const c of h.consumerIdxs) {
        const vs = csrfValuesByConsumer.get(c) ?? [];
        vs.push(h.value);
        csrfValuesByConsumer.set(c, vs);
      }
    } else {
      cookieHits.push(h);
      for (const c of h.consumerIdxs) {
        const arr = cookieHeadersByConsumer.get(c) ?? [];
        arr.push({ headerName: h.headerName });
        cookieHeadersByConsumer.set(c, arr);
        const vs = csrfValuesByConsumer.get(c) ?? [];
        vs.push(h.value);
        csrfValuesByConsumer.set(c, vs);
      }
    }
  }

  // --- OAuth flow correlation (BFF projects only) ------------------------
  // The detector returns null for non-BFF projects and for sessions
  // that don't carry an authorize → callback dance, so non-BFF output
  // is byte-identical to the pre-OAuth pipeline.
  const oauthPlan = options.bff === true ? detectOAuthFlow(events) : null;
  const oauthSubsByEvent = new Map<number, Array<[string, string]>>();
  const oauthChildrenByEvent = new Map<number, IrNode[]>();

  const pushOauthSub = (idx: number, value: string, varRef: string) => {
    if (!value || value.length < 4) return;
    const arr = oauthSubsByEvent.get(idx) ?? [];
    arr.push([value, varRef]);
    oauthSubsByEvent.set(idx, arr);
  };

  const pushOauthChild = (idx: number, node: IrNode) => {
    const arr = oauthChildrenByEvent.get(idx) ?? [];
    arr.push(node);
    oauthChildrenByEvent.set(idx, arr);
  };

  if (oauthPlan) {
    // PKCE PreProcessor on the authorize sampler so the verifier /
    // challenge variables are set before that sampler runs.
    if (oauthPlan.hasPkce) {
      pushOauthChild(oauthPlan.authorizeIdx, pkcePreProcessorNode());
    }

    const dynamicValues: Array<{
      paramName: string;
      refName: string;
      value: string | undefined;
      substituteAuthorize: boolean;
    }> = [
      {
        paramName: "state",
        refName: OAUTH_STATE_VAR,
        value: oauthPlan.state,
        substituteAuthorize: false,
      },
      {
        paramName: "nonce",
        refName: OAUTH_NONCE_VAR,
        value: oauthPlan.nonce,
        substituteAuthorize: false,
      },
      {
        paramName: "code",
        refName: OAUTH_CODE_VAR,
        value: oauthPlan.code,
        substituteAuthorize: false,
      },
    ];

    for (const dv of dynamicValues) {
      if (!dv.value) continue;
      // Locate the earliest event whose RESPONSE carries this value
      // (Location redirect or HTML hidden field). Producer scan starts
      // at the authorize sampler — values surface in or after its
      // response, never before.
      let producerIdx = -1;
      for (let i = oauthPlan.authorizeIdx; i < events.length; i++) {
        const e = events[i]!;
        if (
          (e.locationHeader && e.locationHeader.includes(dv.value)) ||
          (e.responseBody && e.responseBody.includes(dv.value))
        ) {
          producerIdx = i;
          break;
        }
      }
      if (producerIdx >= 0) {
        pushOauthChild(
          producerIdx,
          buildOauthExtractor({
            paramName: dv.paramName,
            refName: dv.refName,
            value: dv.value,
            event: events[producerIdx]!,
          }),
        );
      }
      // Per task: replace literal value on samplers AFTER authorize.
      // state/nonce/code stay literal on authorize so the variable
      // (extracted from authorize's response) is consumed only by
      // later samplers.
      for (let i = 0; i < events.length; i++) {
        if (!dv.substituteAuthorize && i <= oauthPlan.authorizeIdx) continue;
        const e = events[i]!;
        if (
          e.url.includes(dv.value) ||
          (e.bodyText && e.bodyText.includes(dv.value))
        ) {
          pushOauthSub(i, dv.value, `\${${dv.refName}}`);
        }
      }
    }

    // PKCE substitutions. `code_challenge` typically only appears on
    // the authorize URL (substitute there so the JSR223-set var is
    // used). `code_verifier` typically appears on the token POST.
    if (oauthPlan.hasPkce) {
      const ccVal = oauthPlan.codeChallenge;
      if (ccVal) {
        for (let i = oauthPlan.authorizeIdx; i < events.length; i++) {
          const e = events[i]!;
          if (
            e.url.includes(ccVal) ||
            (e.bodyText && e.bodyText.includes(ccVal))
          ) {
            pushOauthSub(i, ccVal, `\${${PKCE_CHALLENGE_VAR}}`);
          }
        }
      }
      const cvVal = oauthPlan.codeVerifier;
      if (cvVal) {
        for (let i = oauthPlan.authorizeIdx; i < events.length; i++) {
          const e = events[i]!;
          if (
            e.url.includes(cvVal) ||
            (e.bodyText && e.bodyText.includes(cvVal))
          ) {
            pushOauthSub(i, cvVal, `\${${PKCE_VERIFIER_VAR}}`);
          }
        }
      }
    }
  }

  const applyCsrf = (s: string, idx: number): string => {
    const vals = csrfValuesByConsumer.get(idx);
    if (!vals || vals.length === 0) return s;
    const subs: Array<[string, string]> = vals.map(
      (v) => [v, `\${${CSRF_VAR}}`] as [string, string],
    );
    return replaceLiterals(s, subs);
  };

  const applyOauth = (s: string, idx: number): string => {
    const subs = oauthSubsByEvent.get(idx);
    if (!subs || subs.length === 0) return s;
    return replaceLiterals(s, subs);
  };

  const applyDynamic = (s: string, idx: number): string =>
    applyOauth(applyCsrf(s, idx), idx);

  const hasDynamicSubs = (idx: number): boolean =>
    csrfValuesByConsumer.has(idx) || oauthSubsByEvent.has(idx);

  const childrenForSampler = (idx: number): IrNode[] => {
    const out: IrNode[] = [];
    const forms = formHitsByProducer.get(idx);
    if (forms) {
      // De-dup by fieldName; one extractor per distinct hidden-field name.
      const seen = new Set<string>();
      for (const f of forms) {
        if (seen.has(f.fieldName)) continue;
        seen.add(f.fieldName);
        out.push(csrfFormExtractorNode(f.fieldName));
      }
    }
    const cookieHeaders = cookieHeadersByConsumer.get(idx);
    if (cookieHeaders && cookieHeaders.length > 0) {
      const seenH = new Set<string>();
      const entries: Array<[string, string]> = [];
      for (const ch of cookieHeaders) {
        const key = ch.headerName.toLowerCase();
        if (seenH.has(key)) continue;
        seenH.add(key);
        entries.push([ch.headerName, `\${${CSRF_VAR}}`]);
      }
      out.push(
        headerManagerNode(entries, "HTTP Header Manager (CSRF)"),
      );
    }
    const oauthKids = oauthChildrenByEvent.get(idx);
    if (oauthKids) out.push(...oauthKids);
    return out;
  };

  // Build login sampler (or skip if no login event was identified).
  let loginSampler: IrNode | null = null;
  if (loginEvent) {
    const loginPath = applyDynamic(pathAndQueryOf(loginEvent), loginIdx);
    let bodyOverride: string | null = null;
    if (!options.embedCredentials && captured) {
      // Substitute literals → ${username} / ${password} in the captured body.
      const replaced = loginEvent.bodyText
        .split(captured.username)
        .join("${username}")
        .split(captured.password)
        .join("${password}");
      bodyOverride = replaced;
    }
    if (hasDynamicSubs(loginIdx)) {
      bodyOverride = applyDynamic(bodyOverride ?? loginEvent.bodyText, loginIdx);
    }
    loginSampler = samplerNode(
      loginEvent,
      loginPath,
      bodyOverride,
      `Login ${loginEvent.method} ${loginPath}`,
    );
    const loginChildren: IrNode[] = [];
    // JSON extractor for the bearer token sits under the login sampler's
    // hashTree so JMeter scopes it to that sampler's response.
    if (options.jwtAuth) {
      const jsonPath = options.tokenJsonPath ?? "$.access_token";
      loginChildren.push(jsonExtractorNode(TOKEN_VAR, jsonPath));
    }
    loginChildren.push(...childrenForSampler(loginIdx));
    if (loginChildren.length > 0) loginSampler.children = loginChildren;
  }

  // Classification stream — same length as `events`. For non-BFF
  // projects we don't bother running it (no behavior depends on it).
  const classes: BffEndpointClass[] | null = options.bff
    ? classifyEventStream(events, options.baseUrl)
    : null;

  // Subsequent samplers — everything except the login event. Track
  // their class in parallel so the BFF grouping pass below can bucket
  // them without re-running the classifier.
  const subsequent: IrNode[] = [];
  const subsequentClasses: BffEndpointClass[] = [];
  for (let i = 0; i < events.length; i++) {
    if (i === loginIdx) continue;
    const e = events[i]!;
    // Combine BFF classification with dynamic (CSRF + OAuth)
    // correlation: apply substitutions to the path and body, prefix
    // the sampler's display name with its class when running in BFF
    // mode, and attach any per-sampler children (CSRF + OAuth).
    const path = applyDynamic(pathAndQueryOf(e), i);
    const bodyOverride = hasDynamicSubs(i) ? applyDynamic(e.bodyText, i) : null;
    const cls = classes ? classes[i]! : null;
    const name = cls
      ? `${classLabelPrefix(cls)} ${sampleNameOf(e)}`
      : sampleNameOf(e);
    const node = samplerNode(e, path, bodyOverride, name);
    const kids = childrenForSampler(i);
    if (kids.length > 0) node.children = kids;
    subsequent.push(node);
    if (cls) subsequentClasses.push(cls);
  }

  // Cookie double-submit: one TG-scoped Regex Extractor (response
  // headers) per distinct cookie name. Placed up-front so it fires
  // for every subsequent sampler in the thread group.
  if (cookieHits.length > 0) {
    const seenCookie = new Set<string>();
    for (const h of cookieHits) {
      if (seenCookie.has(h.cookieName)) continue;
      seenCookie.add(h.cookieName);
      tgChildren.push(csrfCookieExtractorNode(h.cookieName));
    }
  }

  if (loginSampler && classes && loginIdx >= 0) {
    // Prefix the login sampler's name too when running in BFF mode so
    // the GUI tree shows the class consistently across every row.
    const cls = classes[loginIdx]!;
    loginSampler.attrs = {
      ...(loginSampler.attrs ?? {}),
      testname: `${classLabelPrefix(cls)} ${loginSampler.attrs?.testname ?? ""}`.trim(),
    };
  }

  if (loginSampler) tgChildren.push(loginSampler);

  if (options.jwtAuth && loginEvent) {
    // GenericController scopes the bearer header to the post-login samplers.
    const controller = genericControllerNode("Authenticated requests");
    const bearer = headerManagerNode(
      [["Authorization", `Bearer \${${TOKEN_VAR}}`]],
      "HTTP Header Manager (bearer)",
    );
    if (classes) {
      // Inside the authenticated branch, still bucket by class so the
      // GUI tree shows three labelled groups under "Authenticated
      // requests" — the bearer header sits above them and applies to
      // every group's children via JMeter's scope rules.
      const buckets = bucketByClass(subsequent, subsequentClasses);
      controller.children = [bearer, ...buckets];
    } else {
      controller.children = [bearer, ...subsequent];
    }
    tgChildren.push(controller);
  } else if (classes && cookieHits.length === 0) {
    tgChildren.push(...bucketByClass(subsequent, subsequentClasses));
  } else {
    // When a TG-scoped CSRF cookie Regex Extractor is present, keep
    // samplers as direct Thread Group children (skipping the BFF
    // GenericController buckets) so the extractor's sibling-scope
    // relationship to the samplers that consume `${csrf_token}` is
    // structurally obvious in the emitted tree. Sampler names still
    // carry the BFF/IdP/Upstream prefix added above.
    tgChildren.push(...subsequent);
  }

  const tg = threadGroupNode();
  tg.children = tgChildren;
  const tp = testPlanNode();
  tp.children = [tg];
  return { testPlan: tp };
}
