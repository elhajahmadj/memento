import type { Project } from "@/features/projects/infrastructure/projectService";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";
import { computeTestBodyPreview } from "@/features/codegen/infrastructure/codegenAdapter";
import {
  readSuiteExistingSelectors,
} from "@/features/codegen/infrastructure/codegenAdapter";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import { resolveSuiteName } from "@/features/recording/domain/naming";
import { computeNamingExtras } from "@/features/recording/infrastructure/namingExtras";
import type { Session } from "@/features/recording/domain/sessionTypes";

let session: Session | null = null;

export function getSession(): Session | null {
  return session;
}

export function setSession(s: Session | null): void {
  session = s;
}

export function broadcast(msg: unknown): void {
  if (!session) return;
  const data = JSON.stringify(msg);
  for (const sock of session.sockets) {
    if (sock.readyState === sock.OPEN) sock.send(data);
  }
}

/**
 * Build the `feedReset` snapshot a client uses to fully resync its
 * in-memory action feed after a move/insert/edit changes indices.
 */
export function buildFeedResetPayload(
  s: Session,
  pendingSuggestedMethodName: string | undefined,
): { type: "feedReset"; actions: unknown[]; pendingSuggestedMethodName: string | null } {
  const rows: unknown[] = [];
  const liveBefore: RecordedAction[] = [];
  for (let i = 0; i < s.actions.length; i++) {
    const a = s.actions[i]!;
    if (a.deleted) continue;
    liveBefore.push(a);
    // Audit finding M-5. This used to pass `liveBefore.slice()` — an
    // O(n) array copy inside an O(n) loop, so a long recording allocated
    // hundreds of throwaway arrays on every edit and on every socket
    // attach, on the same single shared CPU that is also driving
    // Chromium and the screencast.
    //
    // The copy was never needed: `computeNamingExtras` only reads the
    // array (it forwards it to `suggestedMethodNameForLastAction`, which
    // iterates read-only), and everything here is synchronous, so no
    // caller can observe `liveBefore` growing afterwards.
    //
    // Note this removes the quadratic *allocation*, not the quadratic
    // CPU: `suggestedMethodNameForLastAction` is itself O(n) because a
    // suggested name depends on every earlier action's selector, so
    // calling it once per action stays O(n²). Fixing that properly means
    // making the naming logic incremental, which is a larger change than
    // this audit item warrants.
    const extras = computeNamingExtras(
      liveBefore,
      !!a.selector && a.type !== "navigate",
      s.project,
    );
    rows.push({ index: i, action: a, ...extras });
  }
  return {
    type: "feedReset",
    actions: rows,
    pendingSuggestedMethodName: pendingSuggestedMethodName ?? null,
  };
}

export function broadcastFeedReset(
  s: Session,
  pendingSuggestedMethodName?: string,
): void {
  broadcast(buildFeedResetPayload(s, pendingSuggestedMethodName));
}

/**
 * Compute and broadcast the in-progress test-body preview that
 * `generateSuiteFiles` + `stop()` would emit so far.
 */
export async function broadcastBodyPreview(): Promise<void> {
  if (!session) return;
  const project = session.project;
  const suiteName = resolveSuiteName(
    session.config,
    project ?? ({} as Project),
  );
  const dispatchProject =
    project ?? ({ language: "csharp" } as unknown as Project);
  let existingSelectors = new Map<string, string>();
  if (project) {
    try {
      existingSelectors = await readSuiteExistingSelectors(project, suiteName);
    } catch {
      // best-effort
    }
  }
  const { lines, lineActionIndices } = computeTestBodyPreview(
    dispatchProject,
    suiteName,
    session.config.urlName,
    session.actions,
    existingSelectors,
  );
  broadcast({ type: "bodyPreview", lines, lineActionIndices });
}

/**
 * Adjust the rename-undo index map after `count` actions are inserted
 * starting at `at`.
 */
export function shiftRenameMapAfterInsert(
  s: Session,
  at: number,
  count: number,
): void {
  if (count <= 0) return;
  const next = new Map<number, string | null>();
  for (const [k, v] of s.lastRenameByIndex.entries()) {
    if (k >= at) next.set(k + count, v);
    else next.set(k, v);
  }
  s.lastRenameByIndex = next;
}

/**
 * Audit one mutation to the recorded action set. Best-effort.
 */
export async function auditRecordedActionEdit(
  s: Session,
  operation: string,
  details: Record<string, unknown>,
): Promise<void> {
  await recordAudit({
    user: { id: s.userId },
    project: s.project?.solutionName ?? null,
    action: "recorded_action_edit",
    file: s.config.existingTestClassPath ?? null,
    details: { operation, sessionToken: s.sessionToken, ...details },
  });
}

type SessionDiscardedListener = (
  sessionToken: string,
  projectName: string,
) => void | Promise<void>;

const sessionDiscardedListeners: SessionDiscardedListener[] = [];

export function onSessionDiscarded(cb: SessionDiscardedListener): () => void {
  sessionDiscardedListeners.push(cb);
  return () => {
    const idx = sessionDiscardedListeners.indexOf(cb);
    if (idx >= 0) sessionDiscardedListeners.splice(idx, 1);
  };
}

export async function fireSessionDiscarded(
  sessionToken: string,
  projectName: string,
): Promise<void> {
  for (const cb of [...sessionDiscardedListeners]) {
    try {
      await cb(sessionToken, projectName);
    } catch {
      // Listener failures must not block the discard.
    }
  }
}

/**
 * Tear down the module-level `session` (close browser, clear timers,
 * close sockets, fire discard listeners, null out). Returns true if a
 * session was cleared.
 */
export async function tearDownCurrentSession(): Promise<boolean> {
  if (!session) return false;
  const token = session.sessionToken;
  const projectName = session.project.solutionName;
  session.active = false;
  session.stopScreencast?.();
  await session.browser.close().catch(() => {});
  for (const sock of session.sockets) {
    try {
      sock.close();
    } catch {
      // ignore
    }
  }
  session = null;
  await fireSessionDiscarded(token, projectName);
  return true;
}
