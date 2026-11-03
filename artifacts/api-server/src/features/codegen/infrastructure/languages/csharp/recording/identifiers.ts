/**
 * C#-specific identifier / filename / suffix helpers shared across the
 * recording-time emitter modules. Pure: no I/O except `readIfExists`
 * (a thin best-effort wrapper around `fs.readFile`).
 */
import fs from "node:fs/promises";
import type { Project } from "@/features/projects/domain/types";

export function pascal(s: string): string {
  return s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export function escapeCs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function readIfExists(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

export function existingSelectorKeys(content: string): Map<string, string> {
  // Extract `public static readonly string KeyName = "value";` entries.
  const out = new Map<string, string>();
  const re =
    /public\s+static\s+readonly\s+string\s+(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.set(m[1]!, m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return out;
}

export function existingInterfaceSignatures(content: string): Set<string> {
  // Extract `Task SignatureHere;` inside the interface block.
  const out = new Set<string>();
  const re = /Task\s+(\w+\s*\([^)]*\))\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.add(m[1]!.replace(/\s+/g, " ").trim());
  }
  return out;
}

export function existingClassSignatures(content: string): Set<string> {
  // Extract `public async Task SignatureHere` inside the class body.
  const out = new Set<string>();
  const re = /public\s+async\s+Task\s+(\w+\s*\([^)]*\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.add(m[1]!.replace(/\s+/g, " ").trim());
  }
  return out;
}

/**
 * Extract the body of methods inside a previously-generated Actions class.
 * Returns the joined source between the constructor closing brace and the
 * class closing brace, or "" if it can't be found.
 */
export function extractActionsClassMethods(content: string): string {
  // Find `public ... Actions(IPage page)` constructor and its closing brace.
  const ctorIdx = content.search(/public\s+\w+Actions\s*\(\s*IPage\s+page\s*\)/);
  if (ctorIdx === -1) return "";
  // Move forward to the constructor's `{` and find its matching `}`.
  let i = content.indexOf("{", ctorIdx);
  if (i === -1) return "";
  let depth = 0;
  for (; i < content.length; i++) {
    const c = content[i]!;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  // Now find the class closing brace by counting braces from here at depth 1.
  let methodsEnd = -1;
  let cdepth = 1;
  for (let j = i; j < content.length; j++) {
    const c = content[j]!;
    if (c === "{") cdepth++;
    else if (c === "}") {
      cdepth--;
      if (cdepth === 0) {
        methodsEnd = j;
        break;
      }
    }
  }
  if (methodsEnd === -1) return "";
  return content.slice(i, methodsEnd).trim();
}

export function pageVarName(pageName: string): string {
  if (!pageName) return "page";
  return pageName.charAt(0).toLowerCase() + pageName.slice(1);
}

export function pageNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || u.hostname.split(".")[0];
    return pascal(last || "Home") + "Page";
  } catch {
    return "HomePage";
  }
}

/**
 * Strip the trailing `TestSuite` or `Tests` suffix from a class name so
 * codegen can derive a "suite stem" used to name the per-suite
 * `Constants/{Stem}Constants.cs` and `TestCategories/{Stem}TestCategories.cs`
 * files. Returns the input unchanged if neither suffix is present.
 */
export function deriveSuiteStem(suiteName: string): string {
  const s = (suiteName ?? "").trim();
  if (!s) return s;
  if (s.endsWith("TestSuite")) return s.slice(0, -"TestSuite".length);
  if (s.endsWith("Tests")) return s.slice(0, -"Tests".length);
  return s;
}

/** Per-suite constants class name and file path. */
export function suiteConstantsClassName(suiteName: string): string {
  return `${deriveSuiteStem(suiteName)}Constants`;
}
export function suiteConstantsRelPath(
  project: Project,
  suiteName: string,
): string {
  return `${project.testProjectName}/Constants/${suiteConstantsClassName(suiteName)}.cs`;
}

/** Per-suite test-categories class name and file path. */
export function suiteTestCategoriesClassName(suiteName: string): string {
  return `${deriveSuiteStem(suiteName)}TestCategories`;
}
export function suiteTestCategoriesRelPath(
  project: Project,
  suiteName: string,
): string {
  return `${project.testProjectName}/TestCategories/${suiteTestCategoriesClassName(suiteName)}.cs`;
}

/**
 * Suggest a non-colliding alternative for `desired` given the set of names
 * already used in the suite. Mirrors `checkTestMethodExists`'s suffix
 * scheme.
 */
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
 * Sanitize an arbitrary shared-step name (which may contain spaces,
 * hyphens, or other punctuation) into a valid C# PascalCase
 * identifier so the generated `<Name>Steps` class + method call
 * compile cleanly. The input shared-step name is preserved as the
 * user-visible display label; this helper is used everywhere a
 * symbol gets emitted (filename, class name, RunAsync call site).
 *
 * - Splits on any non-alphanumeric run.
 * - PascalCases each token.
 * - Drops a leading digit (C# identifiers cannot start with one) by
 *   prefixing with `M`.
 * - Falls back to `Macro` if the input had no usable characters.
 */
export function toCsharpMacroIdentifier(name: string): string {
  const tokens = (name ?? "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1));
  let id = tokens.join("");
  if (!id) return "Macro";
  if (/^\d/.test(id)) id = `M${id}`;
  return id;
}
