import type { Page } from "playwright";
import { recorderConfig } from "@/features/projects/infrastructure/config";

/**
 * Drives the live browser-preview screencast.
 *
 * Replaces the `setInterval(async () => { await page.screenshot(...) })`
 * pattern that every screencast site used. Two problems with that shape:
 *
 *  1. `setInterval` does not await the callback. When a frame takes
 *     longer than the interval — which is the normal case during
 *     navigation, when the page is busy and screenshots are slowest —
 *     the next tick fires anyway and a third and a fourth stack up
 *     behind it. Concurrent `page.screenshot()` calls contend with each
 *     other *and* with the user's own interactions on that page, so the
 *     preview gets slower exactly when it is already struggling. This
 *     loop is self-scheduling: the next frame is queued only after the
 *     previous one resolves, so load shedding is automatic and the
 *     cadence degrades gracefully instead of collapsing.
 *
 *  2. Frames were lossless PNG. See `screencastFormat` in the recorder
 *     config for why that was expensive.
 *
 * Returns a stop function. Safe to call more than once.
 */
export function startScreencast(
  getPage: () => Page | null,
  onFrame: (base64: string) => void,
  opts: { intervalMs?: number } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? recorderConfig.screenshotIntervalMs;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const page = getPage();
    if (page) {
      try {
        const buf = await page.screenshot({
          type: recorderConfig.screencastFormat,
          quality: recorderConfig.screencastQuality,
        });
        if (!stopped) onFrame(buf.toString("base64"));
      } catch {
        // The page is mid-navigation, closed, or otherwise not
        // screenshottable right now. Skip this frame and try the next.
      }
    }
    if (stopped) return;
    timer = setTimeout(() => void tick(), intervalMs);
  };

  // Kick off on the next tick so callers finish their own setup first.
  timer = setTimeout(() => void tick(), 0);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
