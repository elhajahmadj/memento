/**
 * Per-page Page Object emitter — distinct from the per-suite Selectors/
 * Interface/Actions trio in `suiteFiles.ts`. This module is the historical
 * single-page POM emitter still consumed by callers that work in terms of
 * a single page rather than a recorded suite.
 */
import type { Project } from "@/features/projects/domain/types";
import { writeFile } from "@/features/projects/infrastructure/projectFiles";
import type { RecordedAction } from "@/features/codegen/domain/types";
import { methodNameFromAction, selectorKeyFromAction } from "./naming";

export interface PageMethod {
  action: RecordedAction;
  methodName: string;
  /** Method signature without leading `Task `, e.g. `ClickSubmit1()`. */
  signature: string;
  /** Body line emitted inside the page-object class. */
  body: string;
  /** True if the method takes a string `value` argument. */
  takesValue: boolean;
}

export interface PageObjectFiles {
  pageObjectPath: string;
  selectorsPath: string;
  interfacePath: string;
}

export function buildSelectorMap(
  actions: RecordedAction[],
): Map<string, string> {
  const bySelector = new Map<string, string>();
  const usedKeys = new Set<string>();
  let fallbackIndex = 0;
  for (const a of actions) {
    if (!a.selector || bySelector.has(a.selector)) continue;
    let key = selectorKeyFromAction(a, fallbackIndex);
    while (usedKeys.has(key)) {
      fallbackIndex++;
      key = `Element${fallbackIndex + 1}`;
    }
    if (key.startsWith("Element")) fallbackIndex++;
    usedKeys.add(key);
    bySelector.set(a.selector, key);
  }
  return bySelector;
}

export function buildPageMethods(
  pageName: string,
  actions: RecordedAction[],
  bySelector: Map<string, string>,
): PageMethod[] {
  const out: PageMethod[] = [];
  let i = 0;
  for (const a of actions) {
    if (!a.selector) continue;
    const key = bySelector.get(a.selector);
    if (!key) continue;
    i++;
    const methodName = methodNameFromAction(a, key, i);
    const selRef = `${pageName}Selectors.${key}`;
    let signature: string;
    let body: string;
    let takesValue = false;
    if (a.type === "fill") {
      signature = `${methodName}(string value)`;
      body = `await _page.FillAsync(${selRef}, value);`;
      takesValue = true;
    } else if (a.type === "check") {
      signature = `${methodName}()`;
      body = `await _page.CheckAsync(${selRef});`;
    } else if (a.type === "select") {
      signature = `${methodName}(string value)`;
      body = `await _page.SelectOptionAsync(${selRef}, value);`;
      takesValue = true;
    } else {
      signature = `${methodName}()`;
      body = `await _page.ClickAsync(${selRef});`;
    }
    out.push({ action: a, methodName, signature, body, takesValue });
  }
  return out;
}

export async function generatePageObject(
  project: Project,
  pageName: string,
  actions: RecordedAction[],
  selectorMap?: Map<string, string>,
  pageMethods?: PageMethod[],
): Promise<PageObjectFiles> {
  const bySelector = selectorMap ?? buildSelectorMap(actions);
  const methods = pageMethods ?? buildPageMethods(pageName, actions, bySelector);

  const selectors = new Map<string, string>();
  for (const [sel, key] of bySelector) selectors.set(key, sel);

  const selectorsPath = `${project.testProjectName}/PageObjects/Selectors/${pageName}Selectors.cs`;
  const pagePath = `${project.testProjectName}/PageObjects/${pageName}.cs`;
  const interfacePath = `${project.testProjectName}/PageObjects/Interfaces/I${pageName}.cs`;

  const selectorLines = Array.from(selectors.entries())
    .map(
      ([k, v]) =>
        `        public static readonly string ${k} = "${v.replace(/"/g, '\\"')}";`,
    )
    .join("\n");

  const selectorsContent = `namespace ${project.namespace}.Tests.PageObjects.Selectors
{
    public static class ${pageName}Selectors
    {
${selectorLines}
    }
}
`;

  // Deduplicate method signatures so the interface stays valid even if the
  // same action repeats. Class keeps every recorded call so the test reads
  // top-to-bottom.
  const seenSig = new Set<string>();
  const interfaceMethods: string[] = [];
  for (const m of methods) {
    if (seenSig.has(m.signature)) continue;
    seenSig.add(m.signature);
    interfaceMethods.push(`        Task ${m.signature};`);
  }

  const interfaceContent = `using System.Threading.Tasks;

namespace ${project.namespace}.Tests.PageObjects.Interfaces
{
    public interface I${pageName}
    {
${interfaceMethods.join("\n")}
    }
}
`;

  // Class methods: emit each unique signature once (same dedup as interface)
  // so the implementation matches.
  const seenClassSig = new Set<string>();
  const classMethods: string[] = [];
  for (const m of methods) {
    if (seenClassSig.has(m.signature)) continue;
    seenClassSig.add(m.signature);
    classMethods.push(
      `        public async Task ${m.signature}\n            => ${m.body}`,
    );
  }

  const pageContent = `using Microsoft.Playwright;
using ${project.namespace}.Tests.PageObjects.Interfaces;
using ${project.namespace}.Tests.PageObjects.Selectors;

namespace ${project.namespace}.Tests.PageObjects
{
    public class ${pageName} : I${pageName}
    {
        private readonly IPage _page;

        public ${pageName}(IPage page)
        {
            _page = page;
        }

${classMethods.join("\n\n")}
    }
}
`;

  await writeFile(project, selectorsPath, selectorsContent);
  await writeFile(project, interfacePath, interfaceContent);
  await writeFile(project, pagePath, pageContent);
  return { pageObjectPath: pagePath, selectorsPath, interfacePath };
}
