import { startScreencast } from "@/features/recording/infrastructure/screencastLoop";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { getCurrentProject, type Project } from "@/features/projects/infrastructure/projectService";
import { RECORDER_SCRIPT } from "@/features/recording/infrastructure/recorderInjection";
import { type RecordedAction } from "@/features/codegen/infrastructure/codegen";
import { installPersistentRouteMocks } from "@/features/route-mocks/infrastructure/routeMockService";
import { computeNamingExtras } from "@/features/recording/infrastructure/namingExtras";
import type {
  RecordingStatus,
  Session,
} from "@/features/recording/domain/sessionTypes";
import type { BrowserContext, Page } from "playwright";
import { launchRecordingChromium } from "@/features/recording/infrastructure/browserLauncher";
import { takePrewarmedBrowser } from "@/features/recording/infrastructure/prewarmPool";
import {
  broadcast,
  broadcastBodyPreview,
  getSession,
  setSession,
  tearDownCurrentSession,
} from "@/features/recording/infrastructure/sessionState";
import { getStatus } from "@/features/recording/infrastructure/sessionQueries";

/**
 * Open-browser flow (task #117): launch Chromium navigated to the URL
 * and stream frames over /ws/recording, but drop captured events
 * until `attachToOpenBrowser` promotes the session.
 */
export async function openBrowser(args: {
  url: string;
  viewport?: { width: number; height: number } | undefined;
  userId: string;
  project?: Project | null | undefined;
}): Promise<RecordingStatus> {
  const existing = getSession();
  // Task #120 — same fresh-start override as start(), restricted to
  // reusable keep-open shapes.
  if (
    existing &&
    existing.userId === args.userId &&
    existing.config.keepBrowserOpen === true &&
    (existing.phase === "stopped" ||
      (existing.phase === "recording" && existing.config.attached === false))
  ) {
    await tearDownCurrentSession();
  }
  if (getSession()) throw new Error("Recording already in progress");
  if (!args.userId) throw new Error("Authentication required");
  const resolvedProject = args.project ?? getCurrentProject();
  if (!resolvedProject) throw new Error("No project loaded");

  // Consume the browser pre-warmed when the project was opened/created,
  // falling back to a fresh launch if none is ready.
  const browser =
    (await takePrewarmedBrowser(args.userId)) ??
    (await launchRecordingChromium());
  const effectiveViewport = args.viewport ?? recorderConfig.viewport;

  // Until the browser is handed to the session it is tracked by nothing,
  // so any failure during context/page setup must close it — otherwise a
  // throw strands a Chromium process.
  let context: BrowserContext;
  let page: Page;
  let newSession: Session;
  try {
    context = await browser.newContext({ viewport: effectiveViewport });
    page = await context.newPage();

    try {
      await installPersistentRouteMocks(
        page,
        args.userId,
        resolvedProject.solutionName,
      );
    } catch {
      // Non-fatal — open browser continues against the live backend.
    }

    newSession = {
      config: {
        startUrl: args.url,
        urlName: "",
        target: "testMethod",
        methodName: "",
        existingTestClassPath: null,
        newTestClassName: null,
        viewport: args.viewport,
        originatedFrom: "open-browser",
      },
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
      attached: false,
      userId: args.userId,
      sessionToken: randomUUID(),
    };
    setSession(newSession);
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }

  await context.exposeBinding(
    "__recorderEmit",
    (_src, raw: RecordedAction & { strategy?: RecordedAction["selectorStrategy"] }) => {
      const session = getSession();
      if (!session) return;
      if (session.replaying) return;
      const action: RecordedAction = {
        ...raw,
        selectorStrategy: raw.selectorStrategy ?? raw.strategy,
      };
      if (action.type === "click" && action.editable && action.selector) {
        session.lastEditableSelector = action.selector;
        session.lastEditableStrategy = action.selectorStrategy ?? null;
        if (!session.attached) {
          // Pre-attach: let the user type into fields to reach the state
          // they want to record from. Its own message, not an `action`,
          // so nothing enters the recorded feed. See REQUIREMENTS.md.
          broadcast({
            type: "editableFocus",
            editable: action.editable,
            selector: action.selector,
          });
          return;
        }
        broadcast({ type: "action", action });
        return;
      }
      // All other events stay suppressed until attachToOpenBrowser.
      if (!session.attached) return;
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
    },
  );

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

  await page.goto(args.url).catch(() => {
    // Ignore initial load failures
  });

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

/**
 * Error thrown by `attachToOpenBrowser` when the requested existing
 * test class file does not exist on disk. Carried to the route handler
 * so it can map to HTTP 404.
 */
export class AttachExistingSuiteMissingError extends Error {
  constructor(filePath: string) {
    super(`Existing test class not found: ${filePath}`);
    this.name = "AttachExistingSuiteMissingError";
  }
}

/**
 * Promote an open-browser session into a real recording.
 */
export async function attachToOpenBrowser(args: {
  userId: string;
  existingTestClassPath: string;
  methodName: string;
  overwriteExistingMethod?: boolean;
  ignoreReason?: string | null;
  categoryConstantName?: string | null;
  categoryValue?: string | null;
  keepBrowserOpen?: boolean;
}): Promise<RecordingStatus> {
  const session = getSession();
  if (!session) throw new Error("No open-browser session to attach to");
  if (session.userId !== args.userId) {
    throw new Error("Open-browser session belongs to another user");
  }
  if (session.config.originatedFrom !== "open-browser") {
    throw new Error(
      "Cannot attach: the active session was not started with /recording/open-browser",
    );
  }
  if (session.attached) {
    throw new Error("Open-browser session is already attached");
  }
  const abs = path.resolve(session.project.rootPath, args.existingTestClassPath);
  const rel = path.relative(session.project.rootPath, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AttachExistingSuiteMissingError(args.existingTestClassPath);
  }
  try {
    await fs.access(abs);
  } catch {
    throw new AttachExistingSuiteMissingError(args.existingTestClassPath);
  }

  session.config = {
    ...session.config,
    target: "testMethod",
    existingTestClassPath: args.existingTestClassPath,
    newTestClassName: null,
    methodName: args.methodName,
    overwriteExistingMethod: args.overwriteExistingMethod === true,
    ignoreReason: args.ignoreReason ?? null,
    categoryConstantName: args.categoryConstantName ?? null,
    categoryValue: args.categoryValue ?? null,
    keepBrowserOpen: args.keepBrowserOpen === true,
  };
  session.attached = true;
  return getStatus();
}

/**
 * Cancel an open-browser session without promoting it. Idempotent.
 */
export async function cancelOpenBrowser(userId: string): Promise<{
  canceled: boolean;
}> {
  const session = getSession();
  if (!session) return { canceled: false };
  if (session.userId !== userId) return { canceled: false };
  if (session.config.originatedFrom !== "open-browser") {
    return { canceled: false };
  }
  await tearDownCurrentSession();
  return { canceled: true };
}

/**
 * Test-only accessor for the current session's action buffer.
 */
export function _getSessionActionsForTest(): RecordedAction[] | null {
  const s = getSession();
  return s ? s.actions.slice() : null;
}
