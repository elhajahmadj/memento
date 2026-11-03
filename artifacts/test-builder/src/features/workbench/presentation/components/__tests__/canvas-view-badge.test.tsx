import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CanvasView } from "../recording-canvas/canvas-view";
import type { FrameMsg } from "@/features/workbench/domain/types";

/**
 * The canvas header must tell the truth about whether anything is being
 * captured.
 *
 * The server marks an open-browser session `phase: "recording"` so the
 * frame stream and input forwarding work before the session is
 * attached. The header keyed off that, so merely opening a browser
 * displayed a pulsing red RECORDING badge — nothing was being recorded
 * until the user clicked Start Recording.
 */
afterEach(cleanup);

const frame: FrameMsg = { data: "AAAA", width: 800, height: 600 };

function renderView(recording: boolean, capturing: boolean) {
  render(
    <CanvasView
      recording={recording}
      capturing={capturing}
      frame={frame}
      liveUrl="https://example.com/"
      wsRef={{ current: null }}
    />,
  );
}

describe("CanvasView header", () => {
  it("says BROWSING, not RECORDING, before the session is attached", () => {
    renderView(true, false);
    expect(screen.getByTestId("text-recording-browsing")).toBeDefined();
    expect(screen.queryByText("RECORDING")).toBeNull();
  });

  it("explains how to start capturing while browsing", () => {
    renderView(true, false);
    expect(
      screen.getByTestId("text-recording-browsing").textContent,
    ).toMatch(/nothing is being recorded yet/i);
  });

  it("says RECORDING once actually capturing", () => {
    renderView(true, true);
    expect(screen.getByText("RECORDING")).toBeDefined();
    expect(screen.queryByTestId("text-recording-browsing")).toBeNull();
  });

  it("still shows STOPPED when the session has ended", () => {
    renderView(false, false);
    expect(screen.getByTestId("text-recording-stopped")).toBeDefined();
    expect(screen.queryByTestId("text-recording-browsing")).toBeNull();
  });

  it("keeps the live frame visible while browsing", () => {
    // The browser must stay usable pre-attach — this is the whole point
    // of the open-browser flow, so `recording` still drives the frame.
    renderView(true, false);
    expect(screen.getByTestId("recording-canvas")).toBeDefined();
    expect(screen.getByTestId("text-recording-viewport")).toBeDefined();
  });
});
