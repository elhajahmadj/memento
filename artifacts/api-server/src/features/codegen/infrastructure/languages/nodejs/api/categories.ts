import { NODEJS_API_TESTS_DIR } from "@/features/projects/infrastructure/apiNodejsScaffolder";
import { ident, kebabCase } from "./naming";

/**
 * Path to the per-suite Test Categories file inside a Node.js API
 * solution: `tests/test-categories/{kebab-class}.categories.ts`.
 */
export function categoriesFileRelPath(testClassName: string): string {
  return `${NODEJS_API_TESTS_DIR}/test-categories/${kebabCase(testClassName)}.categories.ts`;
}

/**
 * Render the per-suite Test Categories file content. Idempotently merges
 * a single `{name}: "{value}"` entry into any existing entries parsed
 * out of `existingSrc` (or starts a fresh file when null).
 */
export function renderCategoriesFile(
  testClassName: string,
  existingSrc: string | null,
  constantName: string,
  value: string,
): string {
  ident(testClassName, "Test class name");
  ident(constantName, "Category constant name");
  const entries = new Map<string, string>();
  if (existingSrc) {
    const re = /^\s*([A-Za-z_][\w]*)\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(existingSrc)) !== null) {
      entries.set(m[1]!, m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    }
  }
  entries.set(constantName, value);
  const sorted = Array.from(entries.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const body = sorted
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join("\n");
  return `/** Recorded test categories for the ${testClassName} suite. */
export const ${testClassName}Categories = {
${body}
} as const;
`;
}
