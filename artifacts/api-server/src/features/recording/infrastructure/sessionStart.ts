import { startScreencast } from "@/features/recording/infrastructure/screencastLoop";
import { randomUUID } from "node:crypto";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { getCurrentProject, type Project } from "@/features/projects/infrastructure/projectService";
import { RECORDER_SCRIPT } from "@/features/recording/infrastructure/recorderInjection";
import {
  isHookDefaultStub,
} from "@/features/codegen/infrastructure/codegenAdapter";
import {
  type RecordedAction,
} from "@/features/codegen/infrastructure/codegen";
import { loadAuthStateStorageState } from "@/features/auth-states/infrastructure/authStateService";
import { installPersistentRouteMocks } from "@/features/route-mocks/infrastructure/routeMockService";
import { loadHooksForClass } from "@/features/recording/infrastructure/recordedActionStore";
import { normalizeNewTestClassName } from "@/features/recording/domain/naming";
import { computeNamingExtras } from "@/features/recording/infrastructure/namingExtras";
import type {
  RecordingStatus,
  Session,
  SessionConfig,
} from "@/features/recording/domain/sessionTypes";
import type { BrowserContext, Page } from "playwright";
import { launchRecordingChromium } from "@/features/recording/infrastructure/browserLauncher";
import { takePrewarmedBrowser } from "@/features/recording/infrastructure/prewarmPool";
import { upsertNamedUrl } from "@/features/recording/infrastructure/namedUrls";
import {
  broadcast,
  broadcastBodyPreview,
  getSession,
  setSession,
  tearDownCurrentSession,
} from "@/features/recording/infrastructure/sessionState";
import { replayStoredHook } from "@/features/recording/infrastructure/hookOps";
import { getStatus } from "@/features/recording/infrastructure/sessionQueries";

export async function start(
  config: SessionConfig,
  userId: string,
  project?: Project | null,
): Promise<RecordingStatus> {
  const existing = getSession();
  // Task #120 — kept-open session owned by same user that they did not
  // attach to (opened the fresh dialog instead) gets torn down.
  if (
    existing &&
    existing.userId === userId &&
    existing.config.keepBrowserOpen === true &&
    (existing.phase === "stopped" ||
      (existing.phase === "recording" && existing.config.attached === false))
  ) {
    await tearDownCurrentSession();
  }
  if (getSession()) throw new Error("Recording already in progress");
  if (!userId) throw new Error("Authentication required");
  const resolvedProject = project ?? getCurrentProject();
  if (!resolvedProject) throw new Error("No project loaded");

  // Auto-suffix `newTestClassName` for Node.js. C# is suffixed inside
  // codegen.generateTestClass so we keep the bare stem here for the
  // Page Object / Selectors / Actions filename derivation.
  config = {
    ...config,
    newTestClassName: normalizeNewTestClassName(
      config.newTestClassName,
      resolvedProject.language,
    ),
  };

  // Capture sessions never write the start URL into the project.
  if (!config.captureMode && config.originatedFrom !== "open-browser") {
    await upsertNamedUrl(resolvedProject, config.urlName, config.startUrl);
  }

  // Consume the browser pre-warmed when the project was opened/created,
  // falling back to a fresh launch if none is ready.
  const browser =
    (await takePrewarmedBrowser(userId)) ?? (await launchRecordingChromium());
  const effectiveViewport = config.viewport ?? recorderConfig.viewport;

  // Until the browser is handed to the session it is tracked by nothing,
  // so any failure during context/page setup must close it — otherwise a
  // throw (e.g. a storageState decode error) strands a Chromium process.
  let context: BrowserContext;
  let page: Page;
  let newSession: Session;
  try {
    let savedStorageState: object | undefined;
    if (config.useSavedLogin) {
      // Decrypts the stored payload (H-2); null when absent or when the
      // key can no longer read it, in which case the recording simply
      // starts unauthenticated.
      savedStorageState =
        (await loadAuthStateStorageState({
          userId,
          projectName: resolvedProject.solutionName,
        })) ?? undefined;
    }
    context = await browser.newContext({
      viewport: effectiveViewport,
      ...(savedStorageState ? { storageState: savedStorageState as never } : {}),
    });
    page = await context.newPage();

    try {
      await installPersistentRouteMocks(
        page,
        userId,
        resolvedProject.solutionName,
      );
    } catch {
      // Non-fatal — recording continues against the live backend.
    }

    newSession = {
      config,
      project: resolvedProject,
      browser,
      page,
      viewport: effectiveViewport,
      actions: [],
      sockets: new Set(),
      phase: "recording",
      active: true,
      assertionLabelIndex: 0,
      waitLabelIndex: 0,
      lastEditableSelector: null,
      lastEditableStrategy: null,
      suppressNextChangeFill: null,
      lastRenameByIndex: new Map(),
      replaying: false,
      attached: true,
      userId,
      sessionToken: randomUUID(),
    };
    setSession(newSession);
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }

  await context.exposeBinding("__recorderEmit", (_src, raw: RecordedAction & { strategy?: RecordedAction["selectorStrategy"] }) => {
    const session = getSession();
    if (!session) return;
    if (session.replaying) return;
    if (!session.attached) return;
    const action: RecordedAction = {
      ...raw,
      selectorStrategy: raw.selectorStrategy ?? raw.strategy,
    };
    if (action.type === "click" && action.editable && action.selector) {
      session.lastEditableSelector = action.selector;
      session.lastEditableStrategy = action.selectorStrategy ?? null;
      broadcast({ type: "action", action });
      return;
    }
    if (
      action.type === "fill" &&
      session.suppressNextChangeFill &&
      session.suppressNextChangeFill.selector === action.selector &&
      session.suppressNextChangeFill.value === action.value
    ) {
      session.suppressNextChangeFill = null;
      return;
    }
    session.actions.push(action);
    const idx = session.actions.length - 1;
    const aLive = session.actions.filter((a) => !a.deleted);
    broadcast({
      type: "action",
      action,
      index: idx,
      ...computeNamingExtras(
        aLive,
        !!action.selector && action.type !== "navigate",
        session.project,
      ),
    });
    broadcastBodyPreview().catch(() => {});
  });

  await context.addInitScript(RECORDER_SCRIPT);

  page.on("framenavigated", (frame) => {
    const session = getSession();
    if (frame === page.mainFrame()) {
      if (session?.replaying) return;
      if (session && !session.attached) return;
      const url = frame.url();
      const action: RecordedAction = { type: "navigate", url };
      session?.actions.push(action);
      const idx = (session?.actions.length ?? 0) - 1;
      broadcast({ type: "action", action, index: idx });
      broadcastBodyPreview().catch(() => {});
    }
  });

  // Replay any stored setup-hook actions for the chosen existing class.
  let replayedAtLeastOneHook = false;
  // `replaySetup !== false` — omitted means replay, so clients that
  // predate the flag (and the JMX/open-browser paths) behave as before.
  if (
    config.target === "testMethod" &&
    config.existingTestClassPath &&
    resolvedProject.solutionName &&
    config.replaySetup !== false
  ) {
    try {
      const stored = await loadHooksForClass({
        userId,
        projectName: resolvedProject.solutionName,
        filePath: config.existingTestClassPath,
      });
      const order: Array<"oneTimeSetup" | "beforeEach"> = [
        "oneTimeSetup",
        "beforeEach",
      ];
      newSession.replaying = true;
      try {
        for (const hook of order) {
          const set = stored[hook];
          if (!set) continue;
          const isDefault = await isHookDefaultStub(
            resolvedProject,
            config.existingTestClassPath,
            hook,
          ).catch(() => true);
          if (isDefault) continue;
          await replayStoredHook(page, set);
          replayedAtLeastOneHook = true;
        }
      } finally {
        newSession.replaying = false;
      }
    } catch (err) {
      newSession.replaying = false;
      setSession(null);
      await browser.close().catch(() => {});
      throw new Error(
        `Failed to replay stored setup-hook actions: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  if (!replayedAtLeastOneHook) {
    await page.goto(config.startUrl).catch(() => {
      // ignore initial load failures
    });
  }

  newSession.stopScreencast = startScreencast(
    () => {
      const session = getSession();
      return session && session.active ? session.page : null;
    },
    (data) => {
      const session = getSession();
      if (!session) return;
      broadcast({
        type: "frame",
        data,
        width: session.viewport.width,
        height: session.viewport.height,
      });
    },
  );

  return getStatus();
}
