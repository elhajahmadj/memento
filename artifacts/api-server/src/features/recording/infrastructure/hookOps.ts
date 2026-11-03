import type { Page } from "playwright";
import type { Project } from "@/features/projects/infrastructure/projectService";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import {
  dedentHookBody,
  type HookKind,
  normalizeSelectorForLocator,
} from "@/features/codegen/infrastructure/codegen";
import {
  checkTestMethodExists,
  isHookDefaultStub,
  readHookBody,
} from "@/features/codegen/infrastructure/codegenAdapter";
import {
  loadHooksForClass,
  type StoredHookActionSet,
} from "@/features/recording/infrastructure/recordedActionStore";

export async function checkHookDefault(
  filePath: string,
  hook: HookKind,
  project?: Project | null,
): Promise<boolean> {
  const p = project ?? getCurrentProject();
  if (!p) throw new Error("No project loaded");
  return isHookDefaultStub(p, filePath, hook);
}

export interface HookStateResult {
  isDefault: boolean;
  body?: string;
}

export async function getHookState(
  filePath: string,
  hook: HookKind,
  project?: Project | null,
): Promise<HookStateResult> {
  const p = project ?? getCurrentProject();
  if (!p) throw new Error("No project loaded");
  const raw = await readHookBody(p, filePath, hook);
  if (raw === null) return { isDefault: true };
  const isDefault = await isHookDefaultStub(p, filePath, hook).catch(() => false);
  if (isDefault) return { isDefault: true };
  return { isDefault: false, body: dedentHookBody(raw) };
}

export async function checkMethodNameCollision(
  filePath: string,
  methodName: string,
  project?: Project | null,
): Promise<{ exists: boolean; suggestedName: string }> {
  const p = project ?? getCurrentProject();
  if (!p) throw new Error("No project loaded");
  return checkTestMethodExists(p, filePath, methodName);
}

/**
 * Drive the page through a stored hook's recorded actions so the
 * post-setup browser state is restored before user-driven recording.
 */
export async function replayStoredHook(
  page: Page,
  set: StoredHookActionSet,
): Promise<void> {
  await page.goto(set.startUrl);
  for (const a of set.actions) {
    if (a.deleted) continue;
    if (a.type === "navigate") continue;
    if (!a.selector) continue;
    const locator = page
      .locator(normalizeSelectorForLocator(a.selector, a.selectorStrategy))
      .first();
    switch (a.type) {
      case "click":
        await locator.click();
        break;
      case "fill":
        await locator.fill(a.value ?? "");
        break;
      case "select":
        await locator.selectOption(a.value ?? "");
        break;
      case "check":
        await locator.check();
        break;
    }
  }
}

export interface ReplayableHookInfo {
  hasCustomBody: boolean;
  hasStoredActions: boolean;
}

export interface ReplayableHooksResult {
  beforeEach: ReplayableHookInfo;
  oneTimeSetup: ReplayableHookInfo;
}

export async function getReplayableHooks(
  filePath: string,
  userId: string,
  project?: Project | null,
): Promise<ReplayableHooksResult> {
  const p = project ?? getCurrentProject();
  if (!p) throw new Error("No project loaded");
  if (!userId) throw new Error("Authentication required");
  const stored = await loadHooksForClass({
    userId,
    projectName: p.solutionName,
    filePath,
  });
  const result: ReplayableHooksResult = {
    beforeEach: { hasCustomBody: false, hasStoredActions: false },
    oneTimeSetup: { hasCustomBody: false, hasStoredActions: false },
  };
  for (const hook of ["beforeEach", "oneTimeSetup"] as const) {
    const isDefault = await isHookDefaultStub(p, filePath, hook).catch(
      () => true,
    );
    result[hook].hasCustomBody = !isDefault;
    result[hook].hasStoredActions = !!stored[hook];
  }
  return result;
}
