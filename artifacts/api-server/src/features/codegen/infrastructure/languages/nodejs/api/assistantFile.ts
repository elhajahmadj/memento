import type { BuildApiTestSpec } from "@/features/codegen/infrastructure/apiCsharpCodegen";
import { ident } from "./naming";
import { findMatchingBrace } from "./braces";
import { renderHelperMethod } from "./helperMethod";

/**
 * Render a brand-new per-suite assistant file containing the helper
 * method.
 */
export function renderNewAssistantFile(
  spec: BuildApiTestSpec,
  testClassName: string,
): string {
  ident(testClassName, "Test class name");
  const className = `${testClassName}ApiTestingAssistants`;
  const methodSrc = renderHelperMethod(spec);
  const needsFormat = spec.parameters.length > 0;
  const fixtureImports = needsFormat
    ? `import { ApiTestFixture, formatPath } from "../../src/automation-api/infrastructure/api-test-fixture";`
    : `import { ApiTestFixture } from "../../src/automation-api/infrastructure/api-test-fixture";`;
  const tokenImport = spec.useAccessToken
    ? `\nimport { getAccessToken } from "../../src/automation-api/extensions/configuration-extensions";`
    : "";
  return `import { ApiEndpoints } from "../../src/automation-api/constants/api-endpoints";
${fixtureImports}${tokenImport}

/**
 * Per-suite HTTP helper surface for \`${testClassName}\`. Each method wraps
 * a single endpoint call and returns the raw \`Response\` so callers can
 * assert against status, headers, and payload without re-implementing
 * transport plumbing.
 */
export class ${className} {
  constructor(private readonly fixture: ApiTestFixture) {}

${methodSrc}
}
`;
}

/**
 * Append (or replace) a helper method on a per-suite assistant class.
 * Idempotent: a method with the same name is replaced; otherwise the new
 * method is appended just before the closing brace of the class.
 */
export function upsertHelperMethod(
  source: string,
  spec: BuildApiTestSpec,
  className: string,
): string {
  const headerRe = new RegExp(`export class ${className}\\s*\\{`, "m");
  const classHeader = headerRe.exec(source);
  if (!classHeader) {
    throw new Error(
      `Assistant file is missing the \`${className}\` class declaration`,
    );
  }
  const bodyStart = classHeader.index + classHeader[0].length;
  const bodyEnd = findMatchingBrace(source, bodyStart);
  if (bodyEnd === -1) {
    throw new Error("Assistant file has unbalanced braces");
  }

  let updated = ensureAssistantImports(source, spec);
  // Re-locate after possible import insertions.
  const headerAfter = headerRe.exec(updated);
  if (!headerAfter) {
    throw new Error(
      `Assistant file is missing the \`${className}\` class declaration`,
    );
  }
  const bodyStart2 = headerAfter.index + headerAfter[0].length;
  const bodyEnd2 = findMatchingBrace(updated, bodyStart2);
  if (bodyEnd2 === -1) {
    throw new Error("Assistant file has unbalanced braces");
  }

  const methodSrc = renderHelperMethod(spec);
  const region = updated.slice(bodyStart2, bodyEnd2);
  const methodPattern = new RegExp(
    `\\n[\\t ]*async ${spec.helperMethodName}\\s*\\(`,
  );
  const m = methodPattern.exec(region);
  if (m) {
    const methodOpenIdxInRegion = region.indexOf("{", m.index + m[0].length);
    if (methodOpenIdxInRegion === -1) {
      throw new Error(
        `Existing helper ${spec.helperMethodName} is malformed (missing body)`,
      );
    }
    const methodCloseInRegion = findMatchingBrace(
      region,
      methodOpenIdxInRegion + 1,
    );
    if (methodCloseInRegion === -1) {
      throw new Error(
        `Existing helper ${spec.helperMethodName} has unbalanced braces`,
      );
    }
    let lineStart = m.index;
    while (lineStart > 0 && region[lineStart - 1] !== "\n") lineStart--;
    const absLineStart = bodyStart2 + lineStart;
    const absMethodEnd = bodyStart2 + methodCloseInRegion + 1;
    return (
      updated.slice(0, absLineStart) +
      methodSrc +
      "\n" +
      updated.slice(absMethodEnd)
    );
  }

  const insertion = `\n${methodSrc}\n`;
  return updated.slice(0, bodyEnd2) + insertion + updated.slice(bodyEnd2);
}

function ensureAssistantImports(source: string, spec: BuildApiTestSpec): string {
  let out = source;
  const fixtureImportRe = /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/\.\.\/src\/automation-api\/infrastructure\/api-test-fixture["'];/m;
  const m = fixtureImportRe.exec(out);
  if (m && spec.parameters.length > 0 && !/\bformatPath\b/.test(m[1]!)) {
    const newNames = m[1]!.trim().endsWith(",")
      ? `${m[1]} formatPath,`
      : `${m[1]}, formatPath`;
    out =
      out.slice(0, m.index) +
      `import {${newNames}} from "../../src/automation-api/infrastructure/api-test-fixture";` +
      out.slice(m.index + m[0].length);
  }
  if (
    spec.useAccessToken &&
    !/from\s*["']\.\.\/\.\.\/src\/automation-api\/extensions\/configuration-extensions["']/.test(out)
  ) {
    const lastImport = /(^|\n)import\s[^\n]+\n/g;
    let lastEnd = 0;
    let im: RegExpExecArray | null;
    while ((im = lastImport.exec(out)) !== null) {
      lastEnd = im.index + im[0].length;
    }
    const block = `import { getAccessToken } from "../../src/automation-api/extensions/configuration-extensions";\n`;
    out = lastEnd > 0 ? out.slice(0, lastEnd) + block + out.slice(lastEnd) : block + out;
  }
  return out;
}
