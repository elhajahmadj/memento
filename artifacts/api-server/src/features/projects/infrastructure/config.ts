import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const recorderConfig = {
  workspaceDir: path.resolve(
    process.env.WORKSPACE_DIR ?? path.resolve(here, "..", "..", "..", "workspace"),
  ),
  // Templates live next to the compiled bundle; we read raw .tpl files from the
  // package's src directory so they can be edited without rebuilding.
  templatesDir: path.resolve(here, "..", "templates"),
  ignoreDirs: new Set(["bin", "obj", ".vs", "node_modules", ".git"]),
  defaultBrowserChannel: "Edge" as const,
  screenshotIntervalMs: 100,
  viewport: { width: 1280, height: 800 },
  /**
   * Live-screencast frame encoding. JPEG, not PNG: PNG is lossless, and
   * a 1280x800 screenshot of a content-heavy page encodes to roughly
   * 0.3–1.5 MB. Base64 then adds another third on the way out over the
   * WebSocket. At the 100 ms cadence above that is megabytes per second
   * of payload plus lossless-compression CPU — on a 1 GB / 1 shared-CPU
   * Fly machine that alone made "open browser and navigate" crawl.
   *
   * The same frames as JPEG at this quality land around 30–80 KB: an
   * order of magnitude less to encode and to ship, for a preview the
   * user only ever looks at (selectors are captured from the DOM, never
   * from these pixels, so lossy compression costs nothing real).
   */
  screencastFormat: "jpeg" as const,
  screencastQuality: 60,
};
