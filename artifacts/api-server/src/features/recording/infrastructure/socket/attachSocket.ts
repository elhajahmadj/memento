import type { WebSocket } from "ws";
import {
  defaultAssertionLabel,
  defaultWaitLabel,
  normalizeSelectorForLocator,
  type RecordedAction,
  suggestNonCollidingName,
  type WaitKind,
} from "@/features/codegen/infrastructure/codegen";
import {
  methodNameFromNoun,
  normalizeNoun,
  readSuiteActionsMethodNames,
  suggestedMethodNameForLastAction,
  usesNounPromptFlow,
} from "@/features/codegen/infrastructure/codegenAdapter";
import type { Project } from "@/features/projects/infrastructure/projectService";
import { getSharedStep } from "@/features/shared-steps/infrastructure/sharedStepsService";
import {
  applyEditToAction,
  buildAssertionFromMessage,
  findVisibleNeighbor,
} from "@/features/recording/domain/actionEdits";
import { resolveSuiteName } from "@/features/recording/domain/naming";
import { computeNamingExtras } from "@/features/recording/infrastructure/namingExtras";
import {
  auditRecordedActionEdit,
  broadcast,
  broadcastBodyPreview,
  broadcastFeedReset,
  buildFeedResetPayload,
  getSession,
  shiftRenameMapAfterInsert,
} from "@/features/recording/infrastructure/sessionState";

/**
 * Attach a WebSocket to the active recording session. The handler is
 * the same monolithic dispatch the pre-split `recordingService.ts`
 * shipped — semantics are preserved verbatim; mutations to `session`
 * still flow through the module-level holder in `sessionState.ts`
 * (this file only reads it through `getSession()`).
 *
 * `userId` is the authenticated caller resolved during the WebSocket
 * upgrade. It is **required** (audit finding C-2): the recording session
 * is a process-wide singleton, so a socket that cannot prove it belongs
 * to the session owner must never be attached. Making the parameter
 * mandatory is deliberate — an optional one would silently fail open at
 * any call site that forgot to pass it.
 *
 * The upgrade handler checks ownership before calling us; we re-check
 * here on attach and again on every inbound message, so a session that
 * is torn down and restarted by a different user mid-connection cannot
 * leave a stale socket authorized.
 */
export function attachSocket(ws: WebSocket, userId: string): void {
  const initial = getSession();
  if (!initial) {
    ws.send(JSON.stringify({ type: "error", message: "No active recording" }));
    ws.close();
    return;
  }
  if (initial.userId !== userId) {
    ws.send(JSON.stringify({ type: "error", message: "Not your recording session" }));
    ws.close();
    return;
  }
  initial.sockets.add(ws);
  broadcastBodyPreview().catch(() => {});
  if (initial.actions.some((a) => !a.deleted)) {
    const payload = buildFeedResetPayload(initial, undefined);
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  }

  ws.on("message", async (raw: Buffer | string) => {
    const session = getSession();
    if (!session) return;
    // Re-assert ownership per message: the singleton session can be
    // discarded and replaced (including by an admin force-discard)
    // while this socket is still open.
    if (session.userId !== userId) {
      ws.close();
      return;
    }
    const recording = session.phase === "recording" && session.active;
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "click" && typeof msg.x === "number") {
        if (!recording) return;
        await session.page.mouse.click(msg.x, msg.y);
      } else if (msg.type === "key" && typeof msg.key === "string") {
        if (!recording) return;
        await session.page.keyboard.press(msg.key);
      } else if (msg.type === "type" && typeof msg.text === "string") {
        if (!recording) return;
        await session.page.keyboard.type(msg.text);
      } else if (msg.type === "navigate" && typeof msg.url === "string") {
        if (!recording) return;
        await session.page.goto(msg.url);
      } else if (msg.type === "pick-element") {
        if (!recording) {
          ws.send(
            JSON.stringify({
              type: "pickElementError",
              message: "Pick from screenshot requires the browser to still be recording.",
            }),
          );
          return;
        }
        const x = typeof msg.x === "number" ? msg.x : NaN;
        const y = typeof msg.y === "number" ? msg.y : NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          ws.send(JSON.stringify({ type: "pickElementError", message: "Pick coordinates must be numbers." }));
          return;
        }
        try {
          const result = (await session.page.evaluate(
            ([px, py]: [number, number]) => {
              const w = globalThis as unknown as {
                __recorderPickElement?: (
                  x: number,
                  y: number,
                ) => { selector: string; strategy: string; text: string } | null;
              };
              return w.__recorderPickElement ? w.__recorderPickElement(px, py) : null;
            },
            [Math.round(x), Math.round(y)] as [number, number],
          )) as { selector: string; strategy: string; text: string } | null;
          if (!result || !result.selector) {
            ws.send(JSON.stringify({ type: "pickElementError", message: "No element found at that point." }));
            return;
          }
          ws.send(
            JSON.stringify({
              type: "pickElementResult",
              selector: result.selector,
              strategy: result.strategy,
              text: result.text,
            }),
          );
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "pickElementError",
              message: err instanceof Error ? err.message : "Failed to pick element",
            }),
          );
        }
      } else if (msg.type === "add-assertion") {
        const built = buildAssertionFromMessage(msg);
        if (!built.ok) {
          ws.send(JSON.stringify({ type: "addAssertionError", message: built.message }));
          return;
        }
        const { assertion, kind } = built;
        const insertBefore =
          typeof msg.insertBeforeIndex === "number" &&
          msg.insertBeforeIndex >= 0 &&
          msg.insertBeforeIndex < session.actions.length
            ? msg.insertBeforeIndex
            : null;
        session.assertionLabelIndex += 1;
        const suggestedMethodName = `${defaultAssertionLabel(kind)}${session.assertionLabelIndex}`;
        if (insertBefore === null) {
          session.actions.push(assertion);
          const idx = session.actions.length - 1;
          broadcast({ type: "action", action: assertion, index: idx, suggestedMethodName });
          await auditRecordedActionEdit(session, "add-assertion", {
            assertKind: kind,
            index: idx,
            actionType: "assert",
          });
        } else {
          session.actions.splice(insertBefore, 0, assertion);
          shiftRenameMapAfterInsert(session, insertBefore, 1);
          broadcastFeedReset(session, suggestedMethodName);
          await auditRecordedActionEdit(session, "insert-assertion", {
            assertKind: kind,
            insertedAt: insertBefore,
            actionType: "assert",
          });
        }
        broadcastBodyPreview().catch(() => {});
      } else if (msg.type === "move-action") {
        const idx = typeof msg.index === "number" ? msg.index : -1;
        const dir = msg.direction === "up" || msg.direction === "down" ? msg.direction : null;
        if (idx < 0 || idx >= session.actions.length || dir === null || session.actions[idx]!.deleted) {
          ws.send(
            JSON.stringify({
              type: "moveActionError",
              index: idx,
              message: `cannot move action ${idx} ${msg.direction ?? ""}`,
            }),
          );
          return;
        }
        const visibleSwap = findVisibleNeighbor(session.actions, idx, dir);
        if (visibleSwap === null) {
          ws.send(JSON.stringify({ type: "moveActionError", index: idx, message: `no neighbour to swap with` }));
          return;
        }
        const tmp = session.actions[idx]!;
        session.actions[idx] = session.actions[visibleSwap]!;
        session.actions[visibleSwap] = tmp;
        session.lastRenameByIndex.delete(idx);
        session.lastRenameByIndex.delete(visibleSwap);
        broadcastFeedReset(session);
        broadcastBodyPreview().catch(() => {});
        await auditRecordedActionEdit(session, "move-action", {
          from: idx,
          to: visibleSwap,
          direction: dir,
          actionType: session.actions[visibleSwap]?.type ?? null,
        });
      } else if (msg.type === "duplicate-action") {
        const idx = typeof msg.index === "number" ? msg.index : -1;
        if (idx < 0 || idx >= session.actions.length || session.actions[idx]!.deleted) {
          ws.send(JSON.stringify({ type: "duplicateActionError", index: idx, message: `cannot duplicate action ${idx}` }));
          return;
        }
        const original = session.actions[idx]!;
        const copy: RecordedAction = JSON.parse(JSON.stringify(original)) as RecordedAction;
        delete copy.methodName;
        session.actions.splice(idx + 1, 0, copy);
        shiftRenameMapAfterInsert(session, idx + 1, 1);
        broadcastFeedReset(session);
        broadcastBodyPreview().catch(() => {});
        await auditRecordedActionEdit(session, "duplicate-action", {
          source: idx,
          inserted: idx + 1,
          actionType: original.type,
        });
      } else if (msg.type === "edit-action-value") {
        const idx = typeof msg.index === "number" ? msg.index : -1;
        if (idx < 0 || idx >= session.actions.length || session.actions[idx]!.deleted) {
          ws.send(JSON.stringify({ type: "editActionError", index: idx, message: `cannot edit action ${idx}` }));
          return;
        }
        const target = session.actions[idx]!;
        const result = applyEditToAction(target, msg);
        if (!result.ok) {
          ws.send(JSON.stringify({ type: "editActionError", index: idx, message: result.message }));
          return;
        }
        broadcastFeedReset(session);
        broadcastBodyPreview().catch(() => {});
        await auditRecordedActionEdit(session, "edit-action-value", {
          index: idx,
          field: result.field,
          previousValue: result.previousValue,
          actionType: target.type,
        });
      } else if (msg.type === "add-route-mock") {
        const pattern = typeof msg.urlPattern === "string" ? msg.urlPattern.trim() : "";
        if (!pattern) {
          ws.send(JSON.stringify({ type: "addRouteMockError", message: "urlPattern is required for routeMock actions" }));
          return;
        }
        const method =
          typeof msg.method === "string" && ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(msg.method)
            ? (msg.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
            : "GET";
        const status =
          typeof msg.status === "number" && msg.status >= 100 && msg.status < 600 ? msg.status : 200;
        const body = typeof msg.body === "string" ? msg.body : JSON.stringify(msg.body ?? {});
        const action: RecordedAction = {
          type: "routeMock",
          apiUrl: pattern,
          apiMethod: method,
          mockStatus: status,
          mockBody: body,
        };
        session.assertionLabelIndex += 1;
        const suggestedMethodName = `RouteMock${session.assertionLabelIndex}`;
        session.actions.push(action);
        const idx = session.actions.length - 1;
        broadcast({ type: "action", action, index: idx, suggestedMethodName });
        broadcastBodyPreview().catch(() => {});
      } else if (msg.type === "add-wait") {
        const kindRaw = msg.waitKind;
        if (kindRaw !== "selector" && kindRaw !== "networkidle" && kindRaw !== "timeout") {
          ws.send(
            JSON.stringify({
              type: "addWaitError",
              message: "waitKind must be 'selector', 'networkidle', or 'timeout'",
            }),
          );
          return;
        }
        const kind = kindRaw as WaitKind;
        let waitAction: RecordedAction;
        if (kind === "selector") {
          const sel = typeof msg.waitSelector === "string" ? msg.waitSelector.trim() : "";
          if (!sel) {
            ws.send(JSON.stringify({ type: "addWaitError", message: "waitSelector is required for selector waits" }));
            return;
          }
          waitAction = { type: "wait", waitKind: "selector", waitSelector: sel };
        } else if (kind === "timeout") {
          const ms = typeof msg.waitMs === "number" && msg.waitMs > 0 ? Math.floor(msg.waitMs) : 0;
          if (!ms) {
            ws.send(
              JSON.stringify({
                type: "addWaitError",
                message: "waitMs (positive number) is required for timeout waits",
              }),
            );
            return;
          }
          const WAIT_TIMEOUT_MAX_MS = 30_000;
          if (ms > WAIT_TIMEOUT_MAX_MS) {
            ws.send(
              JSON.stringify({
                type: "addWaitError",
                message: `waitMs is capped at ${WAIT_TIMEOUT_MAX_MS}; use a selector or networkidle wait for longer waits`,
              }),
            );
            return;
          }
          waitAction = { type: "wait", waitKind: "timeout", waitMs: ms };
        } else {
          waitAction = { type: "wait", waitKind: "networkidle" };
        }
        session.waitLabelIndex += 1;
        const suggestedMethodName = `${defaultWaitLabel(kind)}${session.waitLabelIndex}`;
        session.actions.push(waitAction);
        const idx = session.actions.length - 1;
        broadcast({ type: "action", action: waitAction, index: idx, suggestedMethodName });
        broadcastBodyPreview().catch(() => {});
      } else if (msg.type === "add-api-assertion") {
        const url = typeof msg.apiUrl === "string" ? msg.apiUrl.trim() : "";
        if (!url) {
          ws.send(JSON.stringify({ type: "addApiAssertionError", message: "apiUrl is required for apiAssertion actions" }));
          return;
        }
        const method =
          typeof msg.apiMethod === "string" && ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(msg.apiMethod)
            ? (msg.apiMethod as "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
            : "GET";
        const status =
          typeof msg.apiExpectedStatus === "number" &&
          msg.apiExpectedStatus >= 100 &&
          msg.apiExpectedStatus < 600
            ? msg.apiExpectedStatus
            : 200;
        const body = typeof msg.apiRequestBody === "string" ? msg.apiRequestBody : undefined;
        const expectedJson =
          typeof msg.apiExpectedJson === "string" && msg.apiExpectedJson.trim().length > 0
            ? msg.apiExpectedJson
            : undefined;
        const action: RecordedAction = {
          type: "apiAssertion",
          apiUrl: url,
          apiMethod: method,
          apiExpectedStatus: status,
          apiRequestBody: body,
          apiExpectedJson: expectedJson,
        };
        session.assertionLabelIndex += 1;
        const suggestedMethodName = `AssertApiStatus${session.assertionLabelIndex}`;
        session.actions.push(action);
        const idx = session.actions.length - 1;
        broadcast({ type: "action", action, index: idx, suggestedMethodName });
        broadcastBodyPreview().catch(() => {});
      } else if (msg.type === "insert-shared-step") {
        const name = typeof msg.name === "string" ? msg.name.trim() : "";
        if (!name) {
          ws.send(JSON.stringify({ type: "insertSharedStepError", message: "name is required" }));
          return;
        }
        const dto = await getSharedStep({
          userId: session.userId,
          projectName: session.project.solutionName,
          name,
        }).catch(() => null);
        if (!dto) {
          ws.send(JSON.stringify({ type: "insertSharedStepError", message: `shared step "${name}" not found` }));
          return;
        }
        const cloned: RecordedAction[] = dto.actions
          .filter((a) => !a.deleted)
          .map((a) => ({ ...a, deleted: false, macroName: name }));
        const rawAtIndex = typeof msg.atIndex === "number" ? msg.atIndex : null;
        const insertAt =
          rawAtIndex !== null &&
          Number.isInteger(rawAtIndex) &&
          rawAtIndex >= 0 &&
          rawAtIndex <= session.actions.length
            ? rawAtIndex
            : session.actions.length;
        const appending = insertAt === session.actions.length;
        session.actions.splice(insertAt, 0, ...cloned);
        const insertedIndices: number[] = [];
        for (let k = 0; k < cloned.length; k++) insertedIndices.push(insertAt + k);
        if (appending) {
          for (let k = 0; k < cloned.length; k++) {
            broadcast({ type: "action", action: cloned[k]!, index: insertAt + k });
          }
        } else {
          broadcast({
            type: "actions-resync",
            actions: session.actions.map((a, i) => ({ ...a, index: i })),
          });
        }
        ws.send(
          JSON.stringify({
            type: "insertSharedStepResult",
            name,
            insertedCount: insertedIndices.length,
            indices: insertedIndices,
            atIndex: insertAt,
          }),
        );
        broadcastBodyPreview().catch(() => {});
      } else if (msg.type === "delete-action") {
        const idx = typeof msg.index === "number" ? msg.index : -1;
        if (idx < 0 || idx >= session.actions.length) {
          ws.send(JSON.stringify({ type: "deleteActionError", index: idx, message: `index ${idx} out of range` }));
          return;
        }
        const target = session.actions[idx]!;
        if (target.deleted) {
          broadcast({ type: "actionDeleted", index: idx });
          return;
        }
        target.deleted = true;
        session.lastRenameByIndex.delete(idx);
        if (
          target.type === "click" &&
          target.editable &&
          target.selector &&
          session.lastEditableSelector === target.selector
        ) {
          session.lastEditableSelector = null;
          session.lastEditableStrategy = null;
        }
        broadcast({ type: "actionDeleted", index: idx });
        broadcastBodyPreview().catch(() => {});
        await auditRecordedActionEdit(session, "delete-action", { index: idx, actionType: target.type });
      } else if (msg.type === "undelete-action") {
        const idx = typeof msg.index === "number" ? msg.index : -1;
        if (idx < 0 || idx >= session.actions.length) {
          ws.send(JSON.stringify({ type: "undeleteActionError", index: idx, message: `index ${idx} out of range` }));
          return;
        }
        const sess = session;
        const target = sess.actions[idx]!;
        const namingExtras = (): ReturnType<typeof computeNamingExtras> => {
          const live = sess.actions.slice(0, idx + 1).filter((a) => !a.deleted);
          return computeNamingExtras(live, !!target.selector && target.type !== "navigate", sess.project);
        };
        if (!target.deleted) {
          broadcast({ type: "actionUndeleted", index: idx, action: target, ...namingExtras() });
          return;
        }
        target.deleted = false;
        broadcast({ type: "actionUndeleted", index: idx, action: target, ...namingExtras() });
        broadcastBodyPreview().catch(() => {});
        await auditRecordedActionEdit(session, "undelete-action", { index: idx, actionType: target.type });
      } else if (msg.type === "undelete-actions") {
        const raw = Array.isArray(msg.indices) ? msg.indices : [];
        const indices: number[] = [];
        for (const v of raw) {
          if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < session.actions.length) {
            indices.push(v);
          }
        }
        const seen = new Set<number>();
        const unique = indices.filter((i) => {
          if (seen.has(i)) return false;
          seen.add(i);
          return true;
        });
        if (raw.length > 0 && unique.length === 0) {
          ws.send(JSON.stringify({ type: "undeleteActionError", index: -1, message: "no valid indices to undelete" }));
        }
        const ascending = unique.slice().sort((a, b) => a - b);
        const liveSession = session;
        for (const idx of ascending) {
          const target = liveSession.actions[idx]!;
          if (target.deleted) target.deleted = false;
          const live = liveSession.actions.slice(0, idx + 1).filter((a) => !a.deleted);
          broadcast({
            type: "actionUndeleted",
            index: idx,
            action: target,
            ...computeNamingExtras(live, !!target.selector && target.type !== "navigate", liveSession.project),
          });
        }
        if (ascending.length > 0) {
          broadcastBodyPreview().catch(() => {});
          await auditRecordedActionEdit(session, "undelete-actions", { indices: ascending });
        }
      } else if (msg.type === "delete-actions") {
        const raw = Array.isArray(msg.indices) ? msg.indices : [];
        const indices: number[] = [];
        for (const v of raw) {
          if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < session.actions.length) {
            indices.push(v);
          }
        }
        const seen = new Set<number>();
        const unique = indices.filter((i) => {
          if (seen.has(i)) return false;
          seen.add(i);
          return true;
        });
        if (raw.length > 0 && unique.length === 0) {
          ws.send(JSON.stringify({ type: "deleteActionError", index: -1, message: "no valid indices to delete" }));
        }
        const actuallyDeleted: number[] = [];
        for (const idx of unique) {
          const target = session.actions[idx]!;
          if (!target.deleted) {
            target.deleted = true;
            actuallyDeleted.push(idx);
            session.lastRenameByIndex.delete(idx);
            if (
              target.type === "click" &&
              target.editable &&
              target.selector &&
              session.lastEditableSelector === target.selector
            ) {
              session.lastEditableSelector = null;
              session.lastEditableStrategy = null;
            }
          }
          broadcast({ type: "actionDeleted", index: idx });
        }
        if (unique.length > 0) broadcastBodyPreview().catch(() => {});
        if (actuallyDeleted.length > 0) {
          await auditRecordedActionEdit(session, "delete-actions", { indices: actuallyDeleted });
        }
      } else if (msg.type === "name-action") {
        const idx = typeof msg.index === "number" ? msg.index : -1;
        const rawInput = typeof msg.methodName === "string" ? msg.methodName.trim() : "";
        if (idx < 0 || idx >= session.actions.length) {
          ws.send(JSON.stringify({ type: "nameActionError", index: idx, message: `index ${idx} out of range` }));
          return;
        }
        if (session.actions[idx]!.deleted) {
          ws.send(JSON.stringify({ type: "nameActionError", index: idx, message: `action ${idx} was deleted` }));
          return;
        }
        const project = session.project;
        const dispatchProject = project ?? ({ language: "csharp" } as unknown as Project);
        const useNounFlow = usesNounPromptFlow(dispatchProject);
        const target = session.actions[idx]!;
        const stored = useNounFlow ? normalizeNoun(dispatchProject, rawInput) : rawInput;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(stored)) {
          ws.send(
            JSON.stringify({
              type: "nameActionError",
              index: idx,
              message: useNounFlow
                ? "name must contain at least one letter / digit / underscore once the verb prefix (and trailing Async for C#) is stripped"
                : "methodName must start with a letter/underscore and contain only letters, digits, or underscores",
            }),
          );
          return;
        }
        const decoratedCandidate = useNounFlow
          ? methodNameFromNoun(dispatchProject, target.type, stored)
          : stored;
        const used = new Set<string>();
        for (let i = 0; i < session.actions.length; i++) {
          if (i === idx) continue;
          const other = session.actions[i]!;
          if (other.deleted) continue;
          if (other.methodName) {
            if (useNounFlow && other.selector) {
              const otherNoun = normalizeNoun(dispatchProject, other.methodName);
              if (otherNoun) {
                used.add(methodNameFromNoun(dispatchProject, other.type, otherNoun));
              }
            } else {
              used.add(other.methodName);
            }
          } else if (other.selector) {
            const live = session.actions.slice(0, i + 1).filter((a) => !a.deleted);
            const auto = suggestedMethodNameForLastAction(dispatchProject, live);
            if (auto) used.add(auto);
          }
        }
        if (project) {
          const suiteName = resolveSuiteName(session.config, project);
          try {
            const onDisk = await readSuiteActionsMethodNames(project, suiteName);
            for (const n of onDisk) used.add(n);
          } catch {
            // ignore
          }
        }
        if (used.has(decoratedCandidate)) {
          let suggested: string;
          if (useNounFlow) {
            let suffix = 2;
            while (used.has(methodNameFromNoun(dispatchProject, target.type, `${stored}${suffix}`))) {
              suffix++;
            }
            suggested = `${stored}${suffix}`;
          } else {
            suggested = suggestNonCollidingName(decoratedCandidate, used);
          }
          ws.send(
            JSON.stringify({
              type: "nameActionError",
              index: idx,
              message: `A method named ${decoratedCandidate} already exists in this suite`,
              suggestedName: suggested,
            }),
          );
          return;
        }
        const previousMethodName = typeof target.methodName === "string" ? target.methodName : null;
        target.methodName = stored;
        if (previousMethodName !== null && previousMethodName !== stored) {
          session.lastRenameByIndex.set(idx, previousMethodName);
          await auditRecordedActionEdit(session, "rename-action", {
            index: idx,
            previousMethodName,
            methodName: stored,
          });
        }
        broadcast({
          type: "actionNamed",
          index: idx,
          methodName: stored,
          decoratedMethodName: useNounFlow ? decoratedCandidate : null,
          previousMethodName,
        });
        broadcastBodyPreview().catch(() => {});
      } else if (msg.type === "undo-name-action") {
        const idx = typeof msg.index === "number" ? msg.index : -1;
        if (idx < 0 || idx >= session.actions.length) {
          ws.send(JSON.stringify({ type: "undoNameActionError", index: idx, message: `index ${idx} out of range` }));
          return;
        }
        if (session.actions[idx]!.deleted) {
          session.lastRenameByIndex.delete(idx);
          ws.send(JSON.stringify({ type: "undoNameActionError", index: idx, message: `action ${idx} was deleted` }));
          return;
        }
        if (!session.lastRenameByIndex.has(idx)) {
          ws.send(JSON.stringify({ type: "undoNameActionError", index: idx, message: `no rename to undo for action ${idx}` }));
          return;
        }
        const prev = session.lastRenameByIndex.get(idx)!;
        session.lastRenameByIndex.delete(idx);
        const undoTarget = session.actions[idx]!;
        if (prev === null) {
          delete undoTarget.methodName;
        } else {
          undoTarget.methodName = prev;
        }
        const undoDispatchProject = session.project ?? ({ language: "csharp" } as unknown as Project);
        let undoDecorated: string | null = null;
        if (usesNounPromptFlow(undoDispatchProject) && undoTarget.selector) {
          if (typeof undoTarget.methodName === "string") {
            const noun = normalizeNoun(undoDispatchProject, undoTarget.methodName);
            if (noun) {
              undoDecorated = methodNameFromNoun(undoDispatchProject, undoTarget.type, noun);
            }
          }
          if (!undoDecorated) {
            const live = session.actions.slice(0, idx + 1).filter((a) => !a.deleted);
            undoDecorated = suggestedMethodNameForLastAction(undoDispatchProject, live);
          }
        }
        broadcast({
          type: "actionNameUndone",
          index: idx,
          methodName: prev,
          decoratedMethodName: undoDecorated,
        });
        broadcastBodyPreview().catch(() => {});
      } else if (msg.type === "typeOnly" && typeof msg.value === "string") {
        // Types into the live page and records NOTHING. Used while
        // browsing an open-browser session before it is attached: the
        // user is getting the page into the state they want to record
        // from, so a `fill` action here would pollute the eventual test
        // (and leak credentials into generated code, since this is
        // exactly how people log in).
        if (!recording) return;
        const sel =
          (typeof msg.selector === "string" && msg.selector) ||
          session.lastEditableSelector;
        if (!sel) return;
        // Suppress the DOM change event the fill is about to trigger,
        // so the recorder's own listener doesn't turn it into an action
        // if the session gets attached moments later.
        session.suppressNextChangeFill = { selector: sel, value: msg.value };
        try {
          await session.page
            .locator(
              normalizeSelectorForLocator(
                sel,
                session.lastEditableStrategy ?? undefined,
              ),
            )
            .first()
            .fill(msg.value);
        } catch {
          // Element vanished or is not fillable — nothing recorded, so
          // there is no state to roll back. The user can retry.
        }
      } else if (msg.type === "fill" && typeof msg.value === "string") {
        if (!recording) return;
        const sel =
          (typeof msg.selector === "string" && msg.selector) || session.lastEditableSelector;
        const rawMethodName = typeof msg.methodName === "string" ? msg.methodName.trim() : "";
        if (sel) {
          session.suppressNextChangeFill = { selector: sel, value: msg.value };
          try {
            await session.page
              .locator(normalizeSelectorForLocator(sel, session.lastEditableStrategy ?? undefined))
              .first()
              .fill(msg.value);
            const synthetic: RecordedAction = {
              type: "fill",
              selector: sel,
              selectorStrategy: session.lastEditableStrategy ?? undefined,
              value: msg.value,
              url: session.page.url(),
            };
            session.actions.push(synthetic);
            const sIdx = session.actions.length - 1;
            let appliedMethodName: string | null = null;
            let appliedDecorated: string | null = null;
            if (rawMethodName) {
              const dispatchProject =
                session.project ?? ({ language: "csharp" } as unknown as Project);
              const useNounFlow = usesNounPromptFlow(dispatchProject);
              const stored = useNounFlow ? normalizeNoun(dispatchProject, rawMethodName) : rawMethodName;
              if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(stored)) {
                const decoratedCandidate = useNounFlow
                  ? methodNameFromNoun(dispatchProject, "fill", stored)
                  : stored;
                const used = new Set<string>();
                for (let i = 0; i < session.actions.length; i++) {
                  if (i === sIdx) continue;
                  const other = session.actions[i]!;
                  if (other.deleted) continue;
                  if (other.methodName) {
                    if (useNounFlow && other.selector) {
                      const otherNoun = normalizeNoun(dispatchProject, other.methodName);
                      if (otherNoun) {
                        used.add(methodNameFromNoun(dispatchProject, other.type, otherNoun));
                      }
                    } else {
                      used.add(other.methodName);
                    }
                  }
                }
                if (session.project) {
                  const suiteName = resolveSuiteName(session.config, session.project);
                  try {
                    const onDisk = await readSuiteActionsMethodNames(session.project, suiteName);
                    for (const n of onDisk) used.add(n);
                  } catch {
                    // ignore
                  }
                }
                if (!used.has(decoratedCandidate)) {
                  synthetic.methodName = stored;
                  appliedMethodName = stored;
                  appliedDecorated = useNounFlow ? decoratedCandidate : null;
                }
              }
            }
            const sLive = session.actions.filter((a) => !a.deleted);
            broadcast({
              type: "action",
              action: synthetic,
              index: sIdx,
              ...computeNamingExtras(sLive, !!synthetic.selector, session.project),
              ...(appliedMethodName !== null
                ? { methodName: appliedMethodName, decoratedMethodName: appliedDecorated }
                : {}),
            });
            broadcastBodyPreview().catch(() => {});
          } catch (err) {
            session.suppressNextChangeFill = null;
            broadcast({
              type: "fillError",
              selector: sel,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch {
      // ignore malformed
    }
  });

  ws.on("close", () => {
    getSession()?.sockets.delete(ws);
  });

  // M-6: a `ws` socket that emits "error" with no listener is an
  // EventEmitter error with no handler, which throws and takes the
  // process down — and this process holds the singleton recording
  // session in memory, so one abrupt disconnect would drop everyone's
  // in-progress work. Same cleanup as "close".
  ws.on("error", () => {
    getSession()?.sockets.delete(ws);
  });
}
