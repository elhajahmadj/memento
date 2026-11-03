import * as csharpCodegen from "@/features/codegen/infrastructure/codegen";
import { targetClassName } from "@/features/recording/domain/naming";
import type {
  CurrentSessionInfo,
  RecordingStatus,
  Session,
  StoppedSessionSnapshot,
} from "@/features/recording/domain/sessionTypes";
import {
  fireSessionDiscarded,
  getSession,
  setSession,
  tearDownCurrentSession,
} from "@/features/recording/infrastructure/sessionState";
import { releaseAllPrewarmedBrowsers } from "@/features/recording/infrastructure/prewarmPool";

export function getStatus(): RecordingStatus {
  const session = getSession();
  if (!session)
    return {
      active: false,
      phase: "idle",
      startUrl: null,
      methodName: null,
      target: null,
      targetClass: null,
    };
  return {
    active: session.active,
    phase: session.phase,
    startUrl: session.config.startUrl,
    methodName: session.config.methodName || null,
    target: session.config.target,
    targetClass: targetClassName(session.config),
    keepBrowserOpen: session.config.keepBrowserOpen === true,
  };
}

export function getCurrentSessionInfoForUser(
  userId: string,
): CurrentSessionInfo | null {
  const session = getSession();
  if (!session) return null;
  if (session.userId !== userId) return null;
  return {
    sessionToken: session.sessionToken,
    userId: session.userId,
    projectName: session.project?.solutionName ?? null,
    filePath: session.config.existingTestClassPath ?? null,
    phase: session.phase,
  };
}

export function getCurrentSessionMetadata(): {
  ignoreReason: string | null;
  categoryConstantName: string | null;
  categoryValue: string | null;
} | null {
  const session = getSession();
  if (!session) return null;
  return {
    ignoreReason: session.config.ignoreReason ?? null,
    categoryConstantName: session.config.categoryConstantName ?? null,
    categoryValue: session.config.categoryValue ?? null,
  };
}

export function getCurrentSessionOwner(): {
  userId: string;
  projectName: string | null;
} | null {
  const session = getSession();
  if (!session) return null;
  return {
    userId: session.userId,
    projectName: session.project?.solutionName ?? null,
  };
}

/**
 * Resolve the project-relative target path for the active session,
 * matching what `finalize()` would write to.
 */
export function resolveSessionFilePath(s: Session): string {
  if (s.config.existingTestClassPath) return s.config.existingTestClassPath;
  if (s.config.newTestClassName) {
    const language = s.project.language ?? "csharp";
    const stem =
      language === "csharp"
        ? csharpCodegen.normalizeCsharpTestSuiteClassName(
            s.config.newTestClassName,
          )
        : s.config.newTestClassName;
    return `${s.project.testProjectName}/Tests/${stem}.cs`;
  }
  return "";
}

/**
 * Return a snapshot of the current STOPPED recording session, only if
 * it belongs to `userId`.
 */
export function getStoppedSessionForUser(
  userId: string,
): StoppedSessionSnapshot | null {
  const session = getSession();
  if (!session) return null;
  if (session.userId !== userId) return null;
  if (session.phase !== "stopped") return null;
  const filePath = resolveSessionFilePath(session);
  if (!filePath) return null;
  return {
    sessionToken: session.sessionToken,
    userId: session.userId,
    projectName: session.project.solutionName,
    filePath,
    kind: session.config.target,
    methodName:
      session.config.target === "testMethod"
        ? session.config.methodName || null
        : null,
    urlName: session.config.urlName,
    startUrl: session.config.startUrl,
    actions: session.actions
      .filter((a) => !a.deleted)
      .map((a) => ({ ...a })),
    phase: "stopped",
  };
}

export async function shutdown(): Promise<void> {
  await releaseAllPrewarmedBrowsers();
  const session = getSession();
  if (session) {
    const token = session.sessionToken;
    const projectName = session.project.solutionName;
    session.active = false;
    session.stopScreencast?.();
    await session.browser.close().catch(() => {});
    setSession(null);
    await fireSessionDiscarded(token, projectName);
  }
}

/**
 * Discard the in-memory session belonging to `userId`. Returns true if
 * a session was actually cleared. Idempotent.
 */
export async function discardSession(userId: string): Promise<boolean> {
  const session = getSession();
  if (!session) return false;
  if (session.userId !== userId) return false;
  return await tearDownCurrentSession();
}

/**
 * Admin-only escape hatch: discards regardless of ownership.
 */
export async function forceDiscardSession(): Promise<{
  discarded: boolean;
  ownerUserId: string | null;
  projectName: string | null;
}> {
  const session = getSession();
  if (!session) {
    return { discarded: false, ownerUserId: null, projectName: null };
  }
  const ownerUserId = session.userId;
  const projectName = session.project.solutionName;
  await tearDownCurrentSession();
  return { discarded: true, ownerUserId, projectName };
}
