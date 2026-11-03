import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { installPersistentRouteMocks } from "@/features/route-mocks/infrastructure/routeMockService";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import type {
  AuthStateLoader,
  PreparedReplay,
  ReachabilityProbe,
  RecordingLoader,
  ReplayEventBus,
  ValidationStartArgs,
} from "../application/ports";
import {
  makePrepareReplay,
  type PrepareReplayResult,
} from "../application/useCases/prepareReplay";
import { replayHookSets } from "./hookReplayer";
import { replaySteps } from "./stepReplayer";

let cachedChromiumPath: string | undefined;
function resolveChromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (cachedChromiumPath !== undefined) return cachedChromiumPath || undefined;
  try {
    cachedChromiumPath = execSync("which chromium", { encoding: "utf8" }).trim();
    return cachedChromiumPath;
  } catch {
    cachedChromiumPath = "";
    return undefined;
  }
}

export interface ExecuteReplayDeps {
  events: ReplayEventBus;
  recordings: RecordingLoader;
  authStates: AuthStateLoader;
  reachability: ReachabilityProbe;
  finishRun(
    runId: string,
    status: "passed" | "failed" | "error",
    summary: Record<string, unknown>,
  ): Promise<void>;
  markRunning(runId: string): Promise<void>;
}

/**
 * Composition root for a single replay run. Wires the pure
 * `prepareReplay` use case (recording load + reachability + step plan)
 * to the Playwright-bound `replayHookSets` / `replaySteps` adapters,
 * then delegates the terminal result to `finishRun`.
 *
 * Browser lifecycle (launch, context, tracing, trace + screenshot
 * persistence) stays here because it is inherently infrastructure.
 */
export function makeExecuteReplay(deps: ExecuteReplayDeps) {
  const { events, recordings, authStates, reachability, finishRun, markRunning } =
    deps;

  const prepareReplay = makePrepareReplay({
    events,
    recordings,
    authStates,
    reachability,
    resolveProject: (args) => getCurrentProject(args.userId) ?? null,
  });

  return async function executeReplay(
    runId: string,
    args: ValidationStartArgs,
  ): Promise<void> {
    await markRunning(runId);
    events.push(runId, { type: "run-started", runId });

    let prep: PrepareReplayResult;
    try {
      prep = await prepareReplay(runId, args);
    } catch (err) {
      await finishRun(runId, "error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!prep.ok) {
      await finishRun(runId, prep.status, prep.summary);
      return;
    }
    await runPreparedReplay(runId, args, prep.prepared, events, finishRun);
  };
}

async function runPreparedReplay(
  runId: string,
  args: ValidationStartArgs,
  prepared: PreparedReplay,
  events: ReplayEventBus,
  finishRun: ExecuteReplayDeps["finishRun"],
): Promise<void> {
  const { stored, hookSets, steps, storageState, ownerUserId, project } = prepared;
  const tracesDir = path.join(process.cwd(), ".validation-traces");
  await fs.mkdir(tracesDir, { recursive: true });
  const traceAbsPath = path.join(tracesDir, `${runId}.zip`);
  const screenshotAbsPath = path.join(tracesDir, `${runId}-final.png`);

  const executablePath = resolveChromiumPath();
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  let context: BrowserContext | undefined;
  let traceWritten = false;
  let finalScreenshotWritten = false;
  const startedAt = Date.now();
  let outcome: "passed" | "failed" | "error" = "passed";
  let failureMessage: string | null = null;

  try {
    context = await browser.newContext({
      viewport: recorderConfig.viewport,
      ...(storageState ? { storageState: storageState as never } : {}),
    });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });
    const page = await context.newPage();
    const responseCtx: { lastMainFrameStatus: number | null } = {
      lastMainFrameStatus: null,
    };
    page.on("response", (resp) => {
      try {
        if (resp.frame() !== page.mainFrame()) return;
        const req = resp.request();
        if (!req.isNavigationRequest()) return;
        const url = resp.url();
        if (url.startsWith("http://") || url.startsWith("https://")) {
          responseCtx.lastMainFrameStatus = resp.status();
        }
      } catch {
        /* response detached — ignore */
      }
    });

    // Install enabled Settings → Mocks rules before any navigation so
    // the recorded test (and its setup hooks) replay against the same
    // canned backend that recorded them.
    try {
      const installed = await installPersistentRouteMocks(
        page,
        ownerUserId,
        project.solutionName,
      );
      if (installed > 0) {
        events.push(runId, { type: "mocks-installed", count: installed });
      }
    } catch (err) {
      events.push(runId, {
        type: "mocks-install-failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const hookResult = await replayHookSets({ page, hookSets, runId, events });
    if (!hookResult.ok) {
      outcome = "error";
      failureMessage = hookResult.failureMessage;
    } else {
      const stepResult = await replaySteps({
        page,
        steps,
        args,
        startedAt,
        runId,
        events,
        responseCtx,
        projectName: project.solutionName,
        startUrl: stored.startUrl,
      });
      outcome = stepResult.outcome;
      failureMessage = stepResult.failureMessage;
    }

    try {
      await page.screenshot({ path: screenshotAbsPath, fullPage: false });
      finalScreenshotWritten = true;
    } catch {
      /* non-fatal */
    }
    try {
      await context.tracing.stop({ path: traceAbsPath });
      traceWritten = true;
    } catch {
      /* non-fatal */
    }
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  await finishRun(runId, outcome, {
    steps,
    failureMessage,
    finalScreenshot: finalScreenshotWritten
      ? path.basename(screenshotAbsPath)
      : null,
    traceFile: traceWritten ? path.basename(traceAbsPath) : null,
    durationMs: Date.now() - startedAt,
  });
}
