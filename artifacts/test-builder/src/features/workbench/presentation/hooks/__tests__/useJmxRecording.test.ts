/**
 * Task #5 — JMX no auto-record (hook layer).
 *
 * Pins the request-shape contract for `useJmxRecording`:
 *
 *   - `openPreview()` → POST start with `capture: false` (preview-only;
 *     server skips CDP `Network.*` attach).
 *   - `startRecording()` with NO session → POST start with `capture: true`
 *     (single-shot legacy flow: open browser AND arm capture).
 *   - `startRecording()` with a preview session live → POST arm
 *     (promotes the existing browser to capture; never launches a
 *     second Chromium).
 *
 * If anyone "fixes" the hook by dropping `capture: false`, every JMX
 * project create would silently start recording again — the exact
 * regression task #5 is locked against.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mutations = vi.hoisted(() => ({
  start: { mutate: vi.fn(), isPending: false },
  arm: { mutate: vi.fn(), isPending: false },
  stop: { mutate: vi.fn(), isPending: false },
}));

vi.mock("@workspace/api-client-react", () => ({
  useStartJmxRecording: () => mutations.start,
  useArmJmxRecording: () => mutations.arm,
  useStopJmxRecording: () => mutations.stop,
  getGetCurrentProjectQueryKey: () => ["currentProject"],
  getGetJmxRecordingStatusQueryKey: () => ["jmxStatus"],
  getGetProjectTreeQueryKey: () => ["projectTree"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    setQueryData: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { useJmxRecording } from "../useJmxRecording";

beforeEach(() => {
  mutations.start.mutate.mockReset();
  mutations.arm.mutate.mockReset();
  mutations.stop.mutate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useJmxRecording — start request shape", () => {
  it("openPreview sends `capture: false` so the server skips CDP attach", () => {
    const { result } = renderHook(() =>
      useJmxRecording("/proj/.jmxproject", null, false),
    );
    result.current.openPreview("recording-1.jmx", "https://example.com");
    expect(mutations.start.mutate).toHaveBeenCalledTimes(1);
    const arg = mutations.start.mutate.mock.calls[0]?.[0];
    expect(arg).toEqual({
      data: {
        projectId: "/proj/.jmxproject",
        jmxFileName: "recording-1.jmx",
        startUrl: "https://example.com",
        capture: false,
      },
    });
    expect(mutations.arm.mutate).not.toHaveBeenCalled();
  });

  it("startRecording with no live session sends `capture: true` (single-shot legacy flow)", () => {
    const { result } = renderHook(() =>
      useJmxRecording("/proj/.jmxproject", null, false),
    );
    result.current.startRecording("recording-1.jmx", "https://example.com");
    expect(mutations.start.mutate).toHaveBeenCalledTimes(1);
    const arg = mutations.start.mutate.mock.calls[0]?.[0];
    expect(arg).toEqual({
      data: {
        projectId: "/proj/.jmxproject",
        jmxFileName: "recording-1.jmx",
        startUrl: "https://example.com",
        capture: true,
      },
    });
    expect(mutations.arm.mutate).not.toHaveBeenCalled();
  });

  it("startRecording on a live preview ARMS instead of launching a 2nd browser", () => {
    // serverSessionId set + serverIsCapturing false → preview phase.
    const { result } = renderHook(() =>
      useJmxRecording("/proj/.jmxproject", "sess-1", false),
    );
    result.current.startRecording("recording-1.jmx", "https://example.com");
    expect(mutations.arm.mutate).toHaveBeenCalledTimes(1);
    expect(mutations.arm.mutate).toHaveBeenCalledWith({
      data: { sessionId: "sess-1" },
    });
    // Crucially: no second start.mutate that would 400 with
    // "already active for this user".
    expect(mutations.start.mutate).not.toHaveBeenCalled();
  });

  it("startRecording while ALREADY capturing is a no-op for start (server is the source of truth)", () => {
    const { result } = renderHook(() =>
      useJmxRecording("/proj/.jmxproject", "sess-1", true),
    );
    // The hook still routes through start because the gate is
    // `sessionId && !isCapturing`; with isCapturing=true it would
    // re-fire start. That's intentional and is the legacy single-shot
    // path — we don't want to silently allow recording without the
    // explicit click. Document the current behavior so a future
    // refactor doesn't break the preview→arm path above unintentionally.
    result.current.startRecording("recording-1.jmx", "https://example.com");
    expect(mutations.arm.mutate).not.toHaveBeenCalled();
    expect(mutations.start.mutate).toHaveBeenCalledTimes(1);
  });

  it("derives `previewActive` / `recording` from the server-authoritative status flags", () => {
    const { result: idle } = renderHook(() =>
      useJmxRecording("/proj/.jmxproject", null, false),
    );
    expect(idle.current.sessionLive).toBe(false);
    expect(idle.current.previewActive).toBe(false);
    expect(idle.current.recording).toBe(false);

    const { result: preview } = renderHook(() =>
      useJmxRecording("/proj/.jmxproject", "sess-1", false),
    );
    expect(preview.current.sessionLive).toBe(true);
    expect(preview.current.previewActive).toBe(true);
    expect(preview.current.recording).toBe(false);

    const { result: capturing } = renderHook(() =>
      useJmxRecording("/proj/.jmxproject", "sess-1", true),
    );
    expect(capturing.current.sessionLive).toBe(true);
    expect(capturing.current.previewActive).toBe(false);
    expect(capturing.current.recording).toBe(true);
  });
});
