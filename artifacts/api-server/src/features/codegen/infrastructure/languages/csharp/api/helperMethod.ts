import type { BuildApiTestSpec, HttpVerb } from "./types";
import { ident } from "./naming";
import { findMatchingBrace, ensureUsings } from "./csSource";

function verbToCs(v: HttpVerb): string {
  return v[0] + v.slice(1).toLowerCase();
}

/** Render the helper method body for a single endpoint. */
export function renderHelperMethod(
  spec: BuildApiTestSpec,
  ns: string,
): string {
  void ns;
  ident(spec.helperMethodName, "Helper method name");
  for (const p of spec.parameters) ident(p.name, "Parameter name");
  if (spec.parameters.length > 10) {
    throw new Error("Helper methods accept at most 10 parameters");
  }

  const params = spec.parameters
    .map((p) => `${p.type} ${p.name}`)
    .join(", ");
  const endpointRef = spec.endpointSection
    ? `Constants.ApiEndpoints.${spec.endpointSection}.${spec.endpointName}`
    : `Constants.ApiEndpoints.${spec.endpointName}`;

  const formatArgs = spec.parameters
    .map((p) => p.name)
    .join(", ");
  const pathExpr =
    spec.parameters.length > 0
      ? `string.Format(${endpointRef}, ${formatArgs})`
      : endpointRef;

  const verbInit = `        var request = new HttpRequestMessage(HttpMethod.${verbToCs(
    spec.httpMethod,
  )}, ${pathExpr});`;

  const headerLines: string[] = [];
  for (const h of spec.defaultHeaders) {
    headerLines.push(
      `        request.Headers.TryAddWithoutValidation(${JSON.stringify(
        h.name,
      )}, ${JSON.stringify(h.value)});`,
    );
  }
  if (spec.useAccessToken) {
    headerLines.push(
      `        request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {_fixture.Configuration.GetAccessToken(${JSON.stringify(spec.urlName)})}");`,
    );
  }
  const sendLine = `        return await _fixture.GetClient(${JSON.stringify(spec.urlName)}).SendAsync(request);`;

  const multipartLines: string[] = [];
  if (spec.multipartFields.length > 0) {
    multipartLines.push(`        var content = new MultipartFormDataContent();`);
    for (const f of spec.multipartFields) {
      ident(f.name, "Multipart field name");
      multipartLines.push(
        `        content.Add(new StringContent(${f.valueExpression}), ${JSON.stringify(f.name)});`,
      );
    }
    multipartLines.push(`        request.Content = content;`);
  }

  const bodyLines = [
    verbInit,
    ...headerLines,
    ...multipartLines,
    sendLine,
  ].join("\n");

  return `    public async Task<HttpResponseMessage> ${spec.helperMethodName}(${params})
    {
${bodyLines}
    }`;
}

/**
 * Append (or replace) a helper method on a per-suite assistant class. If a
 * method with the same name + arity already exists, it is replaced;
 * otherwise the new method is appended just before the closing brace of
 * the class. Throws when the file's structure is unrecognized.
 *
 * `className` defaults to `APITestingAssistant` for backwards compatibility
 * with older single-file scaffolds and the existing unit tests; new
 * Build Test invocations pass the per-suite assistant class name
 * (`{TestClass}APITestingAssistants`).
 */
export function upsertHelperMethod(
  source: string,
  spec: BuildApiTestSpec,
  ns: string,
  className: string = "APITestingAssistant",
): string {
  const headerRe = new RegExp(
    `public partial class ${className}\\s*\\{|public class ${className}\\s*\\{`,
    "m",
  );
  const classHeader = headerRe.exec(source);
  if (!classHeader) {
    throw new Error(
      `Assistant file is missing the \`${className}\` class declaration`,
    );
  }
  const bodyStart = classHeader.index + classHeader[0].length;
  const bodyEnd = findMatchingBrace(source, bodyStart);
  if (bodyEnd === -1) {
    throw new Error(`Assistant file has unbalanced braces`);
  }
  void bodyStart;
  void bodyEnd;

  source = ensureUsings(source, [
    "System.Net.Http",
    `${ns}.Automation.API.Constants`,
    `${ns}.Automation.API.Extensions`,
    `${ns}.Automation.API.Infrastructure`,
  ]);
  // Recompute brace bounds after using-line insertions.
  const headerAfter = headerRe.exec(source);
  if (!headerAfter) {
    throw new Error(
      `Assistant file is missing the \`${className}\` class declaration`,
    );
  }
  const bodyStart2 = headerAfter.index + headerAfter[0].length;
  const bodyEnd2 = findMatchingBrace(source, bodyStart2);
  if (bodyEnd2 === -1) {
    throw new Error(`Assistant file has unbalanced braces`);
  }

  const methodSrc = renderHelperMethod(spec, ns);
  const methodPattern = new RegExp(
    `\\n[\\t ]*public async Task<HttpResponseMessage> ${spec.helperMethodName}\\([^)]*\\)\\s*\\{`,
  );
  const region = source.slice(bodyStart2, bodyEnd2);
  const m = methodPattern.exec(region);
  if (m) {
    // Replace from the start of the matching method line to its closing
    // brace.
    const methodOpenInRegion = m.index + m[0].length;
    const methodCloseInRegion = findMatchingBrace(region, methodOpenInRegion);
    if (methodCloseInRegion === -1) {
      throw new Error(
        `Existing helper ${spec.helperMethodName} has unbalanced braces`,
      );
    }
    // Walk back to the start of the line for the method.
    let lineStart = m.index;
    while (lineStart > 0 && region[lineStart - 1] !== "\n") lineStart--;
    const absLineStart = bodyStart2 + lineStart;
    const absMethodEnd = bodyStart2 + methodCloseInRegion + 1;
    return (
      source.slice(0, absLineStart) +
      methodSrc +
      "\n" +
      source.slice(absMethodEnd)
    );
  }

  const insertion = `\n\n${methodSrc}\n`;
  return source.slice(0, bodyEnd2) + insertion + source.slice(bodyEnd2);
}

/** Compute the per-suite assistant class name for a given test class. */
export function assistantClassNameFor(testClassName: string): string {
  return `${testClassName}APITestingAssistants`;
}

/**
 * Render a brand-new per-suite assistant file containing the helper method.
 */
export function renderNewAssistantFile(
  spec: BuildApiTestSpec,
  ns: string,
  testClassName: string,
): string {
  ident(testClassName, "Test class name");
  const assistantClassName = assistantClassNameFor(testClassName);
  const methodSrc = renderHelperMethod(spec, ns);
  return `using System.Net.Http;
using ${ns}.Automation.API.Constants;
using ${ns}.Automation.API.Extensions;
using ${ns}.Automation.API.Infrastructure;

namespace ${ns}.Automation.API.Tests.APITestingAssistants;

/// <summary>
/// Per-suite HTTP helper surface for <c>${testClassName}</c>. Each method
/// wraps a single endpoint call and returns the raw
/// <see cref="HttpResponseMessage"/> so callers can assert against status,
/// headers, and payload without re-implementing transport plumbing.
/// </summary>
public class ${assistantClassName}
{
    private readonly ApiTestFixture _fixture;

    public ${assistantClassName}(ApiTestFixture fixture)
    {
        _fixture = fixture;
    }

${methodSrc}
}
`;
}
