/**
 * Task #13 — JMX OAuth redirect body capture (integration).
 *
 * Drives the recorder end-to-end through a stub CDP event stream
 * shaped like the OAuth/OIDC dance:
 *   1.  GET  /login           → 302 to IdP authorize          (redirect)
 *   2.  GET  /authorize       → 200 text/html with `state`     (HTML)
 *   3.  POST /token           → 200 application/json bearer    (JSON)
 *
 * On a **BFF** project all three response bodies must end up on the
 * captured events plus the `locationHeader` of step 1. On a **non-BFF**
 * project the redirect body must remain empty (pre-task #13 behavior)
 * while the 200s are still captured exactly as before — a regression
 * snapshot so we don't accidentally widen the capture matrix for
 * non-BFF projects.
 *
 * Browser orchestration is faked via the same `playwrightMocks` shape
 * the sibling `capture: false` test uses; the marker-file read is
 * stubbed via `vi.mock("node:fs/promises")` so we don't have to lay
 * down real `.testbuilder.json` files on disk.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";

type CdpListener = (params: unknown) => void;

const playwrightMocks = vi.hoisted(() => {
  // Map of CDP event name → listener registered by the recorder.
  const listeners = new Map<string, CdpListener>();
  // Map of CDP request id → response body the stub should hand back
  // when the recorder calls `Network.getResponseBody`.
  const bodyByRequestId = new Map<
    string,
    { body: string; base64Encoded: boolean }
  >();

  const cdp = {
    send: vi.fn(async (cmd: string, params?: { requestId?: string }) => {
      if (cmd === "Network.getResponseBody") {
        const id = params?.requestId ?? "";
        const body = bodyByRequestId.get(id);
        if (!body) return { body: "", base64Encoded: false };
        return body;
      }
      return undefined;
    }),
    on: vi.fn((evt: string, handler: CdpListener) => {
      listeners.set(evt, handler);
    }),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const page = {
    on: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    newCDPSession: vi.fn().mockResolvedValue(cdp),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };

  return { cdp, page, context, browser, listeners, bodyByRequestId };
});

vi.mock("@/features/recording/infrastructure/browserLauncher", () => ({
  launchRecordingChromium: vi.fn(async () => playwrightMocks.browser),
}));

vi.mock("@/features/recording/infrastructure/sessionState", () => ({
  getSession: () => null,
}));

vi.mock("@/features/jmx/infrastructure/jmxRecordingStore", () => ({
  createSessionRow: vi.fn(async () => "sess-bff-1"),
  finalizeSessionRow: vi.fn(async () => undefined),
}));

const broadcastMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/jmx/infrastructure/jmxScreencast", () => ({
  registerJmxScreencast: vi.fn(),
  unregisterJmxScreencast: vi.fn(),
  broadcastJmxCaptured: broadcastMock,
}));

// Bypass the workspace-relative path guard so the recorder can
// "resolve" our synthetic test project id without throwing — the
// marker contents themselves are produced by the readFile mock below.
vi.mock("@/features/jmx/infrastructure/jmxFileWriter", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/jmx/infrastructure/jmxFileWriter")
  >("@/features/jmx/infrastructure/jmxFileWriter");
  return {
    ...actual,
    projectRootFromProjectId: vi.fn(
      () => "/tmp/jmx-bff-capture-test-project",
    ),
  };
});

// Stub the marker-file read so each test can flip `bff` without
// touching disk. The recorder only reads `PROJECT_MARKER_FILE` and
// returns `false` on any error, so a single thenable `readFile`
// returning JSON is enough.
const markerState = vi.hoisted(() => ({
  bff: false,
  targetUrl: undefined as string | undefined,
}));
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  const readFile = vi.fn(async (p: string, enc?: BufferEncoding) => {
    if (typeof p === "string" && p.endsWith(".testbuilder.json")) {
      const obj: Record<string, unknown> = {
        architectureId: "jmx",
        testProjectName: "t",
        namespace: "n",
        solutionName: "s",
        bff: markerState.bff,
      };
      if (markerState.targetUrl !== undefined) {
        obj.targetUrl = markerState.targetUrl;
      }
      return JSON.stringify(obj);
    }
    return actual.readFile(p, enc);
  });
  return {
    ...actual,
    // Recorder uses `import fs from "node:fs/promises"` so both the
    // namespace AND the default export need the patched readFile.
    default: { ...actual, readFile },
    readFile,
  };
});

import {
  startJmxRecording,
  stopJmxRecording,
  _peekJmxStateForTests,
  _resetJmxRecordingStateForTests,
} from "@/features/jmx/infrastructure/jmxRecordingService";

const USER = "user-bff";
const PROJECT = "/tmp/.jmxproject-bff";

function requestWillBeSent(requestId: string, url: string, method = "GET") {
  const handler = playwrightMocks.listeners.get("Network.requestWillBeSent");
  if (!handler) throw new Error("requestWillBeSent listener not registered");
  handler({
    requestId,
    type: "Document",
    request: {
      method,
      url,
      headers: {},
    },
  });
}

async function responseReceived(
  requestId: string,
  status: number,
  headers: Record<string, string>,
) {
  const handler = playwrightMocks.listeners.get("Network.responseReceived");
  if (!handler) throw new Error("responseReceived listener not registered");
  // Recorder schedules getResponseBody as a `void .catch(...)` —
  // wait long enough for the chained microtasks (async fn entry,
  // CDP send mock resolution, continuation) to settle before we
  // move on to assertions / the next event.
  handler({ requestId, response: { status, headers } });
  await new Promise((resolve) => setTimeout(resolve, 10));
}

beforeEach(() => {
  _resetJmxRecordingStateForTests();
  playwrightMocks.listeners.clear();
  playwrightMocks.bodyByRequestId.clear();
  playwrightMocks.cdp.send.mockClear();
  playwrightMocks.cdp.on.mockClear();
  broadcastMock.mockClear();
  markerState.bff = false;
  markerState.targetUrl = undefined;
});

afterEach(() => {
  _resetJmxRecordingStateForTests();
});

describe("JMX recorder — BFF redirect body capture (task #13)", () => {
  it("captures redirect body + locationHeader on a BFF project", async () => {
    markerState.bff = true;
    playwrightMocks.bodyByRequestId.set("req-1", {
      body: "<html>redirecting…</html>",
      base64Encoded: false,
    });
    playwrightMocks.bodyByRequestId.set("req-2", {
      body: '<html><input name="state" value="abc123"></html>',
      base64Encoded: false,
    });
    playwrightMocks.bodyByRequestId.set("req-3", {
      body: '{"access_token":"tok.123"}',
      base64Encoded: false,
    });

    await startJmxRecording({
      userId: USER,
      projectId: PROJECT,
      jmxFileName: "rec.jmx",
      capture: true,
    });

    requestWillBeSent("req-1", "https://app.example.com/login");
    await responseReceived("req-1", 302, {
      Location: "https://idp.example.com/authorize?state=abc123",
      "content-type": "text/html",
    });
    requestWillBeSent("req-2", "https://idp.example.com/authorize");
    await responseReceived("req-2", 200, { "content-type": "text/html" });
    requestWillBeSent("req-3", "https://app.example.com/token", "POST");
    await responseReceived("req-3", 200, { "content-type": "application/json" });

    const stopped = await stopJmxRecording({
      sessionId: "sess-bff-1",
      userId: USER,
    });
    expect(stopped.eventCount).toBe(3);

    // Pull the captured events out of the finalize mock.
    const { finalizeSessionRow } = await import(
      "@/features/jmx/infrastructure/jmxRecordingStore"
    );
    const finalizeMock = finalizeSessionRow as unknown as ReturnType<
      typeof vi.fn
    >;
    const [arg] = finalizeMock.mock.calls.at(-1) ?? [];
    const events = (arg as { events: Array<Record<string, unknown>> }).events;

    expect(events).toHaveLength(3);
    expect(events[0]?.statusCode).toBe(302);
    expect(events[0]?.responseBody).toBe("<html>redirecting…</html>");
    expect(events[0]?.locationHeader).toBe(
      "https://idp.example.com/authorize?state=abc123",
    );
    expect(events[1]?.responseBody).toContain('name="state"');
    expect(events[2]?.responseBody).toBe('{"access_token":"tok.123"}');

    expect(_peekJmxStateForTests().sessionIds).toEqual([]);
  });

  it("non-BFF project keeps the pre-task-13 behavior (no redirect body)", async () => {
    markerState.bff = false;
    playwrightMocks.bodyByRequestId.set("req-1", {
      body: "<html>this should NOT be captured</html>",
      base64Encoded: false,
    });
    playwrightMocks.bodyByRequestId.set("req-2", {
      body: '{"ok":true}',
      base64Encoded: false,
    });

    await startJmxRecording({
      userId: USER,
      projectId: PROJECT,
      jmxFileName: "rec.jmx",
      capture: true,
    });

    requestWillBeSent("req-1", "https://app.example.com/login");
    await responseReceived("req-1", 302, {
      Location: "https://idp.example.com/authorize",
      "content-type": "text/html",
    });
    requestWillBeSent("req-2", "https://app.example.com/me");
    await responseReceived("req-2", 200, { "content-type": "application/json" });

    await stopJmxRecording({ sessionId: "sess-bff-1", userId: USER });

    const { finalizeSessionRow } = await import(
      "@/features/jmx/infrastructure/jmxRecordingStore"
    );
    const finalizeMock = finalizeSessionRow as unknown as ReturnType<
      typeof vi.fn
    >;
    const [arg] = finalizeMock.mock.calls.at(-1) ?? [];
    const events = (arg as { events: Array<Record<string, unknown>> }).events;

    // 302 was captured but its body was deliberately dropped on a
    // non-BFF project — only the location header survived.
    expect(events[0]?.statusCode).toBe(302);
    expect(events[0]?.responseBody).toBe("");
    expect(events[0]?.locationHeader).toBe("https://idp.example.com/authorize");
    // The JSON 200 is still captured exactly as before.
    expect(events[1]?.responseBody).toBe('{"ok":true}');

    // Did the recorder even ASK for the redirect body? It shouldn't
    // have — `shouldCaptureBody` returned false and the CDP call was
    // skipped. Asserting this guards the perf side of the contract,
    // not just the persisted output.
    const getBodyCalls = playwrightMocks.cdp.send.mock.calls.filter(
      ([cmd, params]) =>
        cmd === "Network.getResponseBody" &&
        (params as { requestId?: string } | undefined)?.requestId === "req-1",
    );
    expect(getBodyCalls).toHaveLength(0);
  });

  it("BFF project: oversized response bodies are truncated with the marker", async () => {
    markerState.bff = true;
    const big = "y".repeat(300 * 1024); // > MAX_RESPONSE_BODY_BYTES
    playwrightMocks.bodyByRequestId.set("req-big", {
      body: big,
      base64Encoded: false,
    });

    await startJmxRecording({
      userId: USER,
      projectId: PROJECT,
      jmxFileName: "rec.jmx",
      capture: true,
    });

    requestWillBeSent("req-big", "https://idp.example.com/authorize");
    await responseReceived("req-big", 200, { "content-type": "text/html" });

    await stopJmxRecording({ sessionId: "sess-bff-1", userId: USER });

    const { finalizeSessionRow } = await import(
      "@/features/jmx/infrastructure/jmxRecordingStore"
    );
    const finalizeMock = finalizeSessionRow as unknown as ReturnType<
      typeof vi.fn
    >;
    const [arg] = finalizeMock.mock.calls.at(-1) ?? [];
    const events = (arg as { events: Array<Record<string, unknown>> }).events;
    const body = events[0]?.responseBody as string;
    expect(body.length).toBeLessThan(big.length);
    expect(body).toMatch(/truncated/);
  });

  it("BFF project: binary 2xx bodies are not captured", async () => {
    markerState.bff = true;
    playwrightMocks.bodyByRequestId.set("req-bin", {
      body: "AAECAw==",
      base64Encoded: true,
    });

    await startJmxRecording({
      userId: USER,
      projectId: PROJECT,
      jmxFileName: "rec.jmx",
      capture: true,
    });

    requestWillBeSent("req-bin", "https://app.example.com/logo");
    await responseReceived("req-bin", 200, { "content-type": "image/png" });
    await stopJmxRecording({ sessionId: "sess-bff-1", userId: USER });

    const { finalizeSessionRow } = await import(
      "@/features/jmx/infrastructure/jmxRecordingStore"
    );
    const finalizeMock = finalizeSessionRow as unknown as ReturnType<
      typeof vi.fn
    >;
    const [arg] = finalizeMock.mock.calls.at(-1) ?? [];
    const events = (arg as { events: Array<Record<string, unknown>> }).events;
    expect(events[0]?.responseBody).toBe("");
  });

  it("broadcasts bffClass on every captured row and grows the IdP sticky set live (task #18)", async () => {
    markerState.bff = true;
    markerState.targetUrl = "https://app.example.com";

    await startJmxRecording({
      userId: USER,
      projectId: PROJECT,
      jmxFileName: "rec.jmx",
      capture: true,
    });

    // 1. Same-origin BFF request → "bff"
    requestWillBeSent("req-1", "https://app.example.com/login");
    await responseReceived("req-1", 200, { "content-type": "text/html" });
    // 2. Cross-origin authorize → "idp" via marker path AND promotes
    //    the host into the sticky set.
    requestWillBeSent("req-2", "https://idp.example.com/oauth2/authorize");
    await responseReceived("req-2", 200, { "content-type": "text/html" });
    // 3. Cross-origin call on the same IdP host with a NON-marker
    //    path → still "idp" because the sticky set advanced live.
    //    This is the on-screen regression the task fixes — before
    //    the live path went through `advanceAndClassify` this row
    //    fell through to "upstream" even though the offline emitter
    //    classified it as "idp".
    requestWillBeSent("req-3", "https://idp.example.com/userinfo");
    await responseReceived("req-3", 200, { "content-type": "application/json" });
    // 4. Genuinely third-party host → "upstream"
    requestWillBeSent("req-4", "https://api.third.com/v1/widgets");
    await responseReceived("req-4", 200, { "content-type": "application/json" });

    await stopJmxRecording({ sessionId: "sess-bff-1", userId: USER });

    const classes = broadcastMock.mock.calls.map(
      ([, row]) => (row as { bffClass?: string }).bffClass,
    );
    expect(classes).toEqual(["bff", "idp", "idp", "upstream"]);
  });

  it("BFF project: 3xx redirect Location is captured from redirectResponse (task #51)", async () => {
    // Chromium delivers the IdP `/authorize` 302's headers inline on
    // the FOLLOW-UP `requestWillBeSent` as `redirectResponse`, not as
    // a separate `responseReceived`. Without the redirectResponse
    // handler the locationHeader is dropped, which strips the OAuth
    // `state` regex extractor from the emitted .jmx.
    markerState.bff = true;
    markerState.targetUrl = "https://app.example.com";

    await startJmxRecording({
      userId: USER,
      projectId: PROJECT,
      jmxFileName: "rec.jmx",
      capture: true,
    });

    // 1. GET /authorize  -- recorded normally
    requestWillBeSent("req-r", "https://idp.example.com/authorize");
    // 2. Chromium follows the 302. Same requestId, redirectResponse
    //    carries the 302's status + Location.
    const handler = playwrightMocks.listeners.get(
      "Network.requestWillBeSent",
    );
    if (!handler) throw new Error("requestWillBeSent listener missing");
    handler({
      requestId: "req-r",
      type: "Document",
      request: {
        method: "GET",
        url: "https://app.example.com/callback?code=c.123&state=s.abc",
        headers: {},
      },
      redirectResponse: {
        status: 302,
        headers: {
          Location:
            "https://app.example.com/callback?code=c.123&state=s.abc",
          "content-type": "text/html",
        },
      },
    });
    // 3. Final 200 for the callback request.
    await responseReceived("req-r", 200, { "content-type": "text/html" });

    await stopJmxRecording({ sessionId: "sess-bff-1", userId: USER });

    const { finalizeSessionRow } = await import(
      "@/features/jmx/infrastructure/jmxRecordingStore"
    );
    const finalizeMock = finalizeSessionRow as unknown as ReturnType<
      typeof vi.fn
    >;
    const [arg] = finalizeMock.mock.calls.at(-1) ?? [];
    const events = (arg as { events: Array<Record<string, unknown>> }).events;

    expect(events).toHaveLength(2);
    expect(events[0]?.url).toBe("https://idp.example.com/authorize");
    expect(events[0]?.statusCode).toBe(302);
    expect(events[0]?.locationHeader).toBe(
      "https://app.example.com/callback?code=c.123&state=s.abc",
    );
    expect(events[1]?.url).toBe(
      "https://app.example.com/callback?code=c.123&state=s.abc",
    );
    expect(events[1]?.statusCode).toBe(200);
  });

  it("non-BFF project: bffClass is NEVER broadcast (UI stays unchanged)", async () => {
    markerState.bff = false;

    await startJmxRecording({
      userId: USER,
      projectId: PROJECT,
      jmxFileName: "rec.jmx",
      capture: true,
    });

    requestWillBeSent("req-1", "https://app.example.com/login");
    await responseReceived("req-1", 200, { "content-type": "text/html" });
    requestWillBeSent("req-2", "https://idp.example.com/oauth2/authorize");
    await responseReceived("req-2", 200, { "content-type": "text/html" });

    await stopJmxRecording({ sessionId: "sess-bff-1", userId: USER });

    for (const [, row] of broadcastMock.mock.calls) {
      expect((row as { bffClass?: string }).bffClass).toBeUndefined();
    }
  });
});
