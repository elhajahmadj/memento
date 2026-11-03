/**
 * JMX HTTP recording service.
 *
 * Owns the embedded recording browser when the workbench is in JMX
 * mode. Reuses the shared `launchRecordingChromium` helper so the
 * launched Chromium is exactly the same browser the DOM recorder uses
 * — same headless flags, same executable resolution — and attaches a
 * CDP session to the page so we can subscribe to
 * `Network.requestWillBeSent`, `Network.responseReceived`, and
 * `Network.loadingFailed`. CDP listeners are attached to the
 * already-launched recording browser context/page; we do not start a
 * separate hidden Chromium for capture.
 *
 * Concurrency model: a single recording session is allowed per
 * process. The DOM recorder lives in
 * `features/recording/infrastructure/sessionState` and gates its own
 * `start`; here we additionally check both directions so DOM and JMX
 * recordings cannot run on top of each other and clobber one
 * another's browser state. A `currentByUser` map prevents the same
 * user from opening two concurrent JMX sessions which would race over
 * the same captured-events list.
 *
 * Event ordering: events are pushed into `session.events` at
 * `requestWillBeSent` time — i.e. in user-flow request-start order.
 * `responseReceived` / `loadingFailed` later fill in status + body on
 * the existing event by `requestId`. This keeps the persisted order
 * deterministic even when responses complete out of order (concurrent
 * XHRs), which the downstream JMeter sampler reconstruction and token
 * correlation depend on.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright";
import { launchRecordingChromium } from "@/features/recording/infrastructure/browserLauncher";
import {
  getSession as getDomRecordingSession,
  tearDownCurrentSession as tearDownDomRecordingSession,
} from "@/features/recording/infrastructure/sessionState";
import type {
  JmxExportOptions,
  JmxHttpEvent,
} from "@/features/jmx/domain/types";
import {
  applyBodySizeCap,
  readLocationHeader,
  shouldCaptureBody,
} from "@/features/jmx/infrastructure/jmxBodyCaptureRules";
import {
  createSessionRow,
  finalizeSessionRow,
} from "@/features/jmx/infrastructure/jmxRecordingStore";
import { emitJmxXmlOrThrow } from "@/features/jmx/infrastructure/jmxEmitter";
import {
  projectRootFromProjectId,
  writeJmxFile,
} from "@/features/jmx/infrastructure/jmxFileWriter";
import {
  broadcastJmxCaptured,
  registerJmxScreencast,
  unregisterJmxScreencast,
} from "@/features/jmx/infrastructure/jmxScreencast";
import {
  cdpJmxAuthStateCapturer,
  safePageUrl,
  type JmxAuthStateCapturer,
} from "@/features/jmx/infrastructure/jmxAuthStateCapture";
import { saveAuthState } from "@/features/auth-states/infrastructure/authStateService";
import {
  advanceAndClassify,
  type BffEndpointClass,
} from "@/features/jmx/infrastructure/bffEndpointClassifier";
import { PROJECT_MARKER_FILE } from "@/features/projects/domain/paths";
import type { ProjectMarker } from "@/features/projects/domain/types";
import { refreshCurrentProjectFromDisk } from "@/features/projects/infrastructure/repositories/currentProjectRefresher";
import { logger } from "@/shared/logger";

/** Viewport for the JMX recorder's live canvas. Matches the DOM recorder default. */
const JMX_VIEWPORT = { width: 1280, height: 720 } as const;

interface ActiveSession {
  id: string;
  userId: string;
  projectId: string;
  jmxFileName: string;
  /**
   * Mirror of the project marker's `bff` flag, captured at session
   * start so the per-response capture decision doesn't have to hit
   * disk on every CDP `responseReceived`. Drives whether 3xx redirect
   * bodies are persisted (see `shouldCaptureBody`) AND whether the
   * BFF endpoint classifier is invoked at requestWillBeSent time
   * (when `false`, no `bffClass` is broadcast and the UI renders the
   * captured-rows panel without tags).
   */
  bff: boolean;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  /**
   * `false` while the session is in preview-only mode (browser is
   * live, screencast is streaming, but no CDP `Network.*` listeners
   * are attached so nothing is being recorded). Flips to `true` once
   * `armJmxRecording` attaches the listeners. The stop path skips
   * `.jmx` emission entirely when this is `false` on stop — there's
   * nothing to write.
   */
  isCapturing: boolean;
  /** Ordered by request-start; index === insertion order. */
  events: JmxHttpEvent[];
  /** CDP `requestId` → index into `events` for in-place response fill-in. */
  byRequestId: Map<string, number>;
  /** Classifier context loaded once from the project marker. */
  targetUrl: string;
  idpHosts: Set<string>;
  /**
   * Parallel array to `events` recording the class assigned to each
   * captured event at requestWillBeSent time. Kept so a future
   * "summary" panel can show per-class counts without re-running the
   * classifier; today only consumed by the unit tests.
   */
  eventClasses: (BffEndpointClass | null)[];
}

/**
 * Resource types CDP labels for sub-resources we never want to bake
 * into a JMeter plan — the user almost always cares about XHR/Fetch
 * and top-level document loads, not the CSS/font/image fan-out.
 */
const NOISY_RESOURCE_TYPES = new Set([
  "Image",
  "Font",
  "Stylesheet",
  "Media",
  "Manifest",
  "Other",
]);

const sessions = new Map<string, ActiveSession>();
const currentByUser = new Map<string, string>();

/**
 * The recorder's stop/arm code paths fail in three structurally
 * different ways and the workbench needs to react to each one
 * differently:
 *
 *  - **NotFound** — the in-memory session is gone (never existed, or
 *    was torn down by `crashCleanup` after the recorder browser was
 *    X'd / crashed). The right UX is to clear the toolbar's stale
 *    Stop button and tell the user the browser is no longer open,
 *    not surface a generic "bad request".
 *  - **NotOwned** — a different user is asking about somebody else's
 *    session. This is genuinely a 403.
 *  - Everything else (DB write fail, emit/write fail) — a 500.
 *
 * Before this differentiation existed the stop route mapped every
 * failure to a 400 with only the raw `Error.message`, so the actual
 * cause was invisible from the outside. The presentation layer maps
 * these typed errors to specific HTTP codes and emits a structured
 * `req.log.warn` line per non-2xx so the next regression is one
 * ripgrep away.
 */
export class JmxSessionNotFoundError extends Error {
  readonly code = "JMX_SESSION_NOT_FOUND" as const;
  constructor(message = "No active JMX recording session for this id") {
    super(message);
    this.name = "JmxSessionNotFoundError";
  }
}

export class JmxSessionNotOwnedError extends Error {
  readonly code = "JMX_SESSION_NOT_OWNED" as const;
  constructor(message = "JMX recording session is not owned by caller") {
    super(message);
    this.name = "JmxSessionNotOwnedError";
  }
}

export interface StartJmxRecordingArgs {
  userId: string;
  projectId: string;
  jmxFileName: string;
  /** Optional initial URL to navigate to. */
  startUrl?: string | null;
  /**
   * When `false`, the call opens the recorder browser in preview-only
   * mode: live canvas + click forwarding are wired up so the user can
   * drive the page, but the CDP `Network.*` listeners that capture
   * HTTP events are NOT attached. The session must later be promoted
   * via `armJmxRecording` to actually record. Defaults to `true` for
   * backward compatibility with the single-shot "click Start → opens
   * browser AND records" flow.
   */
  capture?: boolean;
}

export interface StartJmxRecordingResult {
  sessionId: string;
}

export interface StopJmxRecordingResult {
  sessionId: string;
  eventCount: number;
  /** Project-root-relative path of the emitted `.jmx` plan, or null when the emitter was skipped. */
  jmxFilePath: string | null;
  /** Non-fatal warnings (e.g. emitter skipped because the project marker was missing). */
  warnings: string[];
}

/**
 * Read the project's JMX export options off `.testbuilder.json`. JMX
 * projects persist `targetUrl` / `jwtAuth` on the marker; the rest of
 * the `JmxExportOptions` shape is downstream UI plumbing that defaults
 * conservatively here so finalize can run without it.
 */
async function loadExportOptionsFromMarker(
  projectId: string,
): Promise<JmxExportOptions | null> {
  let root: string;
  try {
    root = projectRootFromProjectId(projectId);
  } catch {
    // projectRootFromProjectId throws when the resolved path escapes
    // the workspace. The recorder treats this as "no marker
    // available" rather than a hard failure so test seams (and any
    // misconfigured project id) don't crash the start/stop flow.
    return null;
  }
  const markerPath = path.join(root, PROJECT_MARKER_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(markerPath, "utf8");
  } catch {
    return null;
  }
  let parsed: ProjectMarker;
  try {
    parsed = JSON.parse(raw) as ProjectMarker;
  } catch {
    return null;
  }
  const baseUrl = parsed.targetUrl;
  if (!baseUrl) return null;
  const ex = parsed.jmxExport ?? {};
  const out: JmxExportOptions = {
    embedCredentials: ex.embedCredentials === true,
    jwtAuth: parsed.jwtAuth === true,
    baseUrl,
    csvMode: ex.csvMode ?? "off",
    bff: parsed.bff === true,
  };
  if (ex.loginPath !== undefined) out.loginPath = ex.loginPath;
  if (ex.tokenJsonPath !== undefined) out.tokenJsonPath = ex.tokenJsonPath;
  return out;
}

/**
 * Read just the project's `bff` flag off `.testbuilder.json`. Lighter
 * than `loadExportOptionsFromMarker` because it doesn't require
 * `targetUrl` — a recording session can legitimately start before the
 * user has filled in the JMX export target. Missing / unparseable
 * markers (and legacy markers that pre-date the flag) yield `false`,
 * which is the historical pre-BFF behavior.
 */
async function loadBffFlagFromMarker(projectId: string): Promise<boolean> {
  let markerPath: string;
  try {
    const root = projectRootFromProjectId(projectId);
    markerPath = path.join(root, PROJECT_MARKER_FILE);
  } catch {
    // Project id doesn't resolve to a workspace-safe path (e.g. a
    // synthetic id used by unit tests) — treat it as a legacy / non-BFF
    // project rather than failing the session-start path.
    return false;
  }
  let raw: string;
  try {
    raw = await fs.readFile(markerPath, "utf8");
  } catch {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as ProjectMarker;
    return parsed.bff === true;
  } catch {
    return false;
  }
}

/** Exposed for integration tests of the finalize → emit path. */
export const _loadExportOptionsFromMarkerForTests = loadExportOptionsFromMarker;

/**
 * Resolve the `auth_states.project_name` slot for a JMX session. JMX
 * `projectId` is the URL-encoded `.jmxproject` slnPath; the workspace-
 * relative directory's basename is the canonical "solution name" the
 * DOM recorder uses for the same row, so the two sources line up in
 * the "Reuse logged-in session" picker without per-source branching.
 */
function solutionNameFromJmxProjectId(projectId: string): string {
  return path.basename(projectRootFromProjectId(projectId));
}

let activeAuthStateCapturer: JmxAuthStateCapturer = cdpJmxAuthStateCapturer;

/**
 * Override the BFF storageState capturer. Production wiring uses the
 * CDP-backed implementation; tests inject a stub so the lifecycle
 * hook can be exercised without a real Chromium / CDP session.
 */
export function setJmxAuthStateCapturerForTests(
  capturer: JmxAuthStateCapturer | null,
): void {
  activeAuthStateCapturer = capturer ?? cdpJmxAuthStateCapturer;
}

export async function startJmxRecording(
  args: StartJmxRecordingArgs,
): Promise<StartJmxRecordingResult> {
  if (!args.userId) throw new Error("Authentication required");
  if (!args.projectId.trim()) throw new Error("projectId is required");
  if (!args.jmxFileName.trim()) throw new Error("jmxFileName is required");
  const existingDom = getDomRecordingSession();
  if (existingDom) {
    // The DOM recording UI may have been closed without the session ever
    // being stopped (tab closed, browser crashed, project switched),
    // leaving an orphan that blocks every subsequent JMX recording. The
    // user has no way to see or stop it from the JMX project view, so
    // auto-tear-down here — but only when the orphan belongs to the same
    // user, so one user can never forcibly kill another user's live DOM
    // recording.
    if (existingDom.userId === args.userId) {
      await tearDownDomRecordingSession();
    } else {
      throw new Error(
        "A DOM recording session is already active — stop it before starting a JMX recording",
      );
    }
  }
  const existing = currentByUser.get(args.userId);
  if (existing) {
    throw new Error("A JMX recording session is already active for this user");
  }

  const sessionId = await createSessionRow({
    userId: args.userId,
    projectId: args.projectId.trim(),
    jmxFileName: args.jmxFileName.trim(),
  });

  const bff = await loadBffFlagFromMarker(args.projectId.trim());

  const browser = await launchRecordingChromium();
  const context = await browser.newContext({ viewport: { ...JMX_VIEWPORT } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  // Load marker once at session start so capture-time CDP callbacks
  // don't have to do disk I/O on the hot path. Falls back to non-BFF
  // mode if the marker can't be read (e.g. missing targetUrl) — the
  // classifier is then never invoked.
  const markerOpts = await loadExportOptionsFromMarker(args.projectId.trim());
  const session: ActiveSession = {
    id: sessionId,
    userId: args.userId,
    projectId: args.projectId.trim(),
    jmxFileName: args.jmxFileName.trim(),
    bff,
    browser,
    context,
    page,
    cdp,
    isCapturing: false,
    events: [],
    byRequestId: new Map(),
    targetUrl: markerOpts?.baseUrl ?? "",
    idpHosts: new Set<string>(),
    eventClasses: [],
  };

  const shouldCapture = args.capture !== false;
  if (shouldCapture) {
    await attachCdpCapture(session);
  }

  sessions.set(sessionId, session);
  currentByUser.set(args.userId, sessionId);

  // Wire the live-canvas pipeline (screencast + click/key/scroll
  // forwarding) so the user can actually drive the headless browser
  // from the workbench. Without this the JMX session is invisible.
  registerJmxScreencast({
    sessionId,
    userId: args.userId,
    page,
    viewport: { ...JMX_VIEWPORT },
  });

  // Crash / unexpected-close cleanup. Without these handlers, a
  // Chromium crash or a `window.close()` from a recorded page would
  // leave `sessions` / `currentByUser` / the screencast registry
  // populated forever — the user would be permanently blocked from
  // starting a new JMX recording ("already active") with no way to
  // recover short of restarting the api-server.
  const crashCleanup = (reason: string) => {
    if (!sessions.has(sessionId)) return; // normal stop already ran
    logger.warn({ sessionId, reason }, "JMX recorder: unexpected teardown");
    sessions.delete(sessionId);
    if (currentByUser.get(args.userId) === sessionId) {
      currentByUser.delete(args.userId);
    }
    unregisterJmxScreencast(sessionId);
    // Best-effort browser close — may already be dead.
    browser.close().catch(() => {});
  };
  page.on("close", () => crashCleanup("page_closed"));
  browser.on("disconnected", () => crashCleanup("browser_disconnected"));

  const startUrl = args.startUrl?.trim();
  if (startUrl) {
    page.goto(startUrl).catch(() => {
      // Initial navigation failures don't fail the start call —
      // the user can still drive the browser via the UI.
    });
  }

  return { sessionId };
}

/**
 * Attach the CDP `Network.*` listeners that record HTTP events onto
 * the session and flip `isCapturing` to `true`. Idempotent — calling
 * twice on the same session returns immediately without double-wiring
 * listeners (which would duplicate every captured request).
 */
async function attachCdpCapture(session: ActiveSession): Promise<void> {
  if (session.isCapturing) return;
  // Flip the flag BEFORE the async `Network.enable` so a second
  // concurrent caller (double-click on Start, retry on slow network)
  // sees `isCapturing === true` and bails at the guard above. Without
  // this, both callers would pass the guard, both would attach
  // listeners, and every captured request would be duplicated.
  session.isCapturing = true;
  try {
    await session.cdp.send("Network.enable");
  } catch (err) {
    // Roll back so a retry can re-attempt cleanly.
    session.isCapturing = false;
    throw err;
  }

  session.cdp.on("Network.requestWillBeSent", (params) => {
    try {
      // When Chromium follows a 3xx redirect it does NOT emit a
      // separate `Network.responseReceived` for the redirecting hop —
      // the intermediate response is delivered inline on the next
      // `requestWillBeSent` as `params.redirectResponse`. Fill in the
      // prior event's status + Location header here so OAuth
      // correlation (which keys off the `Location` of the IdP
      // `/authorize` 302) gets the data it needs. Without this the
      // redirect step is recorded with `statusCode: 0` and no
      // `locationHeader`, which strips the `state` regex extractor
      // from the emitted .jmx.
      const redirectResp = params.redirectResponse as
        | { status?: number; headers?: Record<string, string> }
        | undefined;
      if (redirectResp) {
        const priorIdx = session.byRequestId.get(params.requestId);
        if (priorIdx !== undefined) {
          const priorEvt = session.events[priorIdx];
          if (priorEvt) {
            priorEvt.statusCode = Number(redirectResp.status ?? 0);
            const priorLoc = readLocationHeader(redirectResp.headers ?? {});
            if (priorLoc) priorEvt.locationHeader = priorLoc;
          }
          // The redirected request reuses the same CDP requestId for
          // its eventual response. Drop the old mapping now; the new
          // event pushed below will reclaim it.
          session.byRequestId.delete(params.requestId);
        }
      }
      const resourceType = String(params.type ?? "Other");
      if (NOISY_RESOURCE_TYPES.has(resourceType)) return;
      const req = params.request;
      const headers = normalizeHeaders(req.headers);
      const evt: JmxHttpEvent = {
        method: (req.method ?? "GET").toUpperCase(),
        url: req.url,
        headers,
        contentType: headers["content-type"] ?? "",
        bodyText: typeof req.postData === "string" ? req.postData : "",
        statusCode: 0,
        responseBody: "",
        timestamp: Date.now(),
      };
      const idx = session.events.length;
      session.events.push(evt);
      session.byRequestId.set(params.requestId, idx);
      // BFF classification + live broadcast to the recorder UI. Only
      // runs when the project marker has `bff: true` (loaded once at
      // session start) so non-BFF projects pay no overhead and never
      // see tags. Routed through the shared `advanceAndClassify` so
      // the live `idpHosts` sticky-set grows in lockstep with the
      // offline emitter — a follow-up call to a host whose authorize/
      // token path was already seen classifies as `idp` even though
      // its own path isn't on the marker list. Without this, the on-
      // screen tags would disagree with the classes baked into the
      // emitted `.jmx`. An empty `targetUrl` (BFF project where the
      // user hasn't filled in the export URL yet) is tolerated by the
      // classifier — IdP detection still works, BFF detection falls
      // through to `upstream`.
      let cls: BffEndpointClass | null = null;
      if (session.bff) {
        cls = advanceAndClassify(evt, {
          targetUrl: session.targetUrl,
          idpHosts: session.idpHosts,
        });
      }
      session.eventClasses.push(cls);
      broadcastJmxCaptured(session.id, {
        method: evt.method,
        url: evt.url,
        statusCode: 0,
        timestamp: evt.timestamp,
        ...(cls ? { bffClass: cls } : {}),
      });
    } catch (err) {
      logger.warn({ err }, "JMX recorder: requestWillBeSent handler failed");
    }
  });

  session.cdp.on("Network.responseReceived", (params) => {
    void handleResponse(session, params).catch((err) => {
      logger.warn({ err }, "JMX recorder: responseReceived handler failed");
    });
  });

  session.cdp.on("Network.loadingFailed", (params) => {
    session.byRequestId.delete(params.requestId);
  });

  session.isCapturing = true;
}

/**
 * Promote a preview-only session to active capture. Used by the
 * workbench's "Start Recording" button when the auto-opened browser
 * is already live and the user has driven it to the desired starting
 * state. Only the session's owner may arm it.
 */
export async function armJmxRecording(args: {
  sessionId: string;
  userId: string;
}): Promise<{ sessionId: string }> {
  const session = sessions.get(args.sessionId);
  if (!session) throw new JmxSessionNotFoundError();
  if (session.userId !== args.userId) {
    throw new JmxSessionNotOwnedError();
  }
  await attachCdpCapture(session);
  return { sessionId: session.id };
}

async function handleResponse(
  session: ActiveSession,
  params: {
    requestId: string;
    response: { status: number; headers: Record<string, string> };
  },
): Promise<void> {
  const idx = session.byRequestId.get(params.requestId);
  if (idx === undefined) return;
  const evt = session.events[idx];
  if (!evt) return;
  const status = Number(params.response.status ?? 0);
  evt.statusCode = status;

  const responseHeaders = params.response.headers ?? {};
  // Always capture `Location` verbatim — cheap, useful for redirect
  // correlation even on non-BFF projects where we deliberately skip
  // the body. Empty string when absent so the field stays JSON-safe.
  const loc = readLocationHeader(responseHeaders);
  if (loc) evt.locationHeader = loc;

  const decision = shouldCaptureBody({
    headers: responseHeaders,
    status,
    bff: session.bff,
  });
  if (!decision.capture) {
    session.byRequestId.delete(params.requestId);
    return;
  }

  try {
    const body = await session.cdp.send("Network.getResponseBody", {
      requestId: params.requestId,
    });
    if (body && typeof body.body === "string") {
      // base64 == binary asset; leave the body empty rather than
      // baking unreadable bytes into a JMeter plan. (Should be
      // pre-filtered by shouldCaptureBody, but defend in depth.)
      if (!body.base64Encoded) {
        evt.responseBody = applyBodySizeCap(body.body);
      }
    }
  } catch {
    // Some responses (no-body, navigated-away) refuse
    // getResponseBody — keep the event with the empty body we set
    // at request-start time.
  }
  session.byRequestId.delete(params.requestId);
}

export async function stopJmxRecording(args: {
  sessionId: string;
  userId: string;
}): Promise<StopJmxRecordingResult> {
  const session = sessions.get(args.sessionId);
  if (!session) throw new JmxSessionNotFoundError();
  if (session.userId !== args.userId) {
    throw new JmxSessionNotOwnedError();
  }

  // Snapshot events before tearing down so a late CDP callback can't
  // mutate the persisted array out from under us. Insertion order is
  // already request-start order so no sort is needed.
  const events = session.events.slice();
  sessions.delete(session.id);
  if (currentByUser.get(session.userId) === session.id) {
    currentByUser.delete(session.userId);
  }

  // Stop the screencast loop + close attached WS clients before
  // closing the browser so a late screenshot tick can't race with
  // teardown and throw "Target closed" noise into the log.
  unregisterJmxScreencast(session.id);

  // BFF storageState capture (task #16). Must run BEFORE we detach
  // the CDP session / close the browser — `Network.getAllCookies`
  // and `Runtime.evaluate` both need the live target. Only runs when
  // the session actually recorded (preview-only sessions short-
  // circuit below anyway) and the project is BFF-flagged on disk.
  // Failures are logged and swallowed so a flaky capture never sinks
  // an otherwise-successful stop.
  if (session.isCapturing) {
    try {
      const bff = await loadBffFlagFromMarker(session.projectId);
      if (bff) {
        const state = await activeAuthStateCapturer.capture(session.cdp, {
          currentUrl: safePageUrl(session.page),
        });
        await saveAuthState({
          userId: session.userId,
          projectName: solutionNameFromJmxProjectId(session.projectId),
          label: `JMX session ${session.id}`,
          state,
        });
      }
    } catch (err) {
      logger.warn(
        { err, sessionId: session.id },
        "JMX recorder: BFF storageState capture failed",
      );
    }
  }

  try {
    await session.cdp.detach().catch(() => {});
    await session.browser.close().catch(() => {});
  } catch (err) {
    logger.warn({ err, sessionId: session.id }, "JMX recorder: teardown failed");
  }

  // Always finalize the DB row so we don't leak unfinalized
  // `stoppedAt = null` rows in `jmx_recording_sessions` for preview
  // sessions that the user closes without ever arming capture.
  await finalizeSessionRow({
    sessionId: session.id,
    userId: session.userId,
    events,
  });

  // A preview-only session never armed CDP capture, so there is no
  // `.jmx` to emit. The browser has already been closed above; just
  // return a clean empty result so the UI can flip back to idle
  // without surfacing a "no traffic captured" toast — the user never
  // asked to record in the first place.
  if (!session.isCapturing) {
    return {
      sessionId: session.id,
      eventCount: 0,
      jmxFilePath: null,
      warnings: [],
    };
  }

  // Emit the `.jmx` plan and index it on the marker. Failures here are
  // surfaced to the caller as `warnings` rather than thrown so a
  // structurally-valid recording isn't lost when the marker is missing
  // or the validator finds a credential leak.
  const warnings: string[] = [];
  let jmxFilePath: string | null = null;
  if (events.length > 0) {
    try {
      const options = await loadExportOptionsFromMarker(session.projectId);
      if (!options) {
        warnings.push(
          "Skipping JMX emit: project marker missing or has no targetUrl",
        );
      } else {
        const out = emitJmxXmlOrThrow(events, options);
        const written = await writeJmxFile({
          projectId: session.projectId,
          jmxFileName: session.jmxFileName,
          xml: out.xml,
        });
        jmxFilePath = written.relativePath;
        // Refresh the in-memory current-project cache so the
        // workbench's next `/api/projects/current` poll sees the
        // newly-emitted .jmx file. The on-disk marker was just
        // updated by `writeJmxFile`, but `currentProjectStore`
        // holds a snapshot from `loadProject` time and would
        // otherwise keep returning the stale `jmxFiles` list
        // until the user reloads or switches projects.
        await refreshCurrentProjectFromDisk(session.userId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, sessionId: session.id },
        "JMX recorder: emit/write failed",
      );
      warnings.push(`JMX emit failed: ${message}`);
    }
  }

  return {
    sessionId: session.id,
    eventCount: events.length,
    jmxFilePath,
    warnings,
  };
}

/**
 * Best-effort: lowercase header names and drop non-string values so
 * the persisted payload is round-trippable JSON.
 */
function normalizeHeaders(
  raw: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k.toLowerCase()] = v;
    else if (v != null) out[k.toLowerCase()] = String(v);
  }
  return out;
}

/**
 * Read-only peek used by the DOM recorder's start path so it can
 * refuse to launch on top of an active JMX session. Returns the
 * session id of any active JMX recording, or null.
 */
export function getActiveJmxSessionId(): string | null {
  if (sessions.size === 0) return null;
  const next = sessions.values().next();
  return next.done ? null : next.value.id;
}

/**
 * Look up the active JMX session id for a given user. Used by the
 * status endpoint so the workbench can discover an in-flight session
 * after a reload (the client-side `useJmxRecording` state is lost on
 * navigation; the server is the source of truth).
 */
export function getActiveJmxSessionIdForUser(userId: string): string | null {
  for (const sess of sessions.values()) {
    if (sess.userId === userId) return sess.id;
  }
  return null;
}

/**
 * Full status snapshot for the workbench's status poll: the active
 * session id (if any) plus whether CDP capture has been armed. The
 * UI uses `isCapturing` to distinguish the preview-browser phase
 * (Start Recording still actionable) from the live recording phase
 * (Stop Recording shown instead).
 */
export function getJmxStatusForUser(userId: string): {
  sessionId: string | null;
  isCapturing: boolean;
} {
  for (const sess of sessions.values()) {
    if (sess.userId === userId) {
      return { sessionId: sess.id, isCapturing: sess.isCapturing };
    }
  }
  return { sessionId: null, isCapturing: false };
}

/** Test seam — clears in-memory state without touching the DB. */
export function _resetJmxRecordingStateForTests(): void {
  sessions.clear();
  currentByUser.clear();
}

/**
 * Test seam: seed a fake active session into the in-memory maps so
 * the stop/arm code paths can be exercised without launching a real
 * Chromium. Callers supply just-enough stubs for `browser.close()` /
 * `cdp.detach()` plus a flag for whether CDP capture was armed.
 *
 * Used by the back-to-back regression test for task #7 — see
 * `__tests__/jmxRecordingService.stop.test.ts`. Not for production
 * code.
 */
export function _seedJmxSessionForTests(args: {
  sessionId: string;
  userId: string;
  projectId: string;
  jmxFileName: string;
  isCapturing?: boolean;
  bff?: boolean;
  events?: JmxHttpEvent[];
  browser?: { close: () => Promise<void>; on?: (...a: unknown[]) => void };
  cdp?: {
    detach: () => Promise<void>;
    send?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  };
  page?: { url?: () => string };
}): void {
  const stubBrowser =
    args.browser ?? { close: () => Promise.resolve(), on: () => {} };
  const stubCdp = args.cdp ?? { detach: () => Promise.resolve() };
  const stubPage = args.page ?? {};
  const session: ActiveSession = {
    id: args.sessionId,
    userId: args.userId,
    projectId: args.projectId,
    jmxFileName: args.jmxFileName,
    bff: args.bff === true,
    browser: stubBrowser as unknown as Browser,
    context: {} as BrowserContext,
    page: stubPage as unknown as Page,
    cdp: stubCdp as unknown as CDPSession,
    isCapturing: args.isCapturing ?? false,
    events: args.events ?? [],
    targetUrl: "",
    idpHosts: new Set<string>(),
    eventClasses: [],
    byRequestId: new Map(),
  };
  sessions.set(args.sessionId, session);
  currentByUser.set(args.userId, args.sessionId);
}

/**
 * Test seam: simulate the `crashCleanup` path (recorder browser
 * X'd / crashed / disconnected) so tests can prove that the next
 * `stopJmxRecording` returns the typed "not found" error rather
 * than a generic 400.
 */
export function _simulateCrashCleanupForTests(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  if (currentByUser.get(session.userId) === sessionId) {
    currentByUser.delete(session.userId);
  }
}

/** Test seam: snapshot of the maps so tests can assert clean state. */
export function _peekJmxStateForTests(): {
  sessionIds: string[];
  userIds: string[];
} {
  return {
    sessionIds: Array.from(sessions.keys()),
    userIds: Array.from(currentByUser.keys()),
  };
}
