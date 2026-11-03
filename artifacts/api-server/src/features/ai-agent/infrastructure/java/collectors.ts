import type { AiRunReport, AiRunStep } from "@/features/ai-agent/domain/types";
import { deriveUrlName } from "../urlNaming";
import {
  camel,
  escapeJ,
  inferFieldName,
  javaPropertyKey,
  upperSnake,
} from "./helpers";
import type { JavaMethod } from "./types";

export function collectJavaPageMethods(steps: AiRunStep[]): JavaMethod[] {
  const out: JavaMethod[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    for (const c of step.playwrightCalls ?? []) {
      if (c.method === "page.goto") continue;
      const verb = camel(step.method?.name ?? "");
      if (!verb || seen.has(verb)) continue;
      if (c.method === "page.click") {
        out.push({
          name: verb,
          param: null,
          body: [`        page.click("${escapeJ(c.selector ?? "")}");`],
        });
        seen.add(verb);
      } else if (c.method === "page.fill") {
        out.push({
          name: verb,
          param: "String value",
          body: [`        page.fill("${escapeJ(c.selector ?? "")}", value);`],
        });
        seen.add(verb);
      } else if (c.method === "expect.toBeVisible") {
        out.push({
          name: verb,
          param: null,
          body: [
            `        com.microsoft.playwright.assertions.PlaywrightAssertions`,
            `            .assertThat(page.locator("${escapeJ(c.selector ?? "")}"))`,
            `            .isVisible();`,
          ],
        });
        seen.add(verb);
      }
    }
  }
  return out;
}

export function collectJavaConstants(steps: AiRunStep[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const step of steps) {
    for (const c of step.playwrightCalls ?? []) {
      if (c.method === "page.fill" && c.value !== undefined) {
        const field = inferFieldName(step) ?? "value";
        out.set(upperSnake(field) || "VALUE", String(c.value));
      }
    }
  }
  return out;
}

export function collectNamedUrlsJava(report: AiRunReport): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of report.steps ?? []) {
    for (const c of s.playwrightCalls ?? []) {
      if (c.method === "page.goto" && c.args?.[0]) {
        const url = String(c.args[0]);
        const hit = report.urlNames?.find((u) => u.url === url);
        const name = hit?.name ?? deriveUrlName(url);
        const key = javaPropertyKey(name);
        if (!out.has(key)) out.set(key, url);
      }
    }
  }
  return out;
}
