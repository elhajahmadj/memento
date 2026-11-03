// Selectors + Actions + Interface generation for Java suites.
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";
import { writeFile } from "@/features/projects/infrastructure/projectFiles";
import {
  type RecordedAction,
  type SuiteGenerationResult,
  normalizeSelectorForLocator,
} from "@/features/codegen/infrastructure/codegen";
import { toCamel } from "./naming";
import {
  actionsFileRelPath,
  interfaceFileRelPath,
  pkgPath,
  selectorsFileRelPath,
} from "./paths";
import {
  escapeJava,
  existingJavaActionMethodNames,
  existingJavaInterfaceSignatures,
  existingJavaSelectorKeys,
  extractActionsClassMethods,
  javaMethodNameFromAction,
  javaSelectorKeyFromAction,
  readIfExists,
} from "./suiteHelpers";

// Generate / merge the per-suite Selectors + Actions + Interface Java files.
// Selectors and Actions live in the tests module; the page-object interface
// lives in the shared module so other modules can depend on it.
export async function generateSuiteFiles(
  project: Project,
  suiteName: string,
  actions: RecordedAction[],
): Promise<SuiteGenerationResult> {
  const selectorsPath = selectorsFileRelPath(project, suiteName);
  const actionsPath = actionsFileRelPath(project, suiteName);
  const interfacePath = interfaceFileRelPath(project, suiteName);

  const selectorsAbs = safeJoin(project.rootPath, selectorsPath);
  const actionsAbs = safeJoin(project.rootPath, actionsPath);
  const interfaceAbs = safeJoin(project.rootPath, interfacePath);
  const [selRaw, actRaw, ifaceRaw] = await Promise.all([
    readIfExists(selectorsAbs),
    readIfExists(actionsAbs),
    readIfExists(interfaceAbs),
  ]);

  // --- Selectors map (merge with existing) ---------------------------------
  const existingSelectors = selRaw
    ? existingJavaSelectorKeys(selRaw)
    : new Map<string, string>();
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
    let key = javaSelectorKeyFromAction(a, fallbackIndex);
    while (valueByKey.has(key)) {
      fallbackIndex++;
      key = `element${fallbackIndex + 1}`;
    }
    if (key.startsWith("element")) fallbackIndex++;
    valueByKey.set(key, normalized);
    bySelector.set(a.selector, key);
  }

  // --- Method names --------------------------------------------------------
  const existingMethods = actRaw
    ? existingJavaActionMethodNames(actRaw)
    : new Set<string>();
  const methodNames = new Map<RecordedAction, string>();
  const takesValueByMethod = new Map<string, boolean>();
  const newMethods = new Map<
    string,
    { selectorKey: string; verb: string; takesValue: boolean }
  >();

  const isLegalIdent = (s: string): boolean =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
  let methodIndex = 0;
  for (const a of actions) {
    if (a.type === "assert" || a.type === "wait") continue;
    if (!a.selector) continue;
    const key = bySelector.get(a.selector);
    if (!key) continue;
    methodIndex++;
    const customName =
      typeof a.methodName === "string" && isLegalIdent(a.methodName.trim())
        ? toCamel(a.methodName.trim())
        : null;
    const methodName =
      customName ?? javaMethodNameFromAction(a, key, methodIndex);
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
      newMethods.set(methodName, { selectorKey: key, verb, takesValue });
    }
  }

  // --- Selectors file (rewrite) -------------------------------------------
  const pkg = pkgPath(project);
  const sortedEntries = Array.from(valueByKey.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const selectorsLines = sortedEntries
    .map(([k, v]) => `    public static final String ${k} = "${escapeJava(v)}";`)
    .join("\n");
  const selectorsContent = `package ${pkg}.pages.selectors;

/** Selectors for ${suiteName}. */
public final class ${suiteName}Selectors {
    private ${suiteName}Selectors() {}

${selectorsLines}
}
`;

  // --- Actions file (merge) -----------------------------------------------
  const previousClassMethods = actRaw ? extractActionsClassMethods(actRaw) : "";
  const newMethodLines: string[] = [];
  for (const [name, info] of newMethods) {
    const selRef = `${suiteName}Selectors.${info.selectorKey}`;
    if (info.verb === "fill") {
      newMethodLines.push(
        `    @Override\n    public void ${name}(String value) {\n        this.page.fill(${selRef}, value);\n    }`,
      );
    } else if (info.verb === "check") {
      newMethodLines.push(
        `    @Override\n    public void ${name}() {\n        this.page.check(${selRef});\n    }`,
      );
    } else if (info.verb === "select") {
      newMethodLines.push(
        `    @Override\n    public void ${name}(String value) {\n        this.page.selectOption(${selRef}, value);\n    }`,
      );
    } else {
      newMethodLines.push(
        `    @Override\n    public void ${name}() {\n        this.page.click(${selRef});\n    }`,
      );
    }
  }
  const classBody = [previousClassMethods, newMethodLines.join("\n\n")]
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
  const actionsContent = `package ${pkg}.pages.actions;

import com.microsoft.playwright.Page;
import ${pkg}.pages.interfaces.I${suiteName}Actions;
import ${pkg}.pages.selectors.${suiteName}Selectors;

/** Page-object actions for ${suiteName}. */
public class ${suiteName}Actions implements I${suiteName}Actions {
    private final Page page;

    public ${suiteName}Actions(Page page) {
        this.page = page;
    }

${classBody || "    // No actions recorded yet."}
}
`;

  // --- Interface file (merge) ---------------------------------------------
  // Build the merged signature list: any previously-emitted signatures
  // (preserving user edits) plus any newly-recorded methods not yet on disk.
  const existingIfaceSigs = ifaceRaw
    ? existingJavaInterfaceSignatures(ifaceRaw)
    : new Map<string, string>();
  const ifaceSignatures: string[] = [];
  for (const sig of existingIfaceSigs.values()) ifaceSignatures.push(sig);
  for (const [name, info] of newMethods) {
    if (existingIfaceSigs.has(name)) continue;
    const sig = info.takesValue
      ? `void ${name}(String value)`
      : `void ${name}()`;
    ifaceSignatures.push(sig);
  }
  const interfaceBody =
    ifaceSignatures.length > 0
      ? ifaceSignatures.map((s) => `    ${s};`).join("\n")
      : "    // No actions recorded yet.";
  const interfaceContent = `package ${pkg}.pages.interfaces;

/** Page-object contract for ${suiteName}. Implemented by ${suiteName}Actions. */
public interface I${suiteName}Actions {
${interfaceBody}
}
`;

  await writeFile(project, selectorsPath, selectorsContent);
  await writeFile(project, interfacePath, interfaceContent);
  await writeFile(project, actionsPath, actionsContent);

  return {
    selectorsPath,
    interfacePath,
    actionsPath,
    methodNames,
    takesValueByMethod,
  };
}
