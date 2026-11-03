// Per-suite assistant class (`*APITestingAssistants.java`) rendering and upserts.
import type { BuildApiTestSpec } from "@/features/codegen/infrastructure/apiCsharpCodegen";
import {
  assistantClassNameForJava,
  ensureImports,
  findMatchingBrace,
  ident,
} from "./apiShared";
import { renderHelperMethodJava } from "./apiHelperMethod";

/** Render a brand-new per-suite assistant file. */
export function renderNewAssistantFileJava(
  spec: BuildApiTestSpec,
  basePkg: string,
  testClassName: string,
): string {
  ident(testClassName, "Test class name");
  const className = assistantClassNameForJava(testClassName);
  const methodSrc = renderHelperMethodJava(spec);
  return `package ${basePkg}.tests.apitestingassistants;

import ${basePkg}.constants.ApiEndpoints;
import ${basePkg}.extensions.ConfigurationExtensions;
import ${basePkg}.infrastructure.ApiTestFixture;

/**
 * Per-suite HTTP helper surface for {@code ${testClassName}}. Each method
 * wraps a single endpoint call and returns the raw
 * {@link java.net.http.HttpResponse} so callers can assert against
 * status, headers, and payload without re-implementing transport
 * plumbing.
 */
public class ${className} {
    private final ApiTestFixture fixture;

    public ${className}(ApiTestFixture fixture) {
        this.fixture = fixture;
    }

${methodSrc}
}
`;
}

/**
 * Append (or replace) a helper method on a per-suite assistant class.
 * Mirrors the C# `upsertHelperMethod` shape.
 */
export function upsertHelperMethodJava(
  source: string,
  spec: BuildApiTestSpec,
  basePkg: string,
  className: string,
): string {
  const headerRe = new RegExp(
    `public\\s+(?:final\\s+)?class\\s+${className}\\s*\\{`,
    "m",
  );
  const classHeader = headerRe.exec(source);
  if (!classHeader) {
    throw new Error(
      `Assistant file is missing the \`${className}\` class declaration`,
    );
  }

  source = ensureImports(source, [
    `${basePkg}.constants.ApiEndpoints`,
    `${basePkg}.extensions.ConfigurationExtensions`,
    `${basePkg}.infrastructure.ApiTestFixture`,
  ]);

  const headerAfter = headerRe.exec(source);
  if (!headerAfter) {
    throw new Error(
      `Assistant file is missing the \`${className}\` class declaration`,
    );
  }
  const bodyStart = headerAfter.index + headerAfter[0].length;
  const bodyEnd = findMatchingBrace(source, bodyStart);
  if (bodyEnd === -1) {
    throw new Error("Assistant file has unbalanced braces");
  }

  const methodSrc = renderHelperMethodJava(spec);
  const methodPattern = new RegExp(
    `\\n[\\t ]*public\\s+java\\.net\\.http\\.HttpResponse<String>\\s+${spec.helperMethodName}\\s*\\([^)]*\\)\\s*throws[^\\{]*\\{`,
  );
  const region = source.slice(bodyStart, bodyEnd);
  const m = methodPattern.exec(region);
  if (m) {
    const methodOpenInRegion = m.index + m[0].length;
    const methodCloseInRegion = findMatchingBrace(region, methodOpenInRegion);
    if (methodCloseInRegion === -1) {
      throw new Error(
        `Existing helper ${spec.helperMethodName} has unbalanced braces`,
      );
    }
    let lineStart = m.index;
    while (lineStart > 0 && region[lineStart - 1] !== "\n") lineStart--;
    const absLineStart = bodyStart + lineStart;
    const absMethodEnd = bodyStart + methodCloseInRegion + 1;
    return (
      source.slice(0, absLineStart) +
      methodSrc +
      "\n" +
      source.slice(absMethodEnd)
    );
  }

  const insertion = `\n\n${methodSrc}\n`;
  return source.slice(0, bodyEnd) + insertion + source.slice(bodyEnd);
}
