// Per-endpoint helper method body rendering.
import type {
  BuildApiTestSpec,
  HttpVerb,
} from "@/features/codegen/infrastructure/apiCsharpCodegen";
import { HTTP_VERBS, ident } from "./apiShared";

function verbBuilderCall(v: HttpVerb): string {
  switch (v) {
    case "GET":
      return ".GET()";
    case "DELETE":
      return ".DELETE()";
    case "POST":
    case "PUT":
    case "PATCH":
      return `.method(${JSON.stringify(v)}, bodyPublisher)`;
    case "HEAD":
    case "OPTIONS":
      return `.method(${JSON.stringify(v)}, java.net.http.HttpRequest.BodyPublishers.noBody())`;
  }
}

function endpointRef(spec: BuildApiTestSpec): string {
  return spec.endpointSection
    ? `ApiEndpoints.${spec.endpointSection}.${spec.endpointName}`
    : `ApiEndpoints.${spec.endpointName}`;
}

/** Render the helper method body for a single endpoint. */
export function renderHelperMethodJava(spec: BuildApiTestSpec): string {
  ident(spec.helperMethodName, "Helper method name");
  for (const p of spec.parameters) ident(p.name, "Parameter name");
  if (spec.parameters.length > 10) {
    throw new Error("Helper methods accept at most 10 parameters");
  }
  if (!HTTP_VERBS.includes(spec.httpMethod)) {
    throw new Error(`Unsupported HTTP verb: ${spec.httpMethod}`);
  }

  const params = spec.parameters
    .map((p) => `${p.type} ${p.name}`)
    .join(", ");
  const ref = endpointRef(spec);
  const formatArgs = spec.parameters.map((p) => p.name).join(", ");
  const pathExpr =
    spec.parameters.length > 0
      ? `String.format(${ref}, ${formatArgs})`
      : ref;

  const lines: string[] = [];
  const hasBody = ["POST", "PUT", "PATCH"].includes(spec.httpMethod);

  if (hasBody && spec.multipartFields.length > 0) {
    lines.push(
      `        String boundary = "----testbuilder" + System.currentTimeMillis();`,
    );
    lines.push(`        StringBuilder bodyBuilder = new StringBuilder();`);
    for (const f of spec.multipartFields) {
      ident(f.name, "Multipart field name");
      lines.push(
        `        bodyBuilder.append("--").append(boundary).append("\\r\\n");`,
      );
      lines.push(
        `        bodyBuilder.append("Content-Disposition: form-data; name=\\"${f.name}\\"\\r\\n\\r\\n");`,
      );
      lines.push(
        `        bodyBuilder.append(String.valueOf(${f.valueExpression})).append("\\r\\n");`,
      );
    }
    lines.push(
      `        bodyBuilder.append("--").append(boundary).append("--\\r\\n");`,
    );
    lines.push(
      `        java.net.http.HttpRequest.BodyPublisher bodyPublisher = java.net.http.HttpRequest.BodyPublishers.ofString(bodyBuilder.toString());`,
    );
  } else if (hasBody) {
    lines.push(
      `        java.net.http.HttpRequest.BodyPublisher bodyPublisher = java.net.http.HttpRequest.BodyPublishers.noBody();`,
    );
  }

  lines.push(
    `        java.net.http.HttpRequest.Builder builder = java.net.http.HttpRequest.newBuilder()`,
  );
  lines.push(
    `            .uri(java.net.URI.create(fixture.getOptions(${JSON.stringify(spec.urlName)}).baseUrl + ${pathExpr}))`,
  );
  lines.push(`            ${verbBuilderCall(spec.httpMethod)};`);

  if (hasBody && spec.multipartFields.length > 0) {
    lines.push(
      `        builder.header("Content-Type", "multipart/form-data; boundary=" + boundary);`,
    );
  }
  for (const h of spec.defaultHeaders) {
    lines.push(
      `        builder.header(${JSON.stringify(h.name)}, ${JSON.stringify(h.value)});`,
    );
  }
  if (spec.useAccessToken) {
    lines.push(
      `        builder.header("Authorization", "Bearer " + ConfigurationExtensions.getAccessToken(fixture.getConfiguration(), ${JSON.stringify(spec.urlName)}));`,
    );
  }
  lines.push(
    `        return fixture.getClient(${JSON.stringify(spec.urlName)}).send(builder.build(), java.net.http.HttpResponse.BodyHandlers.ofString());`,
  );

  return `    public java.net.http.HttpResponse<String> ${spec.helperMethodName}(${params}) throws java.io.IOException, InterruptedException {
${lines.join("\n")}
    }`;
}
