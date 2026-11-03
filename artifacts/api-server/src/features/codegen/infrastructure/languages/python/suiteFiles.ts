/**
 * Generate / merge the per-suite Selectors + Actions Python files.
 * Mirrors `codegen.generateSuiteFiles` but emits Python: there is no
 * separate Interface file because Python relies on duck typing — we set
 * `interfacePath` to the actions path so the legacy result shape stays
 * stable and downstream code (logging, tests) keeps compiling.
 */
import fs from "node:fs/promises";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import { writeFile } from "@/features/projects/infrastructure/projectFiles";
import {
  type RecordedAction,
  type SuiteGenerationResult,
  normalizeSelectorForLocator,
} from "@/features/codegen/infrastructure/codegen";
import {
  actionsFileRelPath,
  escapePy,
  selectorsFileRelPath,
  toSnake,
} from "./naming";
import {
  ELEMENT_FIELD_SUFFIX_PY,
  SELECTOR_KEY_SUFFIX_PY,
  disambiguateMethodNamePython,
  isNewStyleSelectorKeyPython,
  nounFromSelectorKeyPython,
  pythonMethodNameFromAction,
  pythonSelectorKeyFromAction,
} from "./methodNaming";

/**
 * Pull existing `KEY = "value"` constants from a previously-generated
 * `<suite>_selectors.py` file. Used to merge new locators with existing
 * ones across multiple recordings into the same suite.
 */
function existingPySelectorKeys(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.set(m[1]!, m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return out;
}

/** Pull existing `def name(` method names from an actions file. */
function existingPyActionMethodNames(content: string): Set<string> {
  const out = new Set<string>();
  const re = /^\s*def\s+([a-z_][\w]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1] !== "__init__") out.add(m[1]!);
  }
  return out;
}

async function readIfExists(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Read the names of `def <name>(` methods declared on the actions class
 * for `suiteName`.
 */
export async function readSuiteActionsMethodNames(
  project: Project,
  suiteName: string,
): Promise<Set<string>> {
  const rel = actionsFileRelPath(suiteName);
  const raw = await readIfExists(safeJoin(project.rootPath, rel));
  if (!raw) return new Set();
  return existingPyActionMethodNames(raw);
}

/**
 * Read the on-disk Selectors file for a Python suite (if any) and return
 * its `KeyName -> selectorValue` map.
 */
export async function readSuiteExistingSelectorsPython(
  project: Project,
  suiteName: string,
): Promise<Map<string, string>> {
  const rel = selectorsFileRelPath(suiteName);
  const raw = await readIfExists(safeJoin(project.rootPath, rel));
  if (!raw) return new Map();
  return existingPySelectorKeys(raw);
}

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

  // --- Selectors map (merge with existing) ---------------------------------
  const existingSelectors = selRaw ? existingPySelectorKeys(selRaw) : new Map();
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
    let key = pythonSelectorKeyFromAction(a, fallbackIndex);
    while (valueByKey.has(key)) {
      fallbackIndex++;
      key = `ELEMENT_${fallbackIndex + 1}${SELECTOR_KEY_SUFFIX_PY}`;
    }
    if (nounFromSelectorKeyPython(key).startsWith("element_")) fallbackIndex++;
    valueByKey.set(key, normalized);
    bySelector.set(a.selector, key);
  }

  // --- Method names --------------------------------------------------------
  const existingMethods = actRaw ? existingPyActionMethodNames(actRaw) : new Set<string>();
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
    const candidate = pythonMethodNameFromAction(a, key, methodIndex);
    const methodName = disambiguateMethodNamePython(candidate, usedMethodNames);
    usedMethodNames.add(methodName);

    const useFieldStyle = isNewStyleSelectorKeyPython(key);
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

  // --- Selectors file (rewrite) -------------------------------------------
  const sortedEntries = Array.from(valueByKey.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const selectorsLines = sortedEntries
    .map(([k, v]) => `    ${k} = "${escapePy(v)}"`)
    .join("\n");
  const selectorsContent =
    `"""Selectors for ${suiteName}."""


class ${suiteName}Selectors:
${selectorsLines || "    pass"}
`;

  // --- Actions file (merge) -----------------------------------------------
  const elementNouns: string[] = [];
  for (const [k] of sortedEntries) {
    if (isNewStyleSelectorKeyPython(k)) {
      elementNouns.push(nounFromSelectorKeyPython(k));
    }
  }
  const fieldInitLines = elementNouns
    .map(
      (n) =>
        `        self.${n}${ELEMENT_FIELD_SUFFIX_PY} = page.locator(${suiteName}Selectors.${n.toUpperCase()}${SELECTOR_KEY_SUFFIX_PY})`,
    )
    .join("\n");

  const previousClassMethods = actRaw ? extractActionsClassMethods(actRaw) : "";
  const newMethodLines: string[] = [];
  for (const [name, info] of newMethods) {
    const selRef = `${suiteName}Selectors.${info.selectorKey}`;
    const noun = nounFromSelectorKeyPython(info.selectorKey);
    const elementField = `self.${noun}${ELEMENT_FIELD_SUFFIX_PY}`;
    if (info.verb === "fill") {
      const body = info.useFieldStyle
        ? `${elementField}.fill(value)`
        : `self._page.fill(${selRef}, value)`;
      newMethodLines.push(
        `    def ${name}(self, value: str) -> None:\n        ${body}`,
      );
    } else if (info.verb === "check") {
      const body = info.useFieldStyle
        ? `${elementField}.check()`
        : `self._page.check(${selRef})`;
      newMethodLines.push(
        `    def ${name}(self) -> None:\n        ${body}`,
      );
    } else if (info.verb === "select") {
      const body = info.useFieldStyle
        ? `${elementField}.select_option(value)`
        : `self._page.select_option(${selRef}, value)`;
      newMethodLines.push(
        `    def ${name}(self, value: str) -> None:\n        ${body}`,
      );
    } else {
      const body = info.useFieldStyle
        ? `${elementField}.click()`
        : `self._page.click(${selRef})`;
      newMethodLines.push(
        `    def ${name}(self) -> None:\n        ${body}`,
      );
    }
  }
  const classBody = [previousClassMethods, newMethodLines.join("\n\n")]
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
  const initBody = fieldInitLines
    ? `        self._page = page\n${fieldInitLines}`
    : `        self._page = page`;
  const actionsContent =
    `"""Actions for ${suiteName}."""
from playwright.sync_api import Page

from pages.selectors.${toSnake(suiteName)}_selectors import ${suiteName}Selectors


class ${suiteName}Actions:
    def __init__(self, page: Page) -> None:
${initBody}

${classBody || "    pass"}
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
 * Mirrors the C# helper but uses Python indentation: everything after the
 * `def __init__` block at indent ≥ 4 spaces, dedented back to a single
 * blank line between methods.
 */
function extractActionsClassMethods(content: string): string {
  const lines = content.split(/\r?\n/);
  let initIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*def\s+__init__\s*\(/.test(lines[i]!)) {
      initIdx = i;
      break;
    }
  }
  if (initIdx === -1) return "";
  let cursor = initIdx + 1;
  while (
    cursor < lines.length &&
    (lines[cursor]!.trim() === "" || lines[cursor]!.startsWith("        "))
  ) {
    cursor++;
  }
  const body: string[] = [];
  for (let i = cursor; i < lines.length; i++) {
    const ln = lines[i]!;
    if (ln.trim() === "") {
      body.push(ln);
      continue;
    }
    if (!ln.startsWith("    ")) break;
    body.push(ln);
  }
  while (body.length && body[0]!.trim() === "") body.shift();
  while (body.length && body[body.length - 1]!.trim() === "") body.pop();
  return body.join("\n");
}
