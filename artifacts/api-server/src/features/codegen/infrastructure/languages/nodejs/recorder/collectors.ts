import type { AiRunReport, AiRunStep } from "@/features/ai-agent/domain/types";
import { deriveUrlName } from "@/features/ai-agent/infrastructure/urlNaming";
import {
  camel,
  escapeTs,
  inferFieldName,
  nodeConstName,
  upperSnake,
} from "./helpers";

export interface NodeMethod {
  name: string;
  param: string | null;
  body: string[];
}

export function collectNodePageMethods(steps: AiRunStep[]): NodeMethod[] {
  const out: NodeMethod[] = [];
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
          body: [`    await this.page.click("${escapeTs(c.selector ?? "")}");`],
        });
        seen.add(verb);
      } else if (c.method === "page.fill") {
        out.push({
          name: verb,
          param: "value: string",
          body: [`    await this.page.fill("${escapeTs(c.selector ?? "")}", value);`],
        });
        seen.add(verb);
      } else if (c.method === "expect.toBeVisible") {
        out.push({
          name: verb,
          param: null,
          body: [
            `    const { expect } = await import("@playwright/test");`,
            `    await expect(this.page.locator("${escapeTs(c.selector ?? "")}")).toBeVisible();`,
          ],
        });
        seen.add(verb);
      }
    }
  }
  return out;
}

export function collectNodeConstants(steps: AiRunStep[]): Map<string, string> {
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

export function collectNamedUrlsNode(report: AiRunReport): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of report.steps ?? []) {
    for (const c of s.playwrightCalls ?? []) {
      if (c.method === "page.goto" && c.args?.[0]) {
        const url = String(c.args[0]);
        const hit = report.urlNames?.find((u) => u.url === url);
        const pascalName = hit?.name ?? deriveUrlName(url);
        const name = nodeConstName(pascalName);
        if (!out.has(name)) out.set(name, url);
      }
    }
  }
  return out;
}
