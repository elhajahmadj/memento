import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Each fake browser tracks whether it was closed and reports itself as
// connected unless explicitly disconnected, so the pool's `isConnected`
// guard can be exercised.
function makeBrowser() {
  let connected = true;
  return {
    close: vi.fn().mockImplementation(async () => {
      connected = false;
    }),
    isConnected: vi.fn().mockImplementation(() => connected),
    _disconnect() {
      connected = false;
    },
  };
}

const launch = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("@/features/recording/infrastructure/browserLauncher", () => ({
  launchRecordingChromium: launch.fn,
}));

import {
  prewarmBrowser,
  takePrewarmedBrowser,
  releasePrewarmedBrowser,
  releaseAllPrewarmedBrowsers,
} from "@/features/recording/infrastructure/prewarmPool";

beforeEach(() => {
  vi.useFakeTimers();
  launch.fn.mockReset();
});

afterEach(async () => {
  await releaseAllPrewarmedBrowsers();
  vi.useRealTimers();
});

describe("prewarmPool", () => {
  it("takePrewarmedBrowser returns the warmed browser and empties the pool", async () => {
    const browser = makeBrowser();
    launch.fn.mockResolvedValue(browser);

    prewarmBrowser("user-1");
    const taken = await takePrewarmedBrowser("user-1");
    expect(taken).toBe(browser);
    expect(launch.fn).toHaveBeenCalledTimes(1);

    // Pool is now empty — a second take falls back to null (caller
    // launches its own).
    expect(await takePrewarmedBrowser("user-1")).toBeNull();
  });

  it("does not double-launch when prewarm is called twice for one user", async () => {
    launch.fn.mockResolvedValue(makeBrowser());
    prewarmBrowser("user-1");
    prewarmBrowser("user-1");
    expect(launch.fn).toHaveBeenCalledTimes(1);
  });

  it("closes an unconsumed browser after the idle timeout", async () => {
    const browser = makeBrowser();
    launch.fn.mockResolvedValue(browser);
    prewarmBrowser("user-1");

    // Let the launch promise settle, then advance past the 5-minute idle.
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);

    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(await takePrewarmedBrowser("user-1")).toBeNull();
  });

  it("returns null when the warmed browser already disconnected", async () => {
    const browser = makeBrowser();
    launch.fn.mockResolvedValue(browser);
    prewarmBrowser("user-1");
    await Promise.resolve();
    browser._disconnect();

    expect(await takePrewarmedBrowser("user-1")).toBeNull();
  });

  it("releasePrewarmedBrowser closes and drops the entry", async () => {
    const browser = makeBrowser();
    launch.fn.mockResolvedValue(browser);
    prewarmBrowser("user-1");

    expect(await releasePrewarmedBrowser("user-1")).toBe(true);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(await releasePrewarmedBrowser("user-1")).toBe(false);
  });

  it("a late-rejecting launch does not evict a newer healthy entry", async () => {
    let rejectA: (e: unknown) => void = () => {};
    const promiseA = new Promise<never>((_, rej) => {
      rejectA = rej;
    });
    const browserB = makeBrowser();
    launch.fn
      .mockReturnValueOnce(promiseA) // entry A: slow, will reject
      .mockResolvedValueOnce(browserB); // entry B: healthy replacement

    prewarmBrowser("user-1"); // creates entry A
    // Consume A while its launch is still pending; this removes A from the
    // pool and awaits promiseA (which will reject -> null).
    const takenA = takePrewarmedBrowser("user-1");
    prewarmBrowser("user-1"); // pool empty again -> creates healthy entry B

    rejectA(new Error("boom")); // A rejects only now
    expect(await takenA).toBeNull();
    await Promise.resolve(); // let A's identity-guarded catch run

    // B must survive A's late rejection and still be consumable.
    expect(await takePrewarmedBrowser("user-1")).toBe(browserB);
  });

  it("swallows a failed speculative launch without throwing", async () => {
    launch.fn.mockRejectedValue(new Error("no chromium"));
    prewarmBrowser("user-1");
    await Promise.resolve();

    // Consuming a failed launch yields null rather than rejecting.
    expect(await takePrewarmedBrowser("user-1")).toBeNull();
  });

  it("stops warming once the pool hits its cap", async () => {
    process.env.RECORDER_PREWARM_MAX = "2";
    try {
      launch.fn.mockImplementation(async () => makeBrowser());
      prewarmBrowser("user-1");
      prewarmBrowser("user-2");
      prewarmBrowser("user-3"); // over the cap — skipped
      expect(launch.fn).toHaveBeenCalledTimes(2);
      expect(await takePrewarmedBrowser("user-3")).toBeNull();
    } finally {
      delete process.env.RECORDER_PREWARM_MAX;
    }
  });

  it("keys the pool per user", async () => {
    const a = makeBrowser();
    const b = makeBrowser();
    launch.fn.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    prewarmBrowser("user-a");
    prewarmBrowser("user-b");

    expect(await takePrewarmedBrowser("user-b")).toBe(b);
    expect(await takePrewarmedBrowser("user-a")).toBe(a);
  });
});
