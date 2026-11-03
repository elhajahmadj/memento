import path from "node:path";
import type { BuildApiTestSpec } from "@/features/codegen/infrastructure/apiCsharpCodegen";
import {
  assistantClassNameFor,
  assistantFileNameFor,
  camelCase,
  ident,
  kebabCase,
} from "./naming";
import { findMatchingBrace } from "./braces";
import { defaultArg } from "./helperMethod";

/**
 * Resolved Ignore + Category emission for a single Vitest test method.
 */
interface ResolvedTestDecorations {
  itFn: "it" | "it.skip";
  ignoreCommentLine: string;
  itOptionsArg: string;
  categoriesImport: string | null;
  categoriesClassName: string;
  hasCategory: boolean;
  categoryConstantName: string | null;
  categoryValue: string | null;
}

export function resolveTestDecorations(
  spec: BuildApiTestSpec,
  testClassName: string,
): ResolvedTestDecorations {
  const ignoreReason = spec.metadata?.ignoreReason ?? null;
  const categoryConstantName = spec.metadata?.categoryConstantName ?? null;
  const categoryValue = spec.metadata?.categoryValue ?? null;
  const hasCategory =
    typeof categoryConstantName === "string" &&
    categoryConstantName.length > 0 &&
    typeof categoryValue === "string" &&
    categoryValue.length > 0;
  if (hasCategory) {
    ident(categoryConstantName!, "Category constant name");
  }
  const categoriesClassName = `${testClassName}Categories`;
  return {
    itFn: ignoreReason ? "it.skip" : "it",
    ignoreCommentLine: ignoreReason
      ? `  // Ignored: ${ignoreReason.replace(/\r?\n/g, " ")}\n`
      : "",
    itOptionsArg: hasCategory
      ? `, { meta: { category: ${categoriesClassName}.${categoryConstantName} } }`
      : "",
    categoriesImport: hasCategory
      ? `import { ${categoriesClassName} } from "../test-categories/${kebabCase(testClassName)}.categories";`
      : null,
    categoriesClassName,
    hasCategory,
    categoryConstantName: hasCategory ? categoryConstantName : null,
    categoryValue: hasCategory ? categoryValue : null,
  };
}

/** Render a brand-new test file. */
export function renderNewTestClass(
  spec: BuildApiTestSpec,
  testClassName: string,
): string {
  ident(testClassName, "Test class name");
  ident(spec.testMethodName, "Test method name");

  const assistantClassName = assistantClassNameFor(testClassName);
  const assistantImportPath = `../api-testing-assistants/${path.basename(assistantFileNameFor(testClassName), ".ts")}`;
  const callArgs = spec.parameters.map((p) => defaultArg(p.type)).join(", ");
  const assistantVar = camelCase(assistantClassName);
  const dec = resolveTestDecorations(spec, testClassName);
  const categoriesImportLine = dec.categoriesImport
    ? `\n${dec.categoriesImport}`
    : "";

  if (spec.buildInto === "oneTimeSetup") {
    return `import { describe, it, expect, beforeAll } from "vitest";
import { apiTestFixture } from "../infrastructure/api-test-collection";
import { ${assistantClassName} } from "${assistantImportPath}";${categoriesImportLine}

describe(${JSON.stringify(testClassName)}, () => {
  const ${assistantVar} = new ${assistantClassName}(apiTestFixture);
  let response: Response;

  beforeAll(async () => {
    response = await ${assistantVar}.${spec.helperMethodName}(${callArgs});
  });

${dec.ignoreCommentLine}  ${dec.itFn}(${JSON.stringify(spec.testMethodName)}${dec.itOptionsArg}, () => {
    // eslint-disable-next-line no-console
    console.log(\`Status: \${response.status}\`);
    expect(response.status).toBe(200);
  });
});
`;
  }

  return `import { describe, it, expect } from "vitest";
import { apiTestFixture } from "../infrastructure/api-test-collection";
import { ${assistantClassName} } from "${assistantImportPath}";${categoriesImportLine}

describe(${JSON.stringify(testClassName)}, () => {
  const ${assistantVar} = new ${assistantClassName}(apiTestFixture);

${dec.ignoreCommentLine}  ${dec.itFn}(${JSON.stringify(spec.testMethodName)}${dec.itOptionsArg}, async () => {
    const response = await ${assistantVar}.${spec.helperMethodName}(${callArgs});
    // eslint-disable-next-line no-console
    console.log(\`Status: \${response.status}\`);
    expect(response.status).toBe(200);
  });
});
`;
}

/**
 * Insert a new `it(...)` block into an existing test file. Throws if a
 * test with the same name already exists.
 */
export function insertItIntoExistingClass(
  source: string,
  spec: BuildApiTestSpec,
  testClassName: string,
): string {
  ident(spec.testMethodName, "Test method name");
  if (spec.buildInto !== "testMethod") {
    throw new Error(
      "Adding to an existing test file is only supported when buildInto = testMethod",
    );
  }
  const describeRe = new RegExp(
    `describe\\(\\s*["']${testClassName}["']\\s*,\\s*\\([^)]*\\)\\s*=>\\s*\\{`,
    "m",
  );
  const dm = describeRe.exec(source);
  if (!dm) {
    throw new Error(
      `Target test file does not contain a recognizable \`describe(${testClassName}, …)\` block`,
    );
  }
  const bodyStart = dm.index + dm[0].length;
  const bodyEnd = findMatchingBrace(source, bodyStart);
  if (bodyEnd === -1) {
    throw new Error("Target test file has unbalanced braces");
  }
  const region = source.slice(bodyStart, bodyEnd);
  const dup = new RegExp(`it(?:\\.skip)?\\(\\s*["']${spec.testMethodName}["']`);
  if (dup.test(region)) {
    throw new Error(
      `Test \`${spec.testMethodName}\` already exists in target file`,
    );
  }
  const assistantClassName = assistantClassNameFor(testClassName);
  const newRe = new RegExp(`const\\s+(\\w+)\\s*=\\s*new\\s+${assistantClassName}\\b`);
  const nm = newRe.exec(region);
  const assistantVar = nm?.[1] ?? camelCase(assistantClassName);
  const callArgs = spec.parameters.map((p) => defaultArg(p.type)).join(", ");
  const dec = resolveTestDecorations(spec, testClassName);
  const block = `
${dec.ignoreCommentLine}  ${dec.itFn}(${JSON.stringify(spec.testMethodName)}${dec.itOptionsArg}, async () => {
    const response = await ${assistantVar}.${spec.helperMethodName}(${callArgs});
    // eslint-disable-next-line no-console
    console.log(\`Status: \${response.status}\`);
    expect(response.status).toBe(200);
  });
`;
  let updated = source.slice(0, bodyEnd) + block + source.slice(bodyEnd);
  if (dec.categoriesImport && !updated.includes(dec.categoriesImport)) {
    const lastImport = /(^|\n)import\s[^\n]+\n/g;
    let lastEnd = 0;
    let im: RegExpExecArray | null;
    while ((im = lastImport.exec(updated)) !== null) {
      lastEnd = im.index + im[0].length;
    }
    const insertion = `${dec.categoriesImport}\n`;
    updated =
      lastEnd > 0
        ? updated.slice(0, lastEnd) + insertion + updated.slice(lastEnd)
        : insertion + updated;
  }
  return updated;
}
