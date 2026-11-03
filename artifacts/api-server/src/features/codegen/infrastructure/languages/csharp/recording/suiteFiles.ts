/**
 * Per-suite Selectors / I{Suite}Actions / {Suite}Actions emitter — the
 * trio of files the recorder writes at stop-time. Merges with anything
 * already on disk so a re-record never gratuitously rewrites unchanged
 * sections.
 */
import type { Project } from "@/features/projects/domain/types";
import { writeFile } from "@/features/projects/infrastructure/projectFiles";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type {
  RecordedAction,
  SuiteGenerationResult,
} from "@/features/codegen/domain/types";
import {
  escapeCs,
  existingClassSignatures,
  existingInterfaceSignatures,
  existingSelectorKeys,
  extractActionsClassMethods,
  readIfExists,
} from "./identifiers";
import {
  ELEMENT_FIELD_SUFFIX,
  SELECTOR_KEY_SUFFIX,
  disambiguateMethodName,
  isNewStyleSelectorKey,
  methodNameFromAction,
  normalizeSelectorForLocator,
  nounFromSelectorKey,
  selectorKeyFromAction,
} from "./naming";

/**
 * Read the on-disk Selectors file for a suite (if any) and return its
 * `KeyName -> selectorValue` map. Returns an empty map when the file is
 * absent. Used by the recorder to merge existing selectors into the live
 * preview so dedup suffixes line up with what would actually be written.
 */
export async function readSuiteExistingSelectors(
  project: Project,
  suiteName: string,
): Promise<Map<string, string>> {
  const selectorsPath = `${project.testProjectName}/PageObjects/Selectors/${suiteName}Selectors.cs`;
  const abs = safeJoin(project.rootPath, selectorsPath);
  const raw = await readIfExists(abs);
  if (!raw) return new Map();
  return existingSelectorKeys(raw);
}

/**
 * Read the suite's Actions class file (if any) and return the set of method
 * names already defined on it. Used by the recorder's `name-action` handler
 * to reject custom names that would collide with existing methods on the
 * same suite.
 */
export async function readSuiteActionsMethodNames(
  project: Project,
  suiteName: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  const actionsPath = `${project.testProjectName}/PageObjects/Actions/${suiteName}Actions.cs`;
  const abs = safeJoin(project.rootPath, actionsPath);
  const raw = await readIfExists(abs);
  if (!raw) return out;
  for (const sig of existingClassSignatures(raw)) {
    const m = sig.match(/^(\w+)\s*\(/);
    if (m) out.add(m[1]!);
  }
  return out;
}

/**
 * Generate the per-test-suite trio:
 *   PageObjects/Selectors/{Suite}Selectors.cs
 *   PageObjects/Actions/I{Suite}Actions.cs
 *   PageObjects/Actions/{Suite}Actions.cs
 *
 * All locators across every recorded page are collapsed into the single
 * Selectors class, and every interaction becomes a method on the Actions
 * class. If the files already exist (e.g. another test in the same suite
 * was recorded earlier), entries are merged: existing selector keys and
 * method signatures are preserved, new ones are appended.
 */
export async function generateSuiteFiles(
  project: Project,
  suiteName: string,
  actions: RecordedAction[],
): Promise<SuiteGenerationResult> {
  const selectorsPath = `${project.testProjectName}/PageObjects/Selectors/${suiteName}Selectors.cs`;
  const interfacePath = `${project.testProjectName}/PageObjects/Interfaces/I${suiteName}Actions.cs`;
  const actionsPath = `${project.testProjectName}/PageObjects/Actions/${suiteName}Actions.cs`;

  // Read existing files (if any) to merge with new content.
  const selectorsAbs = safeJoin(project.rootPath, selectorsPath);
  const interfaceAbs = safeJoin(project.rootPath, interfacePath);
  const actionsAbs = safeJoin(project.rootPath, actionsPath);
  const [selRaw, ifaceRaw, actRaw] = await Promise.all([
    readIfExists(selectorsAbs),
    readIfExists(interfaceAbs),
    readIfExists(actionsAbs),
  ]);

  // --- Selectors map ---------------------------------------------------
  const existingSelectors = selRaw ? existingSelectorKeys(selRaw) : new Map();
  // bySelector maps the recorded selector string -> chosen key in the class.
  const bySelector = new Map<string, string>();
  // Reverse lookup: which selector value already lives under each key.
  // We seed with whatever was already on disk so legacy `${Noun}` keys
  // (no `Selector` suffix) survive a re-record unchanged — backward
  // compat with recordings produced before the C# verb-noun-Async
  // convention shipped.
  const valueByKey = new Map<string, string>(existingSelectors);
  let fallbackIndex = 0;
  for (const a of actions) {
    if (a.type === "assert") continue;
    if (!a.selector || bySelector.has(a.selector)) continue;
    const normalized = normalizeSelectorForLocator(
      a.selector,
      a.selectorStrategy,
    );
    // Reuse an existing key whose stored value matches this selector.
    // Compare on the Playwright-ready (normalized) form so a freshly
    // recorded bare-XPath action matches a previously persisted
    // `xpath=...` constant on disk.
    let reused = false;
    for (const [k, v] of valueByKey) {
      if (v === normalized) {
        bySelector.set(a.selector, k);
        reused = true;
        break;
      }
    }
    if (reused) continue;
    let key = selectorKeyFromAction(a, fallbackIndex);
    while (valueByKey.has(key)) {
      fallbackIndex++;
      key = `Element${fallbackIndex + 1}${SELECTOR_KEY_SUFFIX}`;
    }
    if (nounFromSelectorKey(key).startsWith("Element")) fallbackIndex++;
    // Store the Playwright-ready form so generated `Selectors.cs` constants
    // are accepted by `_page.ClickAsync(...)` / `FillAsync(...)` directly.
    // For non-XPath selectors this is a no-op.
    valueByKey.set(key, normalized);
    bySelector.set(a.selector, key);
  }

  const existingIfaceSigs = ifaceRaw
    ? existingInterfaceSignatures(ifaceRaw)
    : new Set<string>();
  const existingClassSigs = actRaw
    ? existingClassSignatures(actRaw)
    : new Set<string>();

  // --- Method names ----------------------------------------------------
  // The collision tracker only spans the in-flight recording: across
  // recordings we want the same selector + same auto-derived name to
  // reuse the on-disk method (the duplicate `signature` is filtered out
  // below by the `existingClassSigs.has(sig)` guard, so no second copy
  // is emitted). User-typed names that collide with on-disk methods on
  // a *different* selector are caught earlier in the recordingService
  // `name-action` handler, which surfaces a noun-suffixed alternative
  // before the actions list ever reaches `generateSuiteFiles`.
  const usedMethodNames = new Set<string>();

  const methodNames = new Map<RecordedAction, string>();
  const takesValueByMethod = new Map<string, boolean>();
  const newSignatures = new Map<string, { body: string; takesValue: boolean }>();
  let methodIndex = 0;
  for (const a of actions) {
    if (a.type === "assert") continue;
    if (!a.selector) continue;
    const key = bySelector.get(a.selector);
    if (!key) continue;
    methodIndex++;
    const candidate = methodNameFromAction(a, key, methodIndex);
    const methodName = disambiguateMethodName(candidate, usedMethodNames);
    usedMethodNames.add(methodName);

    // New-style `${Noun}Selector` keys are wired to a private
    // `${Noun}Element` ILocator field initialized in the constructor;
    // the method body is `await ${Noun}Element.{Verb}Async(...)`.
    // Legacy keys (no `Selector` suffix) keep the older inline
    // `_page.{Verb}Async(SuiteSelectors.LegacyKey, ...)` form so existing
    // recordings don't get rewritten gratuitously.
    const useFieldStyle = isNewStyleSelectorKey(key);
    const noun = nounFromSelectorKey(key);
    const elementField = `${noun}${ELEMENT_FIELD_SUFFIX}`;
    const selRef = `${suiteName}Selectors.${key}`;
    let signature: string;
    let body: string;
    let takesValue = false;
    if (a.type === "fill") {
      signature = `${methodName}(string value)`;
      body = useFieldStyle
        ? `await ${elementField}.FillAsync(value);`
        : `await _page.FillAsync(${selRef}, value);`;
      takesValue = true;
    } else if (a.type === "check") {
      signature = `${methodName}()`;
      body = useFieldStyle
        ? `await ${elementField}.CheckAsync();`
        : `await _page.CheckAsync(${selRef});`;
    } else if (a.type === "select") {
      signature = `${methodName}(string value)`;
      body = useFieldStyle
        ? `await ${elementField}.SelectOptionAsync(value);`
        : `await _page.SelectOptionAsync(${selRef}, value);`;
      takesValue = true;
    } else {
      signature = `${methodName}()`;
      body = useFieldStyle
        ? `await ${elementField}.ClickAsync();`
        : `await _page.ClickAsync(${selRef});`;
    }
    methodNames.set(a, methodName);
    takesValueByMethod.set(methodName, takesValue);
    if (!newSignatures.has(signature))
      newSignatures.set(signature, { body, takesValue });
  }

  // --- Selectors file (rewrite) ---------------------------------------
  const allSelectorEntries = Array.from(valueByKey.entries()).sort(
    (a, b) => a[0].localeCompare(b[0]),
  );
  const selectorLines = allSelectorEntries
    .map(
      ([k, v]) =>
        `        public static readonly string ${k} = "${escapeCs(v)}";`,
    )
    .join("\n");
  const selectorsContent = `namespace ${project.namespace}.Tests.PageObjects.Selectors
{
    public static class ${suiteName}Selectors
    {
${selectorLines}
    }
}
`;

  // --- Interface file (merge) -----------------------------------------
  const ifaceSigs: string[] = [];
  for (const sig of existingIfaceSigs) ifaceSigs.push(sig);
  for (const sig of newSignatures.keys()) {
    if (!existingIfaceSigs.has(sig)) ifaceSigs.push(sig);
  }
  const interfaceContent = `using System.Threading.Tasks;

namespace ${project.namespace}.Tests.PageObjects.Interfaces
{
    public interface I${suiteName}Actions
    {
${ifaceSigs.map((s) => `        Task ${s};`).join("\n")}
    }
}
`;

  // --- Actions class (merge) ------------------------------------------
  // For every new-style `${Noun}Selector` key in the (merged) selectors
  // map, emit a `private readonly ILocator ${Noun}Element` field plus an
  // initializer in the constructor. The fields cover every key (not just
  // the ones touched by this recording) so the class compiles cleanly
  // and any previously-emitted methods that reference `${Noun}Element`
  // still resolve. Legacy keys (no `Selector` suffix) get no field and
  // their methods continue to use the inline `_page.X(SuiteSelectors.K)`
  // form they were originally generated with.
  const elementNouns: string[] = [];
  for (const [k] of allSelectorEntries) {
    if (isNewStyleSelectorKey(k)) elementNouns.push(nounFromSelectorKey(k));
  }
  const fieldDeclLines = elementNouns
    .map((n) => `        private readonly ILocator ${n}${ELEMENT_FIELD_SUFFIX};`)
    .join("\n");
  const fieldInitLines = elementNouns
    .map(
      (n) =>
        `            ${n}${ELEMENT_FIELD_SUFFIX} = _page.Locator(${suiteName}Selectors.${n}${SELECTOR_KEY_SUFFIX});`,
    )
    .join("\n");

  // Emit existing methods from the prior class verbatim (best-effort: we
  // re-emit them as one-line stubs that delegate to the page using the
  // recorded selectors). To keep things robust without parsing C# bodies,
  // we ONLY append brand-new methods; the existing class body is preserved
  // by reading its method block and pasting it back in. The constructor
  // and field declarations above the constructor are always re-rendered
  // (they are NOT part of `previousClassMethods`).
  const previousClassMethods = actRaw
    ? extractActionsClassMethods(actRaw)
    : "";
  const newClassMethodLines: string[] = [];
  for (const [sig, info] of newSignatures) {
    if (existingClassSigs.has(sig)) continue;
    newClassMethodLines.push(
      `        public async Task ${sig}\n            => ${info.body}`,
    );
  }
  const classBody = [previousClassMethods, newClassMethodLines.join("\n\n")]
    .filter(Boolean)
    .join("\n\n");
  const fieldDeclSection = fieldDeclLines ? `\n${fieldDeclLines}\n` : "";
  const fieldInitSection = fieldInitLines ? `\n${fieldInitLines}` : "";
  const actionsContent = `using Microsoft.Playwright;
using ${project.namespace}.Tests.PageObjects.Interfaces;
using ${project.namespace}.Tests.PageObjects.Selectors;

namespace ${project.namespace}.Tests.PageObjects.Actions
{
    public class ${suiteName}Actions : I${suiteName}Actions
    {
        private readonly IPage _page;${fieldDeclSection}
        public ${suiteName}Actions(IPage page)
        {
            _page = page;${fieldInitSection}
        }

${classBody}
    }
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
