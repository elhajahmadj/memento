// Shared helpers + types for the apiJava codegen pipeline.
import path from "node:path";
import fs from "node:fs/promises";
import type { HttpVerb } from "@/features/codegen/infrastructure/apiCsharpCodegen";

export const JAVA_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const HTTP_VERBS: readonly HttpVerb[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

export function ident(name: string, label: string): void {
  if (!JAVA_IDENT.test(name)) {
    throw new Error(`${label} must be a valid Java identifier: ${name}`);
  }
}

export function relPosix(rootPath: string, abs: string): string {
  return path.relative(rootPath, abs).split(path.sep).join("/");
}

export function findMatchingBrace(source: string, openBodyStart: number): number {
  let depth = 1;
  for (let i = openBodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function replaceConstantIfPresent(
  source: string,
  bodyStart: number,
  bodyEnd: number,
  name: string,
  newLine: string,
): string | null {
  const re = new RegExp(
    `^[\\t ]*public\\s+static\\s+final\\s+String\\s+${name}\\s*=\\s*[^;]*;\\s*$`,
    "m",
  );
  const region = source.slice(bodyStart, bodyEnd);
  const m = re.exec(region);
  if (!m) return null;
  const absStart = bodyStart + m.index;
  const absEnd = absStart + m[0].length;
  return source.slice(0, absStart) + newLine + source.slice(absEnd);
}

export function quoteJavaString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;
}

/** Compute the per-suite assistant class name for a given test class. */
export function assistantClassNameForJava(testClassName: string): string {
  return `${testClassName}APITestingAssistants`;
}

/**
 * Resolve the bare suite name from the API spec's test class name
 * (`UsersTests` → `Users`) so we can derive `<Suite>TestCategories`.
 * Mirrors the UI-side `stripSuiteSuffix` heuristic.
 */
export function apiSuiteBareName(testClassName: string): string {
  if (/TestSuite$/.test(testClassName))
    return testClassName.slice(0, -"TestSuite".length);
  if (/Tests$/.test(testClassName))
    return testClassName.slice(0, -"Tests".length);
  if (/Test$/.test(testClassName))
    return testClassName.slice(0, -"Test".length);
  return testClassName;
}

/** `<Suite>TestCategories` Java class name for the API codegen path. */
export function apiSuiteTestCategoriesClassName(testClassName: string): string {
  const bare = apiSuiteBareName(testClassName) || "Recorded";
  return `${bare}TestCategories`;
}

export function ensureImports(source: string, imports: string[]): string {
  let out = source;
  const missing: string[] = [];
  for (const i of imports) {
    const re = new RegExp(
      `^\\s*import\\s+${i.replace(/\./g, "\\.")}\\s*;`,
      "m",
    );
    if (!re.test(out)) missing.push(i);
  }
  if (missing.length === 0) return out;
  const lastImport = /(^|\n)import\s+[^;]+;\s*\n/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = lastImport.exec(out)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  const block = missing.map((i) => `import ${i};\n`).join("");
  if (lastEnd > 0) {
    return out.slice(0, lastEnd) + block + out.slice(lastEnd);
  }
  // Insert after the package line.
  const pkgRe = /^package\s+[^;]+;\s*\n/m;
  const pm = pkgRe.exec(out);
  if (pm) {
    const insertAt = pm.index + pm[0].length;
    return out.slice(0, insertAt) + "\n" + block + out.slice(insertAt);
  }
  return block + out;
}

export async function readOrEmpty(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}
