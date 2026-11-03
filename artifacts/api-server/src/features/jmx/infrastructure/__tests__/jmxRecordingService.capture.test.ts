/**
 * Task #5 — JMX no auto-record (server layer).
 *
 * The contract `useJmxRecording` relies on is enforced HERE:
 * `startJmxRecording({ capture: false })` opens the browser but must
 * NOT attach the CDP `Network.*` listeners. Recording only begins
 * when `armJmxRecording` is later called (e.g. by the toolbar's Start
 * Recording button on a live preview).
 *
 * We assert this by spying on `cdp.send("Network.enable", ...)` —
 * which is the single side effect that promotes a session from
 * preview to capture. If a future refactor accidentally re-enables
 * capture on every start, this test fires.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";

const playwrightMocks = vi.hoisted(() => {
  const cdp = {
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
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
  return { cdp, page, context, browser };
});

vi.mock("@/features/recording/infrastructure/browserLauncher", () => ({
  launchRecordingChromium: vi.fn(async () => playwrightMocks.browser),
}));

vi.mock("@/features/recording/infrastructure/sessionState", () => ({
  getSession: () => null,
}));

vi.mock("@/features/jmx/infrastructure/jmxRecordingStore", () => ({
  createSessionRow: vi.fn(async () => "sess-test-1"),
  finalizeSessionRow: vi.fn(async () => undefined),
}));

vi.mock("@/features/jmx/infrastructure/jmxScreencast", () => ({
  registerJmxScreencast: vi.fn(),
  unregisterJmxScreencast: vi.fn(),
}));

import {
  startJmxRecording,
  armJmxRecording,
  stopJmxRecording,
  _resetJmxRecordingStateForTests,
  getJmxStatusForUser,
} from "@/features/jmx/infrastructure/jmxRecordingService";

const USER = "user-a";
const PROJECT = "/tmp/.jmxproject";

beforeEach(() => {
  _resetJmxRecordingStateForTests();
  playwrightMocks.cdp.send.mockClear();
  playwrightMocks.cdp.on.mockClear();
  playwrightMocks.cdp.detach.mockClear();
  playwrightMocks.browser.close.mockClear();
});

afterEach(() => {
  _resetJmxRecordingStateForTests();
});

describe("startJmxRecording — capture: false", () => {
  it("does NOT attach CDP Network.* listeners when started with capture: false", async () => {
    const res = await startJmxRecording({
      userId: USER,
      projectId: PROJECT,
      jmxFileName: "recording-1.jmx",
      startUrl: "https://example.com",
      capture: false,
    });
    expect(res.sessionId).toBe("sess-test-1");

    // Network.enable is the single guarded gate for capture. If it's
    // never sent, no requestWillBeSent / responseReceived listeners
    // can have fired — nothing is being recorded.
    const networkEnableCalls = playwrightMocks.cdp.send.mock.calls.filter(
      ([cmd]) => cmd === "Network.enable",
    );
    expect(networkEnableCalls).toHaveLength(0);
    // Likewise: no Network.* event subscribers on the CDP session.
    const networkOnCalls = playwrightMocks.cdp.on.mock.calls.filter(
      ([evt]) =>
        typeof evt === "string" && (evt as string).startsWith("Network."),
    );
    expect(networkOnCalls).toHaveLength(0);

    // And the status snapshot must reflect "preview, not capturing".
    expect(getJmxStatusForUser(USER)).toEqual({
      sessionId: "sess-test-1",
      isCapturing: false,
    });
  });

  it("attaches CDP Network.* listeners after armJmxRecording is called", async () => {
    await startJmxRecording({
      userId: USER,
      projectId: PROJECT,
      jmxFileName: "recording-1.jmx",
      startUrl: "https://example.com",
      capture: false,
    });

    await armJmxRecording({ sessionId: "sess-test-1", userId: USER });

    const networkEnableCalls = playwrightMocks.cdp.send.mock.calls.filter(
      ([cmd]) => cmd === "Network.enable",
    );
    expect(networkEnableCalls).toHaveLength(1);
    const subscribedEvents = playwrightMocks.cdp.on.mock.calls
      .map(([evt]) => evt)
      .filter(
        (evt): evt is string =>
          typeof evt === "string" && evt.startsWith("Network."),
      );
    expect(subscribedEvents).toEqual(
      expect.arrayContaining([
        "Network.requestWillBeSent",
        "Network.responseReceived",
        "Network.loadingFailed",
      ]),
    );
    expect(getJmxStatusForUser(USER).isCapturing).toBe(true);
  });

  it("attaches CDP listeners immediately when started with capture: true (legacy single-shot)", async () => {
    await startJmxRecording({
      userId: USER,
      projectId: PROJECT,
      jmxFileName: "recording-1.jmx",
      startUrl: "https://example.com",
      capture: true,
    });
    const networkEnableCalls = playwrightMocks.cdp.send.mock.calls.filter(
      ([cmd]) => cmd === "Network.enable",
    );
    expect(networkEnableCalls).toHaveLength(1);
    expect(getJmxStatusForUser(USER).isCapturing).toBe(true);
  });

  it("stopping a preview-only session emits no .jmx file (nothing was recorded)", async () => {
    await startJmxRecording({
      userId: USER,
      projectId: PROJECT,
      jmxFileName: "recording-1.jmx",
      startUrl: "https://example.com",
      capture: false,
    });
    const res = await stopJmxRecording({
      sessionId: "sess-test-1",
      userId: USER,
    });
    expect(res.eventCount).toBe(0);
    expect(res.jmxFilePath).toBeNull();
    expect(res.warnings).toEqual([]);
  });
});
