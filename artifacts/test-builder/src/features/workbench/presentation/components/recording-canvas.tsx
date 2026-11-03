import { useState, useEffect, useRef } from "react";
import { useGetCurrentProject } from "@workspace/api-client-react";
import { useGetRecordingStatus } from "@workspace/api-client-react";
import type { FrameMsg } from "@/features/workbench/domain/types";

import { CanvasView } from "./recording-canvas/canvas-view";
import { FillPromptDialog, computeFillNameError } from "./recording-canvas/fill-prompt-dialog";
import { NamePromptDialog } from "./recording-canvas/name-prompt-dialog";
import { useRecordingWebSocket } from "./recording-canvas/use-recording-websocket";
import {
  IDENT_RE,
  type FillPromptState,
  type NamePromptItem,
  type RecordingLanguage,
} from "./recording-canvas/types";
import { normalizeNounForLanguage } from "./recording-canvas/noun-helpers";

void useGetRecordingStatus;

/**
 * Top-level recording surface. Owns the dialog state (fill prompt, name
 * prompt) and stitches together:
 *   - {@link CanvasView}            — live frame, pop-out, keystroke input
 *   - {@link FillPromptDialog}      — combined fill + name dialog
 *   - {@link NamePromptDialog}      — "Name this action" dialog
 *   - {@link useRecordingWebSocket} — WS connection + event-bus bridge
 *
 * The canvas stays mounted across both the recording and the post-stop
 * ("stopped") phase so its WebSocket — which owns the rename / delete /
 * add-assertion message plumbing — survives the hand-off. When
 * `recording` is false we hide the live-frame UI but keep the socket
 * open.
 */
export function RecordingCanvas({
  recording = true,
  capturing = true,
}: {
  recording?: boolean;
  /** False for an open-browser session that is not attached yet. */
  capturing?: boolean;
} = {}) {
  // Read the active project's language so name prompts queued from the
  // recorder route through the right normalizer (snake_case for Python,
  // camelCase for Node, PascalCase noun for C#). Falls back to "csharp"
  // — the original noun-flow language — if the query hasn't resolved
  // yet, which preserves existing behavior for the C#-only beta.
  const recCanvasProject = useGetCurrentProject().data?.project ?? null;
  const recCanvasLanguage: RecordingLanguage =
    (recCanvasProject?.language as RecordingLanguage | undefined) ?? "csharp";
  // Mirror the language into a ref so event handlers attached once on
  // mount always read the freshest value rather than capturing stale
  // closure state.
  const recCanvasLanguageRef = useRef(recCanvasLanguage);
  useEffect(() => {
    recCanvasLanguageRef.current = recCanvasLanguage;
  }, [recCanvasLanguage]);

  const [frame, setFrame] = useState<FrameMsg | null>(null);
  const [liveUrl, setLiveUrl] = useState<string>("");
  const [fillPrompt, setFillPrompt] = useState<FillPromptState | null>(null);
  const [fillValue, setFillValue] = useState<string>("");
  // Combined fill+name dialog: the user enters both the value to type
  // AND the action/method name in one pass instead of submitting fill
  // and then waiting for a second "Name this action" popup.
  const [fillNameValue, setFillNameValue] = useState<string>("");
  const [namePrompt, setNamePrompt] = useState<NamePromptItem | null>(null);
  const [nameValue, setNameValue] = useState<string>("");

  const { wsRef } = useRecordingWebSocket({
    recCanvasLanguageRef,
    setFrame,
    setLiveUrl,
    setFillPrompt,
    setFillValue,
    setFillNameValue,
    setNamePrompt,
    setNameValue,
  });

  const submitFill = () => {
    if (!fillPrompt || !wsRef.current) return;
    // Value-only mode (pre-attach browsing): type into the page and
    // record nothing, so there is no name to validate or send.
    if (fillPrompt.nameless) {
      wsRef.current.send(
        JSON.stringify({
          type: "typeOnly",
          value: fillValue,
          selector: fillPrompt.selector,
        }),
      );
      setFillPrompt(null);
      return;
    }
    if (computeFillNameError(fillNameValue, recCanvasLanguage)) return;
    const trimmedName = fillNameValue.trim();
    const payload: Record<string, unknown> = {
      type: "fill",
      value: fillValue,
      selector: fillPrompt.selector,
    };
    if (trimmedName) payload.methodName = trimmedName;
    wsRef.current.send(JSON.stringify(payload));
    setFillPrompt(null);
  };

  const submitName = (chosen: string) => {
    if (!namePrompt || !wsRef.current) return;
    const trimmed = chosen.trim();
    const promptLanguage = namePrompt.language ?? recCanvasLanguage;
    const isNounPrompt =
      !!namePrompt.decoratedSuggestion &&
      (promptLanguage === "csharp" ||
        promptLanguage === "python" ||
        promptLanguage === "nodejs");
    // For noun-flow prompts (C# / Python / Node.js) the server expects
    // the bare noun (it will decorate it as `${Verb}${Noun}Async` /
    // `${verb}_${noun}` / `${verb}${Noun}` itself) — strip any verb
    // prefix the user typed before sending. Java keeps the legacy
    // raw-identifier flow. Reject whatever fails the identifier check
    // post-normalization so the prompt stays open and the user sees
    // the inline `nameError`.
    const toSend = isNounPrompt
      ? normalizeNounForLanguage(trimmed, promptLanguage)
      : trimmed;
    if (!IDENT_RE.test(toSend)) return;
    // Don't close the prompt yet — wait for the server's `actionNamed`
    // confirmation. If the server rejects (e.g. duplicate name), the prompt
    // stays open and `nameActionError` pre-fills a suggested alternative.
    wsRef.current.send(
      JSON.stringify({
        type: "name-action",
        index: namePrompt.index,
        methodName: toSend,
      }),
    );
  };

  const skipName = () => {
    // Skipping keeps the suggested name. Send it back so the server
    // persists it; wait for the `actionNamed` ack before closing the prompt
    // (same path as submit) so a server-side rejection — e.g. the suggested
    // name collides with something added on disk between recordings — is
    // surfaced rather than silently desyncing the queue.
    if (namePrompt && wsRef.current) {
      wsRef.current.send(
        JSON.stringify({
          type: "name-action",
          index: namePrompt.index,
          methodName: namePrompt.suggested,
        }),
      );
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <CanvasView
        recording={recording}
        capturing={capturing}
        frame={frame}
        liveUrl={liveUrl}
        wsRef={wsRef}
      />

      <FillPromptDialog
        prompt={fillPrompt}
        value={fillValue}
        onValueChange={setFillValue}
        nameValue={fillNameValue}
        onNameValueChange={setFillNameValue}
        language={recCanvasLanguage}
        onCancel={() => setFillPrompt(null)}
        onSubmit={submitFill}
      />

      <NamePromptDialog
        prompt={namePrompt}
        nameValue={nameValue}
        onNameValueChange={setNameValue}
        fallbackLanguage={recCanvasLanguage}
        onSkip={skipName}
        onSubmit={submitName}
      />
    </div>
  );
}
