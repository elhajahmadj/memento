// Per-endpoint constants management for `ApiEndpoints.java`.
import {
  JAVA_IDENT,
  findMatchingBrace,
  ident,
  replaceConstantIfPresent,
} from "./apiShared";

/** Render a single endpoint constant declaration. */
export function renderEndpointConstant(
  endpointName: string,
  endpointPath: string,
): string {
  ident(endpointName, "Endpoint name");
  return `    public static final String ${endpointName} = ${JSON.stringify(endpointPath)};`;
}

/**
 * Insert (or update) a `public static final String {name} = "...";` line
 * into the given Java source. When `section` is non-empty, the constant
 * is placed inside `public static final class {section}` (created if
 * absent). Idempotent: if a constant with the same `name` already exists
 * at the target site, it is replaced.
 */
export function upsertEndpointConstantJava(
  source: string,
  endpointName: string,
  endpointPath: string,
  section?: string | null,
): string {
  ident(endpointName, "Endpoint name");
  if (section) ident(section, "Endpoint section");

  const outerHeader =
    /public\s+final\s+class\s+ApiEndpoints\s*\{|public\s+class\s+ApiEndpoints\s*\{/m.exec(
      source,
    );
  if (!outerHeader) {
    throw new Error(
      "constants/ApiEndpoints.java is missing `public final class ApiEndpoints {`",
    );
  }
  const outerBodyStart = outerHeader.index + outerHeader[0].length;
  const outerClose = findMatchingBrace(source, outerBodyStart);
  if (outerClose === -1) {
    throw new Error("constants/ApiEndpoints.java has unbalanced braces");
  }

  if (!section) {
    const replaced = replaceConstantIfPresent(
      source,
      outerBodyStart,
      outerClose,
      endpointName,
      `    public static final String ${endpointName} = ${JSON.stringify(endpointPath)};`,
    );
    if (replaced !== null) return replaced;
    const insertion = `\n    public static final String ${endpointName} = ${JSON.stringify(endpointPath)};\n`;
    return source.slice(0, outerClose) + insertion + source.slice(outerClose);
  }

  const sectionPattern = new RegExp(
    `public\\s+static\\s+final\\s+class\\s+${section}\\s*\\{`,
    "m",
  );
  const sectionMatch = sectionPattern.exec(source.slice(0, outerClose));
  const constLine = `        public static final String ${endpointName} = ${JSON.stringify(endpointPath)};`;
  if (sectionMatch) {
    const sectionBodyStart = sectionMatch.index + sectionMatch[0].length;
    const sectionClose = findMatchingBrace(source, sectionBodyStart);
    if (sectionClose === -1) {
      throw new Error(
        `Section class ${section} in ApiEndpoints.java has unbalanced braces`,
      );
    }
    const replaced = replaceConstantIfPresent(
      source,
      sectionBodyStart,
      sectionClose,
      endpointName,
      constLine,
    );
    if (replaced !== null) return replaced;
    const insertion = `\n${constLine}\n    `;
    return (
      source.slice(0, sectionClose) + insertion + source.slice(sectionClose)
    );
  }

  // Silence unused-import warning when constant is left as a literal.
  void JAVA_IDENT;
  const block =
    `\n    public static final class ${section} {\n${constLine}\n    }\n`;
  return source.slice(0, outerClose) + block + source.slice(outerClose);
}
