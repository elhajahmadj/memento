/**
 * BFF endpoint classifier.
 *
 * Pure, framework-agnostic port that buckets a recorded HTTP request
 * into one of three classes when the project is BFF-mode:
 *
 *   - `bff`      — same origin as the project's configured `targetUrl`
 *                  (the user's own backend-for-frontend).
 *   - `idp`      — the OAuth identity provider whose authorize/token/
 *                  discovery URL was seen during the recording session.
 *   - `upstream` — any other cross-origin host. Almost always a third-
 *                  party API the BFF proxies through to.
 *
 * The classifier is a single function with an explicit context object
 * so callers can extend its inputs later (host-pattern overrides,
 * per-project allow/deny lists) without changing the signature.
 */
import type { JmxHttpEvent } from "@/features/jmx/domain/types";

export type BffEndpointClass = "bff" | "idp" | "upstream";

export interface BffClassifyContext {
  /**
   * Project's configured target URL. Anything sharing this origin is
   * classified as `bff`. May be empty/invalid — the classifier
   * tolerates it and falls through to `upstream`.
   */
  targetUrl: string;
  /**
   * Lower-cased hostnames seen so far in the session that the recorder
   * has identified as IdP hosts (via OAuth `authorize` / `token` /
   * `.well-known/openid-configuration` paths). Membership is sticky:
   * once a host is in this set, every request to it classifies as
   * `idp` for the rest of the session.
   */
  idpHosts: ReadonlySet<string>;
}

/** Marker substrings that nominate the *request's* host as an IdP host. */
const IDP_PATH_MARKERS = [
  "/.well-known/openid-configuration",
  "/oauth2/authorize",
  "/oauth/authorize",
  "/connect/authorize",
  "/authorize",
  "/oauth2/token",
  "/oauth/token",
  "/connect/token",
  "/token",
];

function parseOrigin(url: string): { host: string; origin: string } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), origin: u.origin.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Best-effort: does this request look like an OAuth dance step
 * (authorize / token / discovery)? Used to lazily promote a host into
 * the session's `idpHosts` set. Path-based — header/body sniffing is
 * out of scope here.
 */
export function looksLikeIdpRequest(event: JmxHttpEvent): boolean {
  const parsed = parseOrigin(event.url);
  if (!parsed) return false;
  let pathname: string;
  try {
    pathname = new URL(event.url).pathname.toLowerCase();
  } catch {
    return false;
  }
  return IDP_PATH_MARKERS.some((m) => pathname.endsWith(m) || pathname.includes(m));
}

/**
 * Classify one request. Pure: deterministic given inputs, no I/O.
 */
export function classifyBffEndpoint(
  event: JmxHttpEvent,
  ctx: BffClassifyContext,
): BffEndpointClass {
  const reqOrigin = parseOrigin(event.url);
  if (!reqOrigin) return "upstream";
  const target = parseOrigin(ctx.targetUrl);
  if (target && reqOrigin.origin === target.origin) return "bff";
  if (ctx.idpHosts.has(reqOrigin.host)) return "idp";
  if (looksLikeIdpRequest(event)) return "idp";
  return "upstream";
}

/**
 * Single classification entry point that BOTH grows the sticky
 * `idpHosts` set (when the event looks like an OAuth dance step) AND
 * returns the resulting class for the event. Mutates `idpHosts` in
 * place so the next call sees the updated set.
 *
 * This is the only function that should be called from the live
 * capture path (`jmxRecordingService`) and the offline replay path
 * (`classifyEventStream` below). Routing both through here is what
 * keeps on-screen tags during recording in lockstep with the classes
 * the emitter later writes into the .jmx plan — without it, the
 * recorder would have to duplicate the sticky-set growth logic and
 * the two paths would inevitably drift.
 */
export function advanceAndClassify(
  event: JmxHttpEvent,
  ctx: { targetUrl: string; idpHosts: Set<string> },
): BffEndpointClass {
  if (looksLikeIdpRequest(event)) {
    const p = parseOrigin(event.url);
    if (p) ctx.idpHosts.add(p.host);
  }
  return classifyBffEndpoint(event, ctx);
}

/**
 * Walk an event stream and emit a parallel array of classes. Also
 * grows the `idpHosts` set as discovery/authorize/token requests
 * appear so a follow-up request to the same host (e.g. the token
 * exchange after the authorize redirect) classifies as `idp` even
 * though its path isn't on the marker list.
 */
export function classifyEventStream(
  events: readonly JmxHttpEvent[],
  targetUrl: string,
): BffEndpointClass[] {
  const idpHosts = new Set<string>();
  const out: BffEndpointClass[] = [];
  for (const e of events) {
    out.push(advanceAndClassify(e, { targetUrl, idpHosts }));
  }
  return out;
}
