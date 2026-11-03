import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import { writeFile } from "@/features/projects/infrastructure/projectFiles";
import {
  type RecordedAction,
  type SuiteGenerationResult,
  normalizeSelectorForLocator,
} from "@/features/codegen/infrastructure/codegen";
import {
  ELEMENT_FIELD_SUFFIX_NODE,
  SELECTOR_KEY_SUFFIX_NODE,
  escapeTs,
} from "./naming";
import {
  actionsFileRelPath,
  readIfExists,
  selectorsFileRelPath,
} from "./paths";
import {
  disambiguateMethodNameNodejs,
  existingTsActionMethodNames,
  existingTsSelectorKeys,
  isNewStyleSelectorKeyNodejs,
  nodejsMethodNameFromAction,
  nodejsSelectorKeyFromAction,
  nounFromSelectorKeyNodejs,
} from "./nouns";

/**
 * Read the names of methods declared on the actions class for `suiteName`.
 */
export async function readSuiteActionsMethodNames(
  project: Project,
  suiteName: string,
): Promise<Set<string>> {
  const rel = actionsFileRelPath(suiteName);
  const raw = await readIfExists(safeJoin(project.rootPath, rel));
  if (!raw) return new Set();
  return existingTsActionMethodNames(raw);
}

export function suggestNonCollidingName(
  desired: string,
  used: Set<string>,
): string {
  if (!used.has(desired)) return desired;
  let suffix = 2;
  while (used.has(`${desired}${suffix}`)) suffix++;
  return `${desired}${suffix}`;
}

/**
 * Generate / merge the per-suite Selectors + Actions Node.js files.
 */
export async function generateSuiteFiles(
  project: Project,
  suiteName: string,
  actions: RecordedAction[],
): Promise<SuiteGenerationResult> {
  const selectorsPath = selectorsFileRelPath(suiteName);
  const actionsPath = actionsFileRelPath(suiteName);

  const selectorsAbs = safeJoin(project.rootPath, selectorsPath);
  const actionsAbs = safeJoin(project.rootPath, actionsPath);
  const [selRaw, actRaw] = await Promise.all([
    readIfExists(selectorsAbs),
    readIfExists(actionsAbs),
  ]);

  const existingSelectors = selRaw ? existingTsSelectorKeys(selRaw) : new Map();
  const bySelector = new Map<string, string>();
  const valueByKey = new Map<string, string>(existingSelectors);
  let fallbackIndex = 0;
  for (const a of actions) {
    if (a.type === "assert" || a.type === "wait") continue;
    if (!a.selector || bySelector.has(a.selector)) continue;
    const normalized = normalizeSelectorForLocator(
      a.selector,
      a.selectorStrategy,
    );
    let reused = false;
    for (const [k, v] of valueByKey) {
      if (v === normalized) {
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
    valueByKey.set(key, normalized);
    bySelector.set(a.selector, key);
  }

  const existingMethods = actRaw
    ? existingTsActionMethodNames(actRaw)
    : new Set<string>();
  const usedMethodNames = new Set<string>(existingMethods);
  const methodNames = new Map<RecordedAction, string>();
  const takesValueByMethod = new Map<string, boolean>();
  const newMethods = new Map<
    string,
    { selectorKey: string; verb: string; takesValue: boolean; useFieldStyle: boolean }
  >();

  let methodIndex = 0;
  for (const a of actions) {
    if (a.type === "assert" || a.type === "wait") continue;
    if (!a.selector) continue;
    const key = bySelector.get(a.selector);
    if (!key) continue;
    methodIndex++;
    const candidate = nodejsMethodNameFromAction(a, key, methodIndex);
    const methodName = disambiguateMethodNameNodejs(candidate, usedMethodNames);
    usedMethodNames.add(methodName);

    const useFieldStyle = isNewStyleSelectorKeyNodejs(key);
    let verb: string;
    let takesValue = false;
    if (a.type === "fill") {
      verb = "fill";
      takesValue = true;
    } else if (a.type === "check") {
      verb = "check";
    } else if (a.type === "select") {
      verb = "select";
      takesValue = true;
    } else {
      verb = "click";
    }
    methodNames.set(a, methodName);
    takesValueByMethod.set(methodName, takesValue);
    if (!existingMethods.has(methodName) && !newMethods.has(methodName)) {
      newMethods.set(methodName, { selectorKey: key, verb, takesValue, useFieldStyle });
    }
  }

  const sortedEntries = Array.from(valueByKey.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const selectorsLines = sortedEntries
    .map(([k, v]) => `  ${k}: "${escapeTs(v)}",`)
    .join("\n");
  const selectorsContent =
    `/** Selectors for ${suiteName}. */
export const ${suiteName}Selectors = {
${selectorsLines}
} as const;
`;

  const elementNouns: string[] = [];
  for (const [k] of sortedEntries) {
    if (isNewStyleSelectorKeyNodejs(k)) {
      elementNouns.push(nounFromSelectorKeyNodejs(k));
    }
  }
  const fieldDeclLines = elementNouns
    .map((n) => `  private readonly ${n}${ELEMENT_FIELD_SUFFIX_NODE}: Locator;`)
    .join("\n");
  const fieldInitLines = elementNouns
    .map(
      (n) =>
        `    this.${n}${ELEMENT_FIELD_SUFFIX_NODE} = page.locator(${suiteName}Selectors.${n}${SELECTOR_KEY_SUFFIX_NODE});`,
    )
    .join("\n");
  const previousClassMethods = actRaw ? extractActionsClassMethods(actRaw) : "";
  const newMethodLines: string[] = [];
  for (const [name, info] of newMethods) {
    const selRef = `${suiteName}Selectors.${info.selectorKey}`;
    const noun = nounFromSelectorKeyNodejs(info.selectorKey);
    const elementField = `this.${noun}${ELEMENT_FIELD_SUFFIX_NODE}`;
    if (info.verb === "fill") {
      const body = info.useFieldStyle
        ? `await ${elementField}.fill(value);`
        : `await this.page.fill(${selRef}, value);`;
      newMethodLines.push(
        `  async ${name}(value: string): Promise<void> {\n    ${body}\n  }`,
      );
    } else if (info.verb === "check") {
      const body = info.useFieldStyle
        ? `await ${elementField}.check();`
        : `await this.page.check(${selRef});`;
      newMethodLines.push(
        `  async ${name}(): Promise<void> {\n    ${body}\n  }`,
      );
    } else if (info.verb === "select") {
      const body = info.useFieldStyle
        ? `await ${elementField}.selectOption(value);`
        : `await this.page.selectOption(${selRef}, value);`;
      newMethodLines.push(
        `  async ${name}(value: string): Promise<void> {\n    ${body}\n  }`,
      );
    } else {
      const body = info.useFieldStyle
        ? `await ${elementField}.click();`
        : `await this.page.click(${selRef});`;
      newMethodLines.push(
        `  async ${name}(): Promise<void> {\n    ${body}\n  }`,
      );
    }
  }
  const classBody = [previousClassMethods, newMethodLines.join("\n\n")]
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
  const fieldDeclSection = fieldDeclLines ? `\n${fieldDeclLines}\n` : "";
  const ctorBody = fieldInitLines
    ? `\n${fieldInitLines}\n  `
    : "";
  const actionsContent =
    `import type { Locator, Page } from "@playwright/test";
import { ${suiteName}Selectors } from "../selectors/${suiteName}Selectors";

/** Page-object actions for ${suiteName}. */
export class ${suiteName}Actions {
  private readonly page: Page;${fieldDeclSection}
  constructor(page: Page) {
    this.page = page;${ctorBody}}

${classBody || "  // No actions recorded yet."}
}
`;

  await writeFile(project, selectorsPath, selectorsContent);
  await writeFile(project, actionsPath, actionsContent);

  return {
    selectorsPath,
    interfacePath: actionsPath,
    actionsPath,
    methodNames,
    takesValueByMethod,
  };
}

/**
 * Extract the body of methods inside a previously-generated Actions class.
 */
function extractActionsClassMethods(content: string): string {
  const lines = content.split(/\r?\n/);
  let ctorIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*constructor\s*\(/.test(lines[i]!)) {
      ctorIdx = i;
      break;
    }
  }
  if (ctorIdx === -1) return "";
  let depth = 0;
  let cursor = ctorIdx;
  let ctorClosed = false;
  for (; cursor < lines.length; cursor++) {
    const ln = lines[cursor]!;
    for (const ch of ln) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          ctorClosed = true;
          break;
        }
      }
    }
    if (ctorClosed) {
      cursor++;
      break;
    }
  }
  if (!ctorClosed) return "";
  while (cursor < lines.length && lines[cursor]!.trim() === "") cursor++;
  const body: string[] = [];
  for (let i = cursor; i < lines.length; i++) {
    const ln = lines[i]!;
    if (/^\}\s*$/.test(ln)) break;
    body.push(ln);
  }
  while (body.length && body[0]!.trim() === "") body.shift();
  while (body.length && body[body.length - 1]!.trim() === "") body.pop();
  return body.join("\n");
}
