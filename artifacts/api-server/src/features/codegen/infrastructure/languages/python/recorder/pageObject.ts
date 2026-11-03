import type { AiRunStep } from "@/features/ai-agent/domain/types";
import { escapePy, snake } from "./helpers";

export interface PyMethod {
  name: string;
  param: string | null;
  body: string[];
}

export function collectPyPageMethods(steps: AiRunStep[]): PyMethod[] {
  const out: PyMethod[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    for (const c of step.playwrightCalls ?? []) {
      if (c.method === "page.goto") continue;
      const verb = snake(step.method?.name ?? "");
      if (!verb || seen.has(verb)) continue;
      if (c.method === "page.click") {
        out.push({
          name: verb,
          param: null,
          body: [`        self.page.click("${escapePy(c.selector ?? "")}")`],
        });
        seen.add(verb);
      } else if (c.method === "page.fill") {
        out.push({
          name: verb,
          param: "value: str",
          body: [`        self.page.fill("${escapePy(c.selector ?? "")}", value)`],
        });
        seen.add(verb);
      } else if (c.method === "expect.toBeVisible") {
        out.push({
          name: verb,
          param: null,
          body: [
            `        from playwright.sync_api import expect`,
            `        expect(self.page.locator("${escapePy(c.selector ?? "")}")).to_be_visible()`,
          ],
        });
        seen.add(verb);
      }
    }
  }
  return out;
}

export function renderPyPage(
  pageClass: string,
  methods: PyMethod[],
  isAdditions: boolean,
  baseModule: string | null,
): string {
  const className = isAdditions ? `${pageClass}PageAiAdditions` : `${pageClass}Page`;
  const baseClause = isAdditions && baseModule
    ? `(${pageClass}Page)`
    : "";
  const baseImport = isAdditions && baseModule
    ? `from pages.${baseModule}_page import ${pageClass}Page\n`
    : "";
  const init = isAdditions
    ? ""
    : [
        "    def __init__(self, page):",
        "        self.page = page",
        "",
      ].join("\n");
  const body = methods
    .map((m) => {
      const sig = m.param
        ? `    def ${m.name}(self, ${m.param}) -> None:`
        : `    def ${m.name}(self) -> None:`;
      return [sig, ...m.body, ""].join("\n");
    })
    .join("\n");
  return `${baseImport}\nclass ${className}${baseClause}:\n${init}${body}`;
}
