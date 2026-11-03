import { API_PYTHON_HELPER_DIR } from "@/features/projects/infrastructure/apiPythonScaffolder";
import type { BuildApiTestSpec } from "@/features/codegen/infrastructure/apiCsharpCodegen";
import { ensureTrailingNewline } from "./fileUtils";
import {
  HTTP_VERBS,
  assistantClassNameFor,
  ident,
  pyMethodName,
  pyStr,
} from "./naming";

// ─── helper assistant rendering ─────────────────────────────────────────

function endpointRefPy(spec: BuildApiTestSpec): string {
  return spec.endpointSection
    ? `ApiEndpoints.${spec.endpointSection}.${spec.endpointName}`
    : `ApiEndpoints.${spec.endpointName}`;
}

/** Render a single helper method for a Python assistant class. */
export function renderHelperMethod(spec: BuildApiTestSpec): string {
  ident(spec.helperMethodName, "Helper method name");
  for (const p of spec.parameters) ident(p.name, "Parameter name");
  if (spec.parameters.length > 10) {
    throw new Error("Helper methods accept at most 10 parameters");
  }
  if (!HTTP_VERBS.includes(spec.httpMethod)) {
    throw new Error(`Unsupported HTTP verb: ${spec.httpMethod}`);
  }
  const methodName = pyMethodName(spec.helperMethodName);
  const paramSig = spec.parameters
    .map((p) => `, ${p.name}`)
    .join("");

  const endpointRef = endpointRefPy(spec);
  const pathExpr =
    spec.parameters.length > 0
      ? `${endpointRef}.format(${spec.parameters.map((p) => p.name).join(", ")})`
      : endpointRef;

  const headerEntries: string[] = [];
  for (const h of spec.defaultHeaders) {
    headerEntries.push(`            ${pyStr(h.name)}: ${pyStr(h.value)},`);
  }
  if (spec.useAccessToken) {
    headerEntries.push(
      `            "Authorization": f"Bearer {get_access_token(self._fixture.configuration, ${pyStr(spec.urlName)})}",`,
    );
  }
  const headersBlock = headerEntries.length
    ? `        headers = {\n${headerEntries.join("\n")}\n        }\n`
    : "        headers = {}\n";

  const multipartBlock =
    spec.multipartFields.length > 0
      ? `        files = {\n${spec.multipartFields
          .map((f) => {
            ident(f.name, "Multipart field name");
            return `            ${pyStr(f.name)}: (None, ${f.valueExpression}),`;
          })
          .join("\n")}\n        }\n`
      : "";

  const requestKwargs = [
    "headers=headers",
    multipartBlock ? "files=files" : null,
  ]
    .filter(Boolean)
    .join(", ");

  const verb = spec.httpMethod.toLowerCase();
  return `    async def ${methodName}(self${paramSig}):
        client = self._fixture.get_client(${pyStr(spec.urlName)})
${headersBlock}${multipartBlock}        return await client.${verb}(${pathExpr}${requestKwargs ? `, ${requestKwargs}` : ""})`;
}

/** Render a brand-new per-suite assistant file. */
export function renderNewAssistantFile(
  spec: BuildApiTestSpec,
  testClassName: string,
): string {
  ident(testClassName, "Test class name");
  const className = assistantClassNameFor(testClassName);
  return `"""
Per-suite HTTP helper surface for ${testClassName}. Each method wraps a
single endpoint call and returns the raw httpx.Response so callers can
assert on status, headers, and payload without re-implementing transport
plumbing.
"""
from ${API_PYTHON_HELPER_DIR}.constants.api_endpoints import ApiEndpoints
from ${API_PYTHON_HELPER_DIR}.extensions.configuration_extensions import get_access_token
from ${API_PYTHON_HELPER_DIR}.infrastructure.api_test_fixture import ApiTestFixture


class ${className}:
    def __init__(self, fixture: ApiTestFixture):
        self._fixture = fixture

${renderHelperMethod(spec)}
`;
}

/**
 * Append (or replace) a helper method on an existing per-suite assistant
 * class. If a method with the same name already exists, it is replaced.
 */
export function upsertHelperMethod(
  source: string,
  spec: BuildApiTestSpec,
  className: string,
): string {
  const headerRe = new RegExp(`^class\\s+${className}\\s*[:(]`, "m");
  if (!headerRe.test(source)) {
    throw new Error(
      `Assistant file is missing the \`${className}\` class declaration`,
    );
  }
  const methodName = pyMethodName(spec.helperMethodName);
  const newMethod = renderHelperMethod(spec);

  const lines = source.split("\n");
  // Find existing method (start of `    async def {methodName}(`).
  const startRe = new RegExp(`^[ \\t]{4}async\\s+def\\s+${methodName}\\s*\\(`);
  const startIdx = lines.findIndex((l) => startRe.test(l));
  if (startIdx !== -1) {
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === "") continue;
      if (!/^[\t ]{8}/.test(l) && !/^[\t ]{4}(async\s+def|def|class|@)/.test(l) && !/^[\t ]{0,4}\S/.test(l)) {
        continue;
      }
      // Stop at a line that is *not* indented deeper than the def header
      // (i.e. another sibling method/class or top-level content).
      if (/^[ \t]{0,4}\S/.test(l) && !/^[\t ]{8}/.test(l)) {
        endIdx = i;
        break;
      }
    }
    return ensureTrailingNewline(
      [
        ...lines.slice(0, startIdx),
        newMethod,
        ...lines.slice(endIdx),
      ].join("\n"),
    );
  }

  // Append at end of file (assistant file ends after the class body).
  const trimmed = source.replace(/\n+$/, "");
  return ensureTrailingNewline(`${trimmed}\n\n${newMethod}\n`);
}
