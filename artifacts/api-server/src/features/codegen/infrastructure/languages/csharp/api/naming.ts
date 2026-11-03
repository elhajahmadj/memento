import fs from "node:fs/promises";
import path from "node:path";
import {
  API_HELPER_SUFFIX,
  API_TESTS_SUFFIX,
} from "@/features/projects/infrastructure/apiCsharpScaffolder";
import { CSHARP_IDENT } from "./types";

export function ident(name: string, label: string): void {
  if (!CSHARP_IDENT.test(name)) {
    throw new Error(`${label} must be a valid C# identifier: ${name}`);
  }
}

export function helperProjectName(solutionName: string): string {
  return `${solutionName}${API_HELPER_SUFFIX}`;
}

export function testProjectName(solutionName: string): string {
  return `${solutionName}${API_TESTS_SUFFIX}`;
}

export function relPosix(rootPath: string, abs: string): string {
  return path.relative(rootPath, abs).split(path.sep).join("/");
}

export async function readOrEmpty(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

/** Strip a trailing `TestSuite` or `Tests` suffix from a class name. */
export function deriveApiSuiteStem(className: string): string {
  const s = (className ?? "").trim();
  if (!s) return s;
  if (s.endsWith("TestSuite")) return s.slice(0, -"TestSuite".length);
  if (s.endsWith("Tests")) return s.slice(0, -"Tests".length);
  return s;
}

export function apiSuiteConstantsClassName(className: string): string {
  return `${deriveApiSuiteStem(className)}Constants`;
}

export function apiSuiteTestCategoriesClassName(className: string): string {
  return `${deriveApiSuiteStem(className)}TestCategories`;
}

/** Render the empty per-suite Constants/{Suite}Constants.cs placeholder. */
export function renderApiSuiteConstantsFile(
  ns: string,
  className: string,
): string {
  const cls = apiSuiteConstantsClassName(className);
  return `namespace ${ns}.Automation.API.Tests.Constants
{
    public static class ${cls}
    {
    }
}
`;
}

/**
 * Idempotently upsert a `public const string {constName} = "{value}"`
 * into the source of `{TestProj}/TestCategories/{Suite}TestCategories.cs`
 * (or render a fresh file when `existing` is null). Returns the new
 * file content.
 */
export function upsertApiTestCategoryConstant(
  ns: string,
  className: string,
  constName: string,
  value: string,
  existing: string | null,
): string {
  if (!CSHARP_IDENT.test(constName)) {
    throw new Error(
      `Category constant name must be a valid C# identifier: ${constName}`,
    );
  }
  const cls = apiSuiteTestCategoriesClassName(className);
  const escaped = (value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const constLine = `        public const string ${constName} = "${escaped}";`;
  if (!existing) {
    return `namespace ${ns}.Automation.API.Tests.TestCategories
{
    public static class ${cls}
    {
${constLine}
    }
}
`;
  }
  const re = new RegExp(
    `^[\\t ]*public const string ${constName}\\s*=\\s*"[^"]*"\\s*;\\s*$`,
    "m",
  );
  if (re.test(existing)) {
    return existing.replace(re, constLine);
  }
  const classOpenRe = new RegExp(`public static class ${cls}\\s*\\{`);
  const m = classOpenRe.exec(existing);
  if (!m) {
    return `namespace ${ns}.Automation.API.Tests.TestCategories
{
    public static class ${cls}
    {
${constLine}
    }
}
`;
  }
  const openEnd = m.index + m[0].length;
  let depth = 1;
  let close = -1;
  for (let i = openEnd; i < existing.length; i++) {
    const ch = existing[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return existing;
  return (
    existing.slice(0, close) + `${constLine}\n    ` + existing.slice(close)
  );
}
