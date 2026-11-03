/**
 * Task #5 — JMX no auto-record.
 *
 * Locks in the three visible toolbar states for JMX recording, and
 * the auto-start-on-create wiring:
 *
 *   1. **No session** — only the "Start Recording" button.
 *   2. **Preview** (session live but `recording === false`) — "Start
 *      Recording" PLUS "Close Browser".
 *   3. **Capturing** (`recording === true`) — only "Stop Recording".
 *
 * Plus two behavior contracts:
 *   - The auto-start consumer (driven by `consumeJmxAutoStart`) opens
 *     the recorder browser in PREVIEW mode via `openPreview` — never
 *     `startRecording`. This is the core "no auto-record" guarantee.
 *   - Clicking "Start Recording" while a preview session is already
 *     live ARMS the existing session (calls `startRecording` on the
 *     hook) WITHOUT opening the name dialog and WITHOUT calling
 *     `openPreview` again — i.e. no second browser launch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const hookMock = vi.hoisted(() => ({
  openPreview: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  current: {
    sessionId: null as string | null,
    sessionLive: false,
    recording: false,
    previewActive: false,
    startPending: false,
    armPending: false,
    stopPending: false,
  },
}));

vi.mock("@/features/workbench/presentation/hooks/useJmxRecording", () => ({
  useJmxRecording: () => ({
    ...hookMock.current,
    openPreview: hookMock.openPreview,
    startRecording: hookMock.startRecording,
    stopRecording: hookMock.stopRecording,
  }),
}));

const autoStartMock = vi.hoisted(() => ({
  consume: vi.fn<(projectId: string) => boolean>(),
}));

vi.mock("@/features/workbench/presentation/hooks/jmx-auto-start", () => ({
  consumeJmxAutoStart: (projectId: string) => autoStartMock.consume(projectId),
}));

vi.mock("@/features/workbench/presentation/dialogs/name-jmx-file-dialog", () => ({
  NameJmxFileDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: (name: string) => void;
  }) =>
    open ? (
      <div data-testid="mock-name-dialog">
        <button
          type="button"
          data-testid="mock-name-dialog-confirm"
          onClick={() => onConfirm("recording-1.jmx")}
        />
      </div>
    ) : null,
}));

import { JmxRecordingControls } from "../toolbar/jmx-recording-controls";

function setHook(partial: Partial<typeof hookMock.current>): void {
  hookMock.current = { ...hookMock.current, ...partial };
}

beforeEach(() => {
  hookMock.openPreview.mockReset();
  hookMock.startRecording.mockReset();
  hookMock.stopRecording.mockReset();
  autoStartMock.consume.mockReset();
  autoStartMock.consume.mockReturnValue(false);
  setHook({
    sessionId: null,
    sessionLive: false,
    recording: false,
    previewActive: false,
    startPending: false,
    armPending: false,
    stopPending: false,
  });
});

afterEach(() => cleanup());

describe("<JmxRecordingControls /> toolbar states", () => {
  const baseProps = {
    projectId: "/proj/.jmxproject",
    jmxFiles: [] as readonly string[],
    targetUrl: "https://example.com",
  };

  it("renders only Start Recording when there is no session", () => {
    render(<JmxRecordingControls {...baseProps} />);
    expect(screen.getByTestId("button-start-recording")).toBeTruthy();
    expect(screen.queryByTestId("button-close-jmx-browser")).toBeNull();
    expect(screen.queryByTestId("button-stop-recording")).toBeNull();
  });

  it("renders Start Recording + Close Browser in preview mode", () => {
    setHook({
      sessionId: "sess-1",
      sessionLive: true,
      previewActive: true,
      recording: false,
    });
    render(<JmxRecordingControls {...baseProps} />);
    expect(screen.getByTestId("button-start-recording")).toBeTruthy();
    expect(screen.getByTestId("button-close-jmx-browser")).toBeTruthy();
    expect(screen.queryByTestId("button-stop-recording")).toBeNull();
  });

  it("renders only Stop Recording while capturing", () => {
    setHook({
      sessionId: "sess-1",
      sessionLive: true,
      previewActive: false,
      recording: true,
    });
    render(<JmxRecordingControls {...baseProps} />);
    expect(screen.getByTestId("button-stop-recording")).toBeTruthy();
    expect(screen.queryByTestId("button-start-recording")).toBeNull();
    expect(screen.queryByTestId("button-close-jmx-browser")).toBeNull();
  });
});

describe("<JmxRecordingControls /> auto-start", () => {
  it("opens the preview browser (NOT capture) when the auto-start marker fires", () => {
    autoStartMock.consume.mockReturnValue(true);
    render(
      <JmxRecordingControls
        projectId="/proj/.jmxproject"
        jmxFiles={[]}
        targetUrl="https://example.com"
      />,
    );
    expect(autoStartMock.consume).toHaveBeenCalledWith("/proj/.jmxproject");
    expect(hookMock.openPreview).toHaveBeenCalledTimes(1);
    expect(hookMock.openPreview).toHaveBeenCalledWith(
      "recording-1.jmx",
      "https://example.com",
    );
    // The auto path must never start capture.
    expect(hookMock.startRecording).not.toHaveBeenCalled();
  });

  it("does not auto-start when the marker is absent", () => {
    autoStartMock.consume.mockReturnValue(false);
    render(
      <JmxRecordingControls
        projectId="/proj/.jmxproject"
        jmxFiles={[]}
        targetUrl="https://example.com"
      />,
    );
    expect(hookMock.openPreview).not.toHaveBeenCalled();
    expect(hookMock.startRecording).not.toHaveBeenCalled();
  });

  it("does not auto-start when there is no targetUrl", () => {
    autoStartMock.consume.mockReturnValue(true);
    render(
      <JmxRecordingControls
        projectId="/proj/.jmxproject"
        jmxFiles={[]}
        targetUrl={null}
      />,
    );
    expect(hookMock.openPreview).not.toHaveBeenCalled();
  });

  it("does not auto-start when a session is already live", () => {
    autoStartMock.consume.mockReturnValue(true);
    setHook({
      sessionId: "sess-1",
      sessionLive: true,
      previewActive: true,
    });
    render(
      <JmxRecordingControls
        projectId="/proj/.jmxproject"
        jmxFiles={[]}
        targetUrl="https://example.com"
      />,
    );
    // sessionLive short-circuits before we consume the marker.
    expect(autoStartMock.consume).not.toHaveBeenCalled();
    expect(hookMock.openPreview).not.toHaveBeenCalled();
  });
});

describe("<JmxRecordingControls /> Start Recording click", () => {
  it("on a live preview, arms the session without opening the name dialog", () => {
    setHook({
      sessionId: "sess-1",
      sessionLive: true,
      previewActive: true,
    });
    render(
      <JmxRecordingControls
        projectId="/proj/.jmxproject"
        jmxFiles={[]}
        targetUrl="https://example.com"
      />,
    );
    fireEvent.click(screen.getByTestId("button-start-recording"));
    expect(screen.queryByTestId("mock-name-dialog")).toBeNull();
    expect(hookMock.startRecording).toHaveBeenCalledTimes(1);
    expect(hookMock.startRecording).toHaveBeenCalledWith(
      "recording-1.jmx",
      "https://example.com",
    );
    // No second openPreview — the existing preview is reused.
    expect(hookMock.openPreview).not.toHaveBeenCalled();
  });

  it("with no session, opens the name dialog and confirms a fresh capture-on-create", () => {
    render(
      <JmxRecordingControls
        projectId="/proj/.jmxproject"
        jmxFiles={[]}
        targetUrl="https://example.com"
      />,
    );
    fireEvent.click(screen.getByTestId("button-start-recording"));
    expect(screen.getByTestId("mock-name-dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("mock-name-dialog-confirm"));
    expect(hookMock.startRecording).toHaveBeenCalledTimes(1);
    expect(hookMock.startRecording).toHaveBeenCalledWith(
      "recording-1.jmx",
      "https://example.com",
    );
  });
});
