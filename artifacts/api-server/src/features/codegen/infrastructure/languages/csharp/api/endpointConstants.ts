import { ident } from "./naming";
import { findMatchingBrace, replaceConstantIfPresent } from "./csSource";

/** Build a single endpoint constant declaration. */
export function renderEndpointConstant(
  endpointName: string,
  endpointPath: string,
): string {
  ident(endpointName, "Endpoint name");
  return `    public const string ${endpointName} = ${JSON.stringify(endpointPath)};`;
}

/**
 * Insert (or update) a `public const string {name} = "...";` line into the
 * given C# source. When `section` is non-empty, the constant is placed
 * inside `public static class {section}` (created if absent). Idempotent:
 * if a constant with the same `name` already exists at the target site, it
 * is replaced.
 */
export function upsertEndpointConstant(
  source: string,
  endpointName: string,
  endpointPath: string,
  section?: string | null,
): string {
  ident(endpointName, "Endpoint name");
  if (section) ident(section, "Endpoint section");

  // Locate the outer `public static class ApiEndpoints` block.
  const outerHeader = /public static class ApiEndpoints\s*\{/m.exec(source);
  if (!outerHeader) {
    throw new Error(
      "Constants/ApiEndpoints.cs is missing `public static class ApiEndpoints {`",
    );
  }
  const outerBodyStart = outerHeader.index + outerHeader[0].length;

  // Find the matching closing brace of the outer class.
  const outerClose = findMatchingBrace(source, outerBodyStart);
  if (outerClose === -1) {
    throw new Error("Constants/ApiEndpoints.cs has unbalanced braces");
  }

  const constLine = `        public const string ${endpointName} = ${JSON.stringify(endpointPath)};`;

  if (!section) {
    const replaced = replaceConstantIfPresent(
      source,
      outerBodyStart,
      outerClose,
      endpointName,
      `    public const string ${endpointName} = ${JSON.stringify(endpointPath)};`,
    );
    if (replaced !== null) return replaced;
    const insertion = `\n    public const string ${endpointName} = ${JSON.stringify(endpointPath)};\n`;
    return source.slice(0, outerClose) + insertion + source.slice(outerClose);
  }

  // Locate the inner section class.
  const sectionPattern = new RegExp(
    `public static class ${section}\\s*\\{`,
    "m",
  );
  const sectionMatch = sectionPattern.exec(source.slice(0, outerClose));
  if (sectionMatch) {
    const sectionBodyStart =
      sectionMatch.index + sectionMatch[0].length;
    const sectionClose = findMatchingBrace(source, sectionBodyStart);
    if (sectionClose === -1) {
      throw new Error(
        `Section class ${section} in ApiEndpoints.cs has unbalanced braces`,
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

  // No section yet — emit a fresh nested class right before the outer close.
  const block =
    `\n    public static class ${section}\n    {\n${constLine}\n    }\n`;
  return source.slice(0, outerClose) + block + source.slice(outerClose);
}
