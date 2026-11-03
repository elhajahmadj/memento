import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";
import { SELECTOR_KEY_SUFFIX_NODE, tsQuotedArg } from "./naming";
import { readIfExists, selectorsFileRelPath } from "./paths";
import {
  disambiguateMethodNameNodejs,
  existingTsSelectorKeys,
  nodejsMethodNameFromAction,
  nodejsSelectorKeyFromAction,
  normalizeNounForNodejs,
  nounFromSelectorKeyNodejs,
} from "./nouns";
import {
  renderApiAssertionLineNodejs,
  renderAssertionLineNodejs,
  renderRouteMockLineNodejs,
  renderWaitLineNodejs,
} from "./renderLines";

export async function readSuiteExistingSelectorsNodejs(
  project: Project,
  suiteName: string,
): Promise<Map<string, string>> {
  const rel = selectorsFileRelPath(suiteName);
  const raw = await readIfExists(safeJoin(project.rootPath, rel));
  if (!raw) return new Map();
  return existingTsSelectorKeys(raw);
}

export function computeMethodNamesForActionsNodejs(
  actions: RecordedAction[],
  existingSelectors: Map<string, string> = new Map(),
): Map<RecordedAction, string> {
  const bySelector = new Map<string, string>();
  const valueByKey = new Map<string, string>(existingSelectors);
  let fallbackIndex = 0;
  for (const a of actions) {
    if (a.deleted) continue;
    if (a.type === "assert" || a.type === "wait") continue;
    if (!a.selector || bySelector.has(a.selector)) continue;
    let reused = false;
    for (const [k, v] of valueByKey) {
      if (v === a.selector) {
        bySelector.set(a.selector, k);
        reused = true;
        break;
      }
    }
    if (reused) continue;
    let key = nodejsSelectorKeyFromAction(a, fallbackIndex);
    while (valueByKey.has(key)) {
      fallbackIndex++;
      key = `element${fallbackIndex + 1}${SELECTOR_KEY_SUFFIX_NODE}`;
    }
    if (nounFromSelectorKeyNodejs(key).startsWith("element")) fallbackIndex++;
    valueByKey.set(key, a.selector);
    bySelector.set(a.selector, key);
  }

  const out = new Map<RecordedAction, string>();
  const used = new Set<string>();
  let methodIndex = 0;
  for (const a of actions) {
    if (a.deleted) continue;
    if (a.type === "assert" || a.type === "wait") continue;
    if (!a.selector) continue;
    const key = bySelector.get(a.selector);
    if (!key) continue;
    methodIndex++;
    const candidate = nodejsMethodNameFromAction(a, key, methodIndex);
    const finalName = disambiguateMethodNameNodejs(candidate, used);
    used.add(finalName);
    out.set(a, finalName);
  }
  return out;
}

export function suggestedMethodNameForLastActionNodejs(
  actions: RecordedAction[],
): string | null {
  const last = actions[actions.length - 1];
  if (!last || !last.selector) return null;
  const map = computeMethodNamesForActionsNodejs(actions);
  return map.get(last) ?? null;
}

export function suggestedActionNounForLastActionNodejs(
  actions: RecordedAction[],
): string | null {
  const last = actions[actions.length - 1];
  if (!last || !last.selector) return null;
  if (typeof last.methodName === "string") {
    const n = normalizeNounForNodejs(last.methodName);
    if (n && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return n;
  }
  const bySelector = new Map<string, string>();
  const valueByKey = new Map<string, string>();
  let fallbackIndex = 0;
  let lastKey: string | null = null;
  for (const a of actions) {
    if (!a.selector) continue;
    if (!bySelector.has(a.selector)) {
      let reused = false;
      for (const [k, v] of valueByKey) {
        if (v === a.selector) {
          bySelector.set(a.selector, k);
          reused = true;
          break;
        }
      }
      if (!reused) {
        let key = nodejsSelectorKeyFromAction(a, fallbackIndex);
        while (valueByKey.has(key)) {
          fallbackIndex++;
          key = `element${fallbackIndex + 1}${SELECTOR_KEY_SUFFIX_NODE}`;
        }
        if (nounFromSelectorKeyNodejs(key).startsWith("element"))
          fallbackIndex++;
        valueByKey.set(key, a.selector);
        bySelector.set(a.selector, key);
      }
    }
    if (a === last) lastKey = bySelector.get(a.selector) ?? null;
  }
  if (!lastKey) return null;
  return nounFromSelectorKeyNodejs(lastKey);
}

export function deriveConstantNameNodejs(methodName: string): string | null {
  const m = methodName.match(/^fill([A-Z][A-Za-z0-9]*?)(\d+)?$/);
  if (!m) return null;
  const base = m[1] ?? "";
  if (!base) return null;
  return base;
}

export function buildFillConstantsNodejs(
  actions: RecordedAction[],
  methodNames: Map<RecordedAction, string>,
  existing: Map<string, string> = new Map(),
): { byMethod: Map<string, string>; byName: Map<string, string> } {
  const byMethod = new Map<string, string>();
  const byName = new Map<string, string>(existing);
  for (const a of actions) {
    if (a.deleted) continue;
    if (a.type !== "fill") continue;
    const value = a.value ?? "";
    if (!value) continue;
    const methodName = methodNames.get(a);
    if (!methodName) continue;
    if (byMethod.has(methodName)) continue;
    const base = deriveConstantNameNodejs(methodName);
    if (!base) continue;
    let chosen = base;
    let n = 2;
    while (byName.has(chosen) && byName.get(chosen) !== value) {
      chosen = `${base}_${n++}`;
    }
    byName.set(chosen, value);
    byMethod.set(methodName, chosen);
  }
  return { byMethod, byName };
}

export function computeTestBodyPreviewNodejs(
  suiteName: string,
  urlName: string,
  actions: RecordedAction[],
  existingSelectors: Map<string, string> = new Map(),
): { lines: string[]; lineActionIndices: Array<number | null> } {
  const headerInstantiation = `const actions = new ${suiteName}Actions(page);`;
  const headerGoto = `await page.goto(config.urls.${urlName});`;
  const lines: string[] = [headerInstantiation];
  const lineActionIndices: Array<number | null> = [null];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    if (a.deleted) continue;
    if (a.type !== "routeMock") continue;
    const line = renderRouteMockLineNodejs(a);
    if (line) {
      lines.push(line);
      lineActionIndices.push(i);
    }
  }
  lines.push(headerGoto);
  lineActionIndices.push(null);
  const liveActions: Array<{ action: RecordedAction; sessionIndex: number }> =
    [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    if (a.deleted) continue;
    liveActions.push({ action: a, sessionIndex: i });
  }
  const methodNames = computeMethodNamesForActionsNodejs(
    liveActions.map((x) => x.action),
    existingSelectors,
  );
  const constants = buildFillConstantsNodejs(
    liveActions.map((x) => x.action),
    methodNames,
  );
  for (const { action: a, sessionIndex } of liveActions) {
    if (a.type === "navigate") continue;
    if (a.type === "assert") {
      const line = renderAssertionLineNodejs(a);
      if (line) {
        lines.push(line);
        lineActionIndices.push(sessionIndex);
      }
      continue;
    }
    if (a.type === "routeMock") {
      continue;
    }
    if (a.type === "apiAssertion") {
      const line = renderApiAssertionLineNodejs(a);
      if (line) {
        lines.push(line);
        lineActionIndices.push(sessionIndex);
      }
      continue;
    }
    if (a.type === "wait") {
      const line = renderWaitLineNodejs(a);
      if (line) {
        lines.push(line);
        lineActionIndices.push(sessionIndex);
      }
      continue;
    }
    if (!a.selector) continue;
    const methodName = methodNames.get(a);
    if (!methodName) continue;
    const takesValue = a.type === "fill" || a.type === "select";
    let arg = "";
    if (takesValue) {
      const constName = constants.byMethod.get(methodName);
      arg =
        a.type === "fill" && constName
          ? `Constants.${constName}`
          : tsQuotedArg(a.value ?? "");
    }
    lines.push(`await actions.${methodName}(${arg});`);
    lineActionIndices.push(sessionIndex);
  }
  return { lines, lineActionIndices };
}
