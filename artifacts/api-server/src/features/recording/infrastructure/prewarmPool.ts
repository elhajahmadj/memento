import type { Browser } from "playwright";
import { launchRecordingChromium } from "@/features/recording/infrastructure/browserLauncher";

/**
 * Browser pre-warm pool.
 *
 * Launching headless Chromium is the slow step before a recording can
 * start. To hide that latency, the frontend calls `POST /recording/prewarm`
 * the moment a user opens the New Project dialog or clicks Open on an
 * existing project (see `prewarm.routes.ts`), which kicks a launch off
 * speculatively so by the time they reach the workbench the process is
 * already up. `start()` / `openBrowser()` then CONSUME the warm instance
 * instead of launching their own.
 *
 * If the user never records, an idle timer closes the speculative
 * browser so we don't leak a Chromium process per abandoned project
 * open. The pool is keyed by user id, matching the single-session model
 * (one active recording per user at a time).
 */

interface PrewarmEntry {
  browserPromise: Promise<Browser>;
  idleTimer: ReturnType<typeof setTimeout>;
}

// Generous enough to span a user filling out the New Project form (the
// pre-warm fires when the dialog opens) and still reach the workbench
// before the speculative browser is reaped.
const DEFAULT_IDLE_MS = 5 * 60_000;

// Upper bound on concurrent speculative browsers across all users. A
// pre-warm is only ever a latency optimization, so once the pool is full
// we simply skip warming — those callers launch their own browser at
// record time, exactly as before this feature existed. Keeps a burst of
// users opening the New Project dialog from spawning unbounded Chromium
// processes.
const DEFAULT_MAX = 8;

function idleMs(): number {
  const raw = Number(process.env.RECORDER_PREWARM_IDLE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_MS;
}

function maxEntries(): number {
  const raw = Number(process.env.RECORDER_PREWARM_MAX);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX;
}

const pool = new Map<string, PrewarmEntry>();

function armIdleTimer(userId: string): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    void releasePrewarmedBrowser(userId);
  }, idleMs());
  // Never keep the Node process alive just for a speculative browser.
  timer.unref?.();
  return timer;
}

/**
 * Speculatively launch a headless browser for `userId`. Fire-and-forget:
 * returns synchronously and never throws into the caller. A second call
 * while one is already warming just refreshes the idle timer so an
 * active user doesn't lose their warm browser.
 */
export function prewarmBrowser(userId: string): void {
  if (!userId) return;
  const existing = pool.get(userId);
  if (existing) {
    clearTimeout(existing.idleTimer);
    existing.idleTimer = armIdleTimer(userId);
    return;
  }
  // Pool full: skip warming. Recording still works — `start()` /
  // `openBrowser()` fall back to launching their own browser.
  if (pool.size >= maxEntries()) return;
  const browserPromise = launchRecordingChromium();
  const entry: PrewarmEntry = {
    browserPromise,
    idleTimer: armIdleTimer(userId),
  };
  pool.set(userId, entry);
  // Swallow rejections: if nobody ever consumes this and the launch
  // failed, the unhandled rejection must not crash the process. Consumers
  // (`takePrewarmedBrowser`) re-await and handle the error themselves.
  // Guard on entry identity — if this entry was already consumed and a
  // newer one took its place, a late rejection must not evict the healthy
  // replacement. Also clear the dead entry's idle timer.
  browserPromise.catch(() => {
    if (pool.get(userId) === entry) {
      clearTimeout(entry.idleTimer);
      pool.delete(userId);
    }
  });
}

/**
 * Hand the pre-warmed browser for `userId` to a recording session,
 * removing it from the pool. Returns `null` when nothing was warmed, the
 * speculative launch failed, or the browser already disconnected — in
 * every case the caller falls back to launching its own browser.
 */
export async function takePrewarmedBrowser(
  userId: string,
): Promise<Browser | null> {
  const entry = pool.get(userId);
  if (!entry) return null;
  clearTimeout(entry.idleTimer);
  pool.delete(userId);
  try {
    const browser = await entry.browserPromise;
    if (typeof browser.isConnected === "function" && !browser.isConnected()) {
      return null;
    }
    return browser;
  } catch {
    return null;
  }
}

/**
 * Close and drop the pre-warmed browser for `userId`, if any. Idempotent.
 */
export async function releasePrewarmedBrowser(userId: string): Promise<boolean> {
  const entry = pool.get(userId);
  if (!entry) return false;
  clearTimeout(entry.idleTimer);
  pool.delete(userId);
  try {
    const browser = await entry.browserPromise;
    await browser.close().catch(() => {});
  } catch {
    // Launch failed — nothing to close.
  }
  return true;
}

/**
 * Close every pre-warmed browser. Called from the recording `shutdown`
 * path so a server stop doesn't strand speculative Chromium processes.
 */
export async function releaseAllPrewarmedBrowsers(): Promise<void> {
  const userIds = [...pool.keys()];
  await Promise.all(userIds.map((id) => releasePrewarmedBrowser(id)));
}
