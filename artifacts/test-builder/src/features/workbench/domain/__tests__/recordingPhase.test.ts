import { describe, expect, it } from "vitest";
import { deriveRecordingPhase } from "../recordingPhase";

describe("deriveRecordingPhase", () => {
  it("defaults to idle when status is missing", () => {
    expect(deriveRecordingPhase(undefined)).toEqual({
      phase: "idle",
      recording: false,
      stopped: false,
      sessionLive: false,
      openBrowserPreAttach: false,
    });
    expect(deriveRecordingPhase(null)).toEqual({
      phase: "idle",
      recording: false,
      stopped: false,
      sessionLive: false,
      openBrowserPreAttach: false,
    });
  });

  it("treats unknown phases as idle", () => {
    expect(deriveRecordingPhase({ phase: "finished" }).phase).toBe("idle");
  });

  it("marks recording phase as live", () => {
    const d = deriveRecordingPhase({
      phase: "recording",
      methodName: "myMethod",
      targetClass: "MyClass",
    });
    expect(d.phase).toBe("recording");
    expect(d.recording).toBe(true);
    expect(d.stopped).toBe(false);
    expect(d.sessionLive).toBe(true);
    expect(d.openBrowserPreAttach).toBe(false);
  });

  it("marks stopped phase as live but not recording", () => {
    const d = deriveRecordingPhase({ phase: "stopped" });
    expect(d.phase).toBe("stopped");
    expect(d.recording).toBe(false);
    expect(d.stopped).toBe(true);
    expect(d.sessionLive).toBe(true);
    expect(d.openBrowserPreAttach).toBe(false);
  });

  it("detects open-browser pre-attach when method and target are absent", () => {
    const d = deriveRecordingPhase({
      phase: "recording",
      methodName: null,
      targetClass: null,
    });
    expect(d.openBrowserPreAttach).toBe(true);
  });

  it("does not flag pre-attach when methodName is set", () => {
    const d = deriveRecordingPhase({
      phase: "recording",
      methodName: "x",
      targetClass: null,
    });
    expect(d.openBrowserPreAttach).toBe(false);
  });
});
