import type { BuildApiTestSpec } from "@/features/codegen/infrastructure/apiCsharpCodegen";
import { ident } from "./naming";

export function tsType(csType: string): string {
  switch (csType) {
    case "int":
    case "long":
    case "double":
    case "decimal":
      return "number";
    case "bool":
      return "boolean";
    case "Guid":
    case "DateTime":
    case "string":
      return "string";
    case "object":
      return "unknown";
    default:
      return csType;
  }
}

export function defaultArg(csType: string): string {
  const t = tsType(csType);
  if (t === "number") return "0";
  if (t === "boolean") return "false";
  if (t === "string") return '""';
  return "undefined as never";
}

export function endpointAccessor(spec: BuildApiTestSpec): string {
  return spec.endpointSection
    ? `ApiEndpoints.${spec.endpointSection}.${spec.endpointName}`
    : `ApiEndpoints.${spec.endpointName}`;
}

/**
 * Render the body of a single helper method on the per-suite assistant
 * class. Output uses the global `fetch` API and reads the access token
 * (when requested) via the shared fixture's settings.
 */
export function renderHelperMethod(spec: BuildApiTestSpec): string {
  ident(spec.helperMethodName, "Helper method name");
  for (const p of spec.parameters) ident(p.name, "Parameter name");
  if (spec.parameters.length > 10) {
    throw new Error("Helper methods accept at most 10 parameters");
  }

  const params = spec.parameters
    .map((p) => `${p.name}: ${tsType(p.type)}`)
    .join(", ");

  const pathExpr =
    spec.parameters.length > 0
      ? `formatPath(${endpointAccessor(spec)}, ${spec.parameters.map((p) => p.name).join(", ")})`
      : endpointAccessor(spec);

  const headerEntries: string[] = [];
  for (const h of spec.defaultHeaders) {
    headerEntries.push(
      `      ${JSON.stringify(h.name)}: ${JSON.stringify(h.value)},`,
    );
  }
  if (spec.useAccessToken) {
    headerEntries.push(
      `      "Authorization": \`Bearer \${getAccessToken(this.fixture.settings, ${JSON.stringify(spec.urlName)})}\`,`,
    );
  }

  const bodyLines: string[] = [];
  bodyLines.push(`    const path = ${pathExpr};`);
  if (spec.multipartFields.length > 0) {
    bodyLines.push(`    const form = new FormData();`);
    for (const f of spec.multipartFields) {
      ident(f.name, "Multipart field name");
      bodyLines.push(
        `    form.append(${JSON.stringify(f.name)}, String(${f.valueExpression}));`,
      );
    }
  }
  bodyLines.push(`    const init: RequestInit = {`);
  bodyLines.push(`      method: ${JSON.stringify(spec.httpMethod)},`);
  if (headerEntries.length > 0) {
    bodyLines.push(`      headers: {`);
    bodyLines.push(...headerEntries);
    bodyLines.push(`      },`);
  }
  if (spec.multipartFields.length > 0) {
    bodyLines.push(`      body: form,`);
  }
  bodyLines.push(`    };`);
  bodyLines.push(
    `    return this.fixture.send(${JSON.stringify(spec.urlName)}, path, init);`,
  );

  return `  async ${spec.helperMethodName}(${params}): Promise<Response> {
${bodyLines.join("\n")}
  }`;
}
