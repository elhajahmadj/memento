/**
 * JMX live-canvas screencast.
 *
 * The JMX recorder runs a headless Chromium and previously had no UI:
 * the page navigated once via `page.goto(startUrl)` and waited there
 * with no way for the user to drive it. This module bolts the same
 * "screenshot every N ms + WebSocket input forwarding" pipeline the
 * DOM recorder uses (`features/recording/infrastructure/sessionStart`
 * + `socket/attachSocket`) onto the JMX session's `page`, but without
 * any of the DOM-recorder action/queue plumbing.
 *
 * Scope deliberately minimal — JMX only needs:
 *   - PNG frames broadcast over a WS so the user can see the page
 *   - click / type / key / scroll / navigate messages in
 *
 * Action capture, name prompts, fill prompts, the rename feed —
 * none of that applies to JMX, so this file does not attempt to share
 * code with `attachSocket.ts` (which is monolithic and tightly coupled
 * to `session.actions`).
 */
import type { Page } from "playwright";
import type { WebSocket } from "ws";
import { logger } from "@/shared/logger";
// Frame encoding is shared with the DOM recorder's screencast so both
// canvases decode the same format — they render through the same
// `CanvasView`, which builds one `data:` URL for either source.
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { startScreencast } from "@/features/recording/infrastructure/screencastLoop";

const SCREENCAST_INTERVAL_MS = 500;

interface ScreencastSession {
  sessionId: string;
  userId: string;
  page: Page;
  viewport: { width: number; height: number };
  sockets: Set<WebSocket>;
  /**
   * Stop function returned by {@link startScreencast}. Replaces the
   * previous `setInterval` handle — see the audit note on
   * `registerJmxScreencast`.
   */
  stopFrames: (() => void) | null;
  /** Set false at unregister so a late frame callback is a no-op. */
  active: boolean;
}

const sessions = new Map<string, ScreencastSession>();
const userToSession = new Map<string, string>();

export function registerJmxScreencast(args: {
  sessionId: string;
  userId: string;
  page: Page;
  viewport: { width: number; height: number };
}): void {
  const sess: ScreencastSession = {
    sessionId: args.sessionId,
    userId: args.userId,
    page: args.page,
    viewport: args.viewport,
    sockets: new Set(),
    stopFrames: null,
    active: true,
  };
  sessions.set(args.sessionId, sess);
  userToSession.set(args.userId, args.sessionId);

  // Audit finding M-2. This used to be a bare `setInterval` around
  // `page.screenshot()` with an un-awaited `.then()` — exactly the shape
  // `screencastLoop.ts` was written to replace, and which its header
  // documents as harmful: `setInterval` does not await the callback, so
  // when a frame takes longer than the interval (the normal case during
  // navigation, when screenshots are slowest) the next tick fires
  // anyway and frames stack up. Each pending screenshot holds a
  // full-frame buffer plus its base64 copy, which on a 1 GB machine is a
  // real spike, and the concurrent screenshots contend with the very
  // page the user is driving.
  //
  // `startScreencast` is self-scheduling: the next frame is queued only
  // after the previous one resolves, so load shedding is automatic and
  // the cadence degrades gracefully instead of collapsing.
  sess.stopFrames = startScreencast(
    () => (sess.active && sess.sockets.size > 0 ? sess.page : null),
    (base64) => {
      if (!sess.active) return;
      const payload = JSON.stringify({
        type: "frame",
        data: base64,
        width: sess.viewport.width,
        height: sess.viewport.height,
        url: sess.page.url(),
      });
      for (const ws of sess.sockets) {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      }
    },
    { intervalMs: SCREENCAST_INTERVAL_MS },
  );
}

export function unregisterJmxScreencast(sessionId: string): void {
  const sess = sessions.get(sessionId);
  if (!sess) return;
  sess.active = false;
  sess.stopFrames?.();
  sess.stopFrames = null;
  for (const ws of sess.sockets) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  sessions.delete(sessionId);
  if (userToSession.get(sess.userId) === sessionId) {
    userToSession.delete(sess.userId);
  }
}

export function getJmxScreencastForUser(userId: string): {
  sessionId: string;
} | null {
  const sid = userToSession.get(userId);
  if (!sid) return null;
  return { sessionId: sid };
}

/**
 * Attach a freshly-upgraded WebSocket to a JMX screencast session.
 * Sends one frame on connect (best-effort) so the user sees something
 * immediately instead of waiting for the next interval tick.
 */
export function attachJmxSocket(
  sessionId: string,
  ws: WebSocket,
  callerUserId: string,
): void {
  const sess = sessions.get(sessionId);
  if (!sess) {
    try {
      ws.send(
        JSON.stringify({ type: "error", message: "JMX session not found" }),
      );
    } catch {
      // ignore
    }
    ws.close();
    return;
  }
  // Ownership check: only the user who started the recording may
  // attach to its screencast / send input. Without this, any
  // authenticated user who learns a sessionId could view + drive
  // another user's live browser (IDOR).
  if (sess.userId !== callerUserId) {
    try {
      ws.send(JSON.stringify({ type: "error", message: "Forbidden" }));
    } catch {
      // ignore
    }
    ws.close();
    return;
  }
  sess.sockets.add(ws);

  // Best-effort initial frame.
  void sess.page
    .screenshot({ type: recorderConfig.screencastFormat, quality: recorderConfig.screencastQuality })
    .then((buf) => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "frame",
          data: buf.toString("base64"),
          width: sess.viewport.width,
          height: sess.viewport.height,
          url: sess.page.url(),
        }),
      );
    })
    .catch(() => {});

  ws.on("message", (raw: Buffer | string) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    void handleInput(sess, msg).catch((err) => {
      logger.warn({ err, sessionId }, "JMX screencast: input handler failed");
    });
  });

  ws.on("close", () => {
    sess.sockets.delete(ws);
  });

  // M-6: without an "error" listener, a `ws` socket emitting "error"
  // is an unhandled EventEmitter error and crashes the process. Same
  // cleanup as "close".
  ws.on("error", (err) => {
    logger.warn({ err, sessionId }, "JMX screencast: socket error");
    sess.sockets.delete(ws);
  });
}

async function handleInput(
  sess: ScreencastSession,
  msg: Record<string, unknown>,
): Promise<void> {
  const type = msg["type"];
  if (type === "click") {
    const x = Number(msg["x"]);
    const y = Number(msg["y"]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    await sess.page.mouse.click(x, y);
  } else if (type === "type") {
    const text = String(msg["text"] ?? "");
    if (!text) return;
    await sess.page.keyboard.type(text);
  } else if (type === "key") {
    const key = String(msg["key"] ?? "");
    if (!key) return;
    await sess.page.keyboard.press(key);
  } else if (type === "scroll") {
    const dy = Number(msg["dy"] ?? 0);
    const dx = Number(msg["dx"] ?? 0);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    await sess.page.mouse.wheel(dx, dy);
  } else if (type === "navigate") {
    const url = String(msg["url"] ?? "").trim();
    if (!url) return;
    await sess.page.goto(url).catch(() => {});
  }
}

/**
 * Broadcast a captured-event row to every WS client attached to a JMX
 * session's screencast. The frontend renders these in a small
 * captured-rows panel next to the live canvas; for BFF projects each
 * row carries a `bffClass` so the UI can render a coloured tag.
 * Best-effort — silently drops if the session has no attached sockets.
 */
export function broadcastJmxCaptured(
  sessionId: string,
  row: {
    method: string;
    url: string;
    statusCode: number;
    bffClass?: "bff" | "idp" | "upstream";
    timestamp: number;
  },
): void {
  const sess = sessions.get(sessionId);
  if (!sess || !sess.active) return;
  const payload = JSON.stringify({ type: "captured", ...row });
  for (const ws of sess.sockets) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(payload);
      } catch {
        // ignore
      }
    }
  }
}

/** Test seam. */
export function _resetJmxScreencastForTests(): void {
  for (const sess of sessions.values()) {
    sess.active = false;
    sess.stopFrames?.();
    sess.stopFrames = null;
  }
  sessions.clear();
  userToSession.clear();
}
