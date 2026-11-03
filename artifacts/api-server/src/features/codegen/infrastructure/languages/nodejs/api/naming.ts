import fs from "node:fs/promises";
import path from "node:path";

const TS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function ident(name: string, label: string): void {
  if (!TS_IDENT.test(name)) {
    throw new Error(`${label} must be a valid TypeScript identifier: ${name}`);
  }
}

/** Convert PascalCase / camelCase to kebab-case for filenames. */
export function kebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

export function pascalCase(kebab: string): string {
  return kebab
    .split("-")
    .map((part) => (part.length === 0 ? "" : part[0]!.toUpperCase() + part.slice(1)))
    .join("");
}

export function camelCase(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function assistantClassNameFor(testClassName: string): string {
  return `${testClassName}ApiTestingAssistants`;
}

export function assistantFileNameFor(testClassName: string): string {
  return `${kebabCase(testClassName)}-api-testing-assistants.ts`;
}

export function testFileNameFor(testClassName: string): string {
  return `${kebabCase(testClassName)}.spec.ts`;
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
