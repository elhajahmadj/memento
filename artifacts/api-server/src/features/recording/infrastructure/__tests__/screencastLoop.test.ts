import { describe, it, expect, vi } from "vitest";
import type { Page } from "playwright";
import { startScreencast } from "@/features/recording/infrastructure/screencastLoop";
import { recorderConfig } from "@/features/projects/infrastructure/config";

/**
 * The screencast loop replaced
 * `setInterval(async () => { await page.screenshot() })`, which had two
 * problems this file pins down:
 *
 *  - `setInterval` never awaits its callback, so once a frame took
 *    longer than the interval the next tick fired anyway and calls
 *    stacked up. Concurrent `page.screenshot()` calls contend with each
 *    other and with the user's own interaction — the preview got slower
 *    precisely when it was already slow (during navigation).
 *  - Frames were lossless PNG, which is expensive to encode and ~10x
 *    larger on the wire than the JPEG a preview needs.
 */

/** A fake page whose screenshot takes `delayMs` and counts overlap. */
function makePage(delayMs: number) {
  let inFlight = 0;
  let maxConcurrent = 0;
  const calls: Array<Record<string, unknown>> = [];
  const page = {
    screenshot: vi.fn(async (opts: Record<string, unknown>) => {
      calls.push(opts);
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, delayMs));
      inFlight--;
      return Buffer.from("frame-bytes");
    }),
  } as unknown as Page;
  return { page, calls, get maxConcurrent() { return maxConcurrent; } };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("startScreencast", () => {
  it("encodes frames as JPEG with a quality, not lossless PNG", async () => {
    const p = makePage(0);
    const stop = startScreencast(() => p.page, () => {}, { intervalMs: 5 });
    await tick(40);
    stop();
    expect(p.calls.length).toBeGreaterThan(0);
    expect(p.calls[0]).toMatchObject({
      type: recorderConfig.screencastFormat,
      quality: recorderConfig.screencastQuality,
    });
    expect(recorderConfig.screencastFormat).toBe("jpeg");
  });

  it("never overlaps screenshots, even when a frame outlasts the interval", async () => {
    // 40 ms frames on a 5 ms cadence: setInterval would have ~8 calls
    // stacked at once. The self-scheduling loop must stay at 1.
    const p = makePage(40);
    const stop = startScreencast(() => p.page, () => {}, { intervalMs: 5 });
    await tick(200);
    stop();
    expect(p.maxConcurrent).toBe(1);
  });

  it("sheds load instead of queueing when frames are slow", async () => {
    const p = makePage(50);
    const stop = startScreencast(() => p.page, () => {}, { intervalMs: 1 });
    await tick(220);
    stop();
    // ~4 frames fit in 220 ms at 50 ms each. The old interval would have
    // fired ~220 times. Assert we're in the "one at a time" regime.
    expect(p.calls.length).toBeLessThan(10);
  });

  it("emits base64 frame data to the callback", async () => {
    const p = makePage(0);
    const frames: string[] = [];
    const stop = startScreencast(() => p.page, (d) => frames.push(d), {
      intervalMs: 5,
    });
    await tick(40);
    stop();
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toBe(Buffer.from("frame-bytes").toString("base64"));
  });

  it("stops scheduling after stop(), including mid-flight", async () => {
    const p = makePage(30);
    const stop = startScreencast(() => p.page, () => {}, { intervalMs: 5 });
    await tick(15); // stop while a screenshot is in flight
    stop();
    const countAtStop = p.calls.length;
    await tick(150);
    // The in-flight frame may finish, but it must not queue another.
    expect(p.calls.length).toBe(countAtStop);
  });

  it("is safe to stop more than once", async () => {
    const p = makePage(0);
    const stop = startScreencast(() => p.page, () => {}, { intervalMs: 5 });
    await tick(20);
    expect(() => {
      stop();
      stop();
    }).not.toThrow();
  });

  it("skips frames while the page is unavailable but keeps polling", async () => {
    // Mirrors a torn-down-then-restored session: a null page must not
    // kill the loop, or the preview would go permanently black.
    const p = makePage(0);
    let live = false;
    const stop = startScreencast(() => (live ? p.page : null), () => {}, {
      intervalMs: 5,
    });
    await tick(30);
    expect(p.calls.length).toBe(0);
    live = true;
    await tick(40);
    stop();
    expect(p.calls.length).toBeGreaterThan(0);
  });

  it("survives a screenshot that throws (page mid-navigation)", async () => {
    let calls = 0;
    const page = {
      screenshot: vi.fn(async () => {
        calls++;
        if (calls <= 2) throw new Error("Target closed");
        return Buffer.from("ok");
      }),
    } as unknown as Page;
    const frames: string[] = [];
    const stop = startScreencast(() => page, (d) => frames.push(d), {
      intervalMs: 5,
    });
    await tick(80);
    stop();
    expect(frames.length).toBeGreaterThan(0);
  });
});
