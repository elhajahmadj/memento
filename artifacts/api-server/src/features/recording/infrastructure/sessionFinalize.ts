import { startScreencast } from "@/features/recording/infrastructure/screencastLoop";
import { randomUUID } from "node:crypto";
import {
  type AddTestMethodResult,
  buildFillConstants,
  ensureAsyncSuffix,
  hookMethodName,
  type HookKind,
  type RecordedAction,
} from "@/features/codegen/infrastructure/codegen";
import * as csharpCodegen from "@/features/codegen/infrastructure/codegen";
import {
  addTestMethod,
  ensureCategoryFile,
  buildSuiteHeaderLines,
  checkTestMethodExists,
  constantsRef,
  generateTestClass,
  csharpMacroIdentifier,
  quotedArg,
  readRecordedConstants,
  renderActionCallLine,
  renderApiAssertionLine,
  renderAssertionLine,
  renderRouteMockLine,
  renderWaitLine,
  writeMacroHelperFile,
  replaceHookBody,
  upsertTestCategoryConstant,
  writeRecordedConstants,
} from "@/features/codegen/infrastructure/codegenAdapter";
import * as codegenAdapter from "@/features/codegen/infrastructure/codegenAdapter";
import { generateTest } from "@/features/codegen/application/useCases/generateTest";
import {
  saveHookActions,
  saveActionSet,
} from "@/features/recording/infrastructure/recordedActionStore";
import { resolveSuiteName, targetClassName } from "@/features/recording/domain/naming";
import type {
  RecordingStatus,
  StopDecision,
  StopResult,
} from "@/features/recording/domain/sessionTypes";
import {
  broadcast,
  broadcastFeedReset,
  getSession,
  setSession,
} from "@/features/recording/infrastructure/sessionState";
import { getStatus } from "@/features/recording/infrastructure/sessionQueries";

/**
 * Thrown when a caller tries to act on a recording session they do not
 * own. Routes map this to 403.
 */
export class SessionOwnershipError extends Error {
  constructor() {
    super("This recording session belongs to another user.");
    this.name = "SessionOwnershipError";
  }
}

/**
 * Audit finding H-8. The recording session is a process-wide singleton,
 * so "there is a session" says nothing about whose it is. `discardSession`
 * always took a `userId` and refused to touch someone else's session;
 * `stopBrowser` and `finalize` did not, so any authenticated user — a
 * guest included, since `/recording/*` is wildcard-allowed for guests —
 * could stop or even finalize another user's in-progress recording. For
 * `finalize` that meant writing someone else's recorded actions into
 * project files.
 *
 * Admins retain a deliberate, audited override via
 * `/recording/force-discard`, which is the supported way to clear a
 * session left dangling by another user.
 */
function assertSessionOwner(session: { userId: string }, userId: string): void {
  if (session.userId !== userId) throw new SessionOwnershipError();
}

export async function stopBrowser(userId: string): Promise<RecordingStatus> {
  const session = getSession();
  if (!session) throw new Error("No active recording");
  assertSessionOwner(session, userId);
  if (session.phase === "recording") {
    session.phase = "stopped";
    session.active = false;
    if (session.stopScreencast) {
      session.stopScreencast();
      session.stopScreencast = undefined;
    }
    // Task #120 — if the user ticked "Keep browser open after stop"
    // when starting (or attaching), leave the Chromium process alive.
    // The workbench still treats the session as `phase === "stopped"`
    // (so Save / Discard affordances appear), but the page handle
    // stays usable so a follow-up finalize() can recycle it into a
    // fresh open-browser pre-attach session without re-launching.
    if (!session.config.keepBrowserOpen) {
      await session.browser.close().catch(() => {});
    }
    broadcast({ type: "browserStopped" });
  }
  return getStatus();
}

/**
 * Backwards-compatible alias kept for any internal call-site that still
 * imports `stop`. Routes now call `stopBrowser` and `finalize` directly.
 */
export async function stop(
  decision: StopDecision | undefined,
  userId: string,
): Promise<StopResult> {
  return finalize(decision, userId);
}

export async function finalize(
  decision: StopDecision | undefined,
  userId: string,
): Promise<StopResult> {
  const session = getSession();
  if (!session) throw new Error("No active recording");
  // H-8: finalize writes the recorded actions into project files, so a
  // non-owner reaching it is worse than a non-owner stopping the browser.
  assertSessionOwner(session, userId);
  // T002 capture-only sessions exist solely to harvest cookies +
  // localStorage. They MUST never write generated test code: that's how
  // login keystrokes (typed during capture) end up in a checked-in
  // .cs / .py / .ts file. Treat finalize as a discard for these.
  if (session.config.captureMode) {
    session.stopScreencast?.();
    if (session.phase === "recording") {
      await session.browser.close().catch(() => {});
    }
    const sockets = Array.from(session.sockets);
    session.active = false;
    setSession(null);
    for (const sock of sockets) {
      try {
        sock.send(JSON.stringify({ type: "captureSessionDiscarded" }));
      } catch {
        /* socket already closed */
      }
    }
    return {
      status: "completed",
      generatedFiles: [],
      summary: "Capture session discarded — saved login state only.",
      hookBackupPath: null,
    };
  }
  const project = session.project;

  // Resolve the chosen method name (only relevant for testMethod targets).
  let chosenMethodName = session.config.methodName;
  let overwrite = session.config.overwriteExistingMethod === true;
  if (decision?.mode === "rename") {
    const trimmed = decision.methodName?.trim() ?? "";
    if (!trimmed) {
      throw new Error("methodName is required when decision is 'rename'");
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      throw new Error(
        "methodName must start with a letter/underscore and contain only letters, digits, or underscores",
      );
    }
    chosenMethodName = trimmed;
  } else if (decision?.mode === "overwrite") {
    overwrite = true;
  }

  // Collision pre-check: when the user did not yet pick a decision and the
  // target is an existing test class with a colliding method name, return a
  // collision payload so the UI can prompt the user. The session stays alive
  // so the user can decide without re-recording.
  const target = session.config.target;
  if (
    target === "testMethod" &&
    !decision &&
    !overwrite &&
    session.config.existingTestClassPath &&
    chosenMethodName
  ) {
    const existingPath = session.config.existingTestClassPath;
    const collision = await checkTestMethodExists(
      project,
      existingPath,
      chosenMethodName,
    ).catch(() => ({ exists: false, suggestedName: chosenMethodName }));
    if (collision.exists) {
      const className = targetClassName(session.config) ?? existingPath;
      const resolvedMethodName =
        project.language === "csharp"
          ? ensureAsyncSuffix(chosenMethodName)
          : chosenMethodName;
      return {
        status: "collision",
        methodName: resolvedMethodName,
        suggestedName: collision.suggestedName,
        targetClass: className,
      };
    }
  }

  session.active = false;
  session.stopScreencast?.();

  const generated: { path: string; created: boolean }[] = [];

  const isOpenBrowserSession =
    session.config.originatedFrom === "open-browser";
  if (!isOpenBrowserSession) {
    try {
      const tcPath = await codegenAdapter.regenerateTestConfig(project);
      if (tcPath) generated.push({ path: tcPath, created: false });
    } catch {
      // Best-effort sidecar — failure must not break finalize.
    }
  }

  // Determine target test class
  let targetPath = session.config.existingTestClassPath ?? null;
  if (!targetPath && session.config.newTestClassName) {
    targetPath = await generateTestClass(
      project,
      session.config.newTestClassName,
    );
    generated.push({ path: targetPath, created: true });
  }
  let addedMethod: AddTestMethodResult | null = null;
  let hookBackupPath: string | null = null;

  const suiteName = resolveSuiteName(session.config, project);

  const recordedSelectorActions = session.actions.filter(
    (a) => a.selector && !a.deleted,
  );
  const suiteResult = await generateTest({
    project,
    suiteName,
    actions: recordedSelectorActions,
  });
  if (suiteResult.kind === "err") {
    const cause = suiteResult.error.cause;
    throw cause instanceof Error
      ? cause
      : new Error(suiteResult.error.message);
  }
  const suite = suiteResult.value;
  generated.push({ path: suite.selectorsPath, created: true });
  generated.push({ path: suite.interfacePath, created: true });
  generated.push({ path: suite.actionsPath, created: true });

  if (targetPath) {
    const { header, actionsVar } = buildSuiteHeaderLines(
      project,
      suiteName,
      session.config.urlName,
    );
    const lines: string[] = [header[0]!];
    for (const a of session.actions) {
      if (a.deleted) continue;
      if (a.type !== "routeMock") continue;
      const line = renderRouteMockLine(project, a);
      if (line) lines.push(line);
    }
    if (!isOpenBrowserSession) {
      lines.push(header[1]!);
    }

    const lang = project.language ?? "csharp";
    const constantsSuiteName =
      lang === "csharp" ||
      lang === "nodejs" ||
      lang === "python" ||
      lang === "java"
        ? suiteName
        : undefined;
    const existingConstants = await readRecordedConstants(
      project,
      constantsSuiteName,
    ).catch(() => new Map<string, string>());
    const constants = buildFillConstants(
      session.actions,
      suite.methodNames,
      existingConstants,
    );
    let constantsByMethod = new Map<string, string>();
    if (constants.byName.size > 0) {
      try {
        const constantsPath = await writeRecordedConstants(
          project,
          constants.byName,
          constantsSuiteName,
        );
        constantsByMethod = constants.byMethod;
        generated.push({
          path: constantsPath,
          created: existingConstants.size === 0,
        });
      } catch {
        // Constants failed to write; emit inline literals.
      }
    }

    const macroHelperLines = new Map<string, string[]>();
    let pendingMacro: string | null = null;
    let pendingMacroLines: string[] = [];
    const flushPendingMacro = () => {
      if (pendingMacro && pendingMacroLines.length > 0) {
        macroHelperLines.set(pendingMacro, [...pendingMacroLines]);
        const symbol = csharpMacroIdentifier(pendingMacro);
        lines.push(`await ${symbol}Steps.RunAsync(${actionsVar});`);
      }
      pendingMacro = null;
      pendingMacroLines = [];
    };
    const renderActionLine = (a: RecordedAction): string | null => {
      if (a.type === "navigate") return null;
      if (a.type === "assert") {
        return renderAssertionLine(project, a);
      }
      if (a.type === "routeMock") {
        return null;
      }
      if (a.type === "apiAssertion") {
        return renderApiAssertionLine(project, a);
      }
      if (a.type === "wait") {
        return renderWaitLine(project, a);
      }
      if (!a.selector) return null;
      const methodName = suite.methodNames.get(a);
      if (!methodName) return null;
      const takesValue = suite.takesValueByMethod.get(methodName) === true;
      let arg = "";
      if (takesValue) {
        const constName = constantsByMethod.get(methodName);
        arg =
          a.type === "fill" && constName
            ? constantsRef(project, constName, constantsSuiteName)
            : quotedArg(project, a.value ?? "");
      }
      return renderActionCallLine(project, actionsVar, methodName, arg);
    };
    for (const a of session.actions) {
      if (a.deleted) continue;
      const isCsharp = (project.language ?? "csharp") === "csharp";
      if (isCsharp && a.macroName) {
        if (pendingMacro && pendingMacro !== a.macroName) {
          flushPendingMacro();
        }
        const line = renderActionLine(a);
        if (line) {
          pendingMacro = a.macroName;
          pendingMacroLines.push(line);
        }
        continue;
      }
      if (pendingMacro) flushPendingMacro();
      const line = renderActionLine(a);
      if (line) lines.push(line);
    }
    if (pendingMacro) flushPendingMacro();
    for (const [macroName, macroLines] of macroHelperLines) {
      if (macroLines.length === 0) continue;
      try {
        const helperPath = await writeMacroHelperFile(
          project,
          suiteName,
          macroName,
          macroLines,
        );
        if (helperPath) generated.push({ path: helperPath, created: true });
      } catch {
        // Helper file is a quality-of-life sidecar.
      }
    }

    const sessionMetadata = {
      ignoreReason: session.config.ignoreReason ?? null,
      categoryConstantName: session.config.categoryConstantName ?? null,
      categoryValue: session.config.categoryValue ?? null,
    };
    if (
      (project.language ?? "csharp") === "csharp" &&
      sessionMetadata.categoryConstantName &&
      sessionMetadata.categoryValue !== null &&
      sessionMetadata.categoryValue !== undefined
    ) {
      try {
        const catPath = await csharpCodegen.upsertCategoryConstant(
          project,
          suiteName,
          sessionMetadata.categoryConstantName,
          sessionMetadata.categoryValue,
        );
        generated.push({ path: catPath, created: true });
      } catch {
        // Best-effort.
      }
    }

    if (target === "testMethod") {
      const ignoreReason = session.config.ignoreReason ?? null;
      void ignoreReason;
      const categoryConstantName =
        session.config.categoryConstantName ?? null;
      const categoryValue = session.config.categoryValue ?? null;
      if (categoryConstantName && categoryValue) {
        try {
          const categoriesPath = await ensureCategoryFile(
            project,
            suiteName,
            categoryConstantName,
            categoryValue,
          );
          if (categoriesPath) {
            generated.push({ path: categoriesPath, created: true });
          }
        } catch {
          // Best-effort sidecar.
        }
      }
      addedMethod = await addTestMethod(
        project,
        targetPath,
        chosenMethodName,
        lines,
        [`${suiteName}Actions`],
        { overwrite, metadata: sessionMetadata, suiteName },
      );
      if (
        session.config.categoryConstantName &&
        session.config.categoryValue
      ) {
        try {
          const categoriesPath = await upsertTestCategoryConstant(
            project,
            suiteName,
            session.config.categoryConstantName,
            session.config.categoryValue,
          );
          if (categoriesPath) {
            generated.push({ path: categoriesPath, created: false });
          }
        } catch {
          // Best-effort surfacing.
        }
      }
      try {
        const persistedName = addedMethod?.methodName ?? chosenMethodName;
        await saveActionSet({
          userId: session.userId,
          projectName: project.solutionName,
          filePath: targetPath,
          kind: "testMethod",
          methodName: persistedName,
          urlName: session.config.urlName,
          startUrl: session.config.startUrl,
          actions: session.actions
            .filter((a) => !a.deleted)
            .map((a) => ({ ...a })),
        });
      } catch {
        // Persistence is a quality-of-life sidecar for Validate.
      }
    } else {
      const hook: HookKind =
        target === "beforeEach" ? "beforeEach" : "oneTimeSetup";
      const replaceResult = await replaceHookBody(
        project,
        targetPath,
        hook,
        lines,
      );
      hookBackupPath = replaceResult.backupPath;
      try {
        await saveHookActions({
          userId: session.userId,
          projectName: project.solutionName,
          filePath: targetPath,
          kind: hook,
          urlName: session.config.urlName,
          startUrl: session.config.startUrl,
          actions: session.actions
            .filter((a) => !a.deleted)
            .map((a) => ({ ...a })),
        });
      } catch {
        // Persistence is a quality-of-life sidecar.
      }
    }
  }

  // Task #120 — keep-browser-open recycles into a pre-attach session.
  const keepBrowserOpen =
    session.config.keepBrowserOpen === true && !!session.browser;
  if (!keepBrowserOpen) {
    await session.browser.close().catch(() => {});
  }

  const className = targetClassName(session.config) ?? "test class";
  let testMethodSummary: string;
  if (addedMethod && overwrite) {
    testMethodSummary = `overwrote existing [Test] ${addedMethod.methodName} in ${className}`;
  } else if (addedMethod && addedMethod.renamed) {
    testMethodSummary =
      `a method named [Test] ${addedMethod.requestedName} already existed in ` +
      `${className}, so the recording was added as [Test] ` +
      `${addedMethod.methodName} instead to keep the project compiling`;
  } else if (addedMethod) {
    testMethodSummary = `added [Test] ${addedMethod.methodName} to ${className}`;
  } else {
    testMethodSummary = `added [Test] ${chosenMethodName} to ${className}`;
  }
  const hookSummarySuffix = hookBackupPath
    ? ` (previous body saved to ${hookBackupPath})`
    : "";
  const targetSummary =
    target === "testMethod"
      ? testMethodSummary
      : `updated ${hookMethodName(target as HookKind)} in ${className}${hookSummarySuffix}`;
  const recordedCount = session.actions.filter((a) => !a.deleted).length;
  const summary = `Recorded ${recordedCount} actions into ${suiteName}; ${targetSummary}; generated ${generated.length} file(s).`;
  broadcast({
    type: "stopped",
    summary,
    generatedFiles: generated,
    hookBackupPath,
  });

  if (keepBrowserOpen) {
    // Recycle the live browser into a fresh open-browser pre-attach
    // session so the next Start Recording dialog reattaches.
    const previousViewport = session.config.viewport;
    const previousUseSavedLogin = session.config.useSavedLogin;

    session.actions = [];
    session.assertionLabelIndex = 0;
    session.waitLabelIndex = 0;
    session.lastEditableSelector = null;
    session.lastEditableStrategy = null;
    session.suppressNextChangeFill = null;
    session.lastRenameByIndex = new Map();
    session.replaying = false;
    session.attached = false;
    session.phase = "recording";
    session.active = true;
    session.sessionToken = randomUUID();
    session.config = {
      startUrl: session.page.url(),
      urlName: "",
      target: "testMethod",
      methodName: "",
      existingTestClassPath: null,
      newTestClassName: null,
      overwriteExistingMethod: false,
      viewport: previousViewport,
      useSavedLogin: previousUseSavedLogin,
      originatedFrom: "open-browser",
      keepBrowserOpen: true,
      attached: false,
      ignoreReason: null,
      categoryConstantName: null,
      categoryValue: null,
    };

    session.stopScreencast = startScreencast(
      () => {
        const s = getSession();
        return s && s.active ? s.page : null;
      },
      (data) => {
        const s = getSession();
        if (!s) return;
        broadcast({
          type: "frame",
          data,
          width: s.viewport.width,
          height: s.viewport.height,
        });
      },
    );

    broadcastFeedReset(session, undefined);

    return {
      status: "completed",
      generatedFiles: generated,
      summary,
      hookBackupPath,
    };
  }

  for (const sock of session.sockets) sock.close();

  setSession(null);
  return {
    status: "completed",
    generatedFiles: generated,
    summary,
    hookBackupPath,
  };
}
