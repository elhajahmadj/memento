import { ident } from "./naming";
import { findMatchingBrace, insertAtClose, replaceEntryIfPresent } from "./braces";

/**
 * Insert (or update) a `Name: "path",` entry inside the `ApiEndpoints`
 * object in `src/automation-api/constants/api-endpoints.ts`. When
 * `section` is non-empty the entry is placed inside a nested
 * `Section: { ... }` block (created if absent). Idempotent.
 */
export function upsertEndpointConstant(
  source: string,
  endpointName: string,
  endpointPath: string,
  section?: string | null,
): string {
  ident(endpointName, "Endpoint name");
  if (section) ident(section, "Endpoint section");

  const outerHeader = /export const ApiEndpoints\s*=\s*\{/m.exec(source);
  if (!outerHeader) {
    throw new Error(
      "constants/api-endpoints.ts is missing `export const ApiEndpoints = {`",
    );
  }
  const outerBodyStart = outerHeader.index + outerHeader[0].length;
  const outerClose = findMatchingBrace(source, outerBodyStart);
  if (outerClose === -1) {
    throw new Error("constants/api-endpoints.ts has unbalanced braces");
  }

  const valueLiteral = JSON.stringify(endpointPath);

  if (!section) {
    const replaced = replaceEntryIfPresent(
      source,
      outerBodyStart,
      outerClose,
      endpointName,
      `  ${endpointName}: ${valueLiteral},`,
    );
    if (replaced !== null) return replaced;
    const insertion = `  ${endpointName}: ${valueLiteral},\n`;
    return insertAtClose(source, outerClose, insertion);
  }

  // Locate the inner `Section: {` block.
  const sectionPattern = new RegExp(
    `(^|[\\s,])${section}\\s*:\\s*\\{`,
    "m",
  );
  const region = source.slice(outerBodyStart, outerClose);
  const sectionMatch = sectionPattern.exec(region);
  const entryLine = `    ${endpointName}: ${valueLiteral},`;
  if (sectionMatch) {
    const sectionOpenInRegion = sectionMatch.index + sectionMatch[0].length;
    const sectionBodyStart = outerBodyStart + sectionOpenInRegion;
    const sectionClose = findMatchingBrace(source, sectionBodyStart);
    if (sectionClose === -1) {
      throw new Error(
        `Section ${section} in api-endpoints.ts has unbalanced braces`,
      );
    }
    const replaced = replaceEntryIfPresent(
      source,
      sectionBodyStart,
      sectionClose,
      endpointName,
      entryLine,
    );
    if (replaced !== null) return replaced;
    const insertion = `    ${endpointName}: ${valueLiteral},\n  `;
    return source.slice(0, sectionClose) + insertion + source.slice(sectionClose);
  }

  // No section yet — emit a fresh nested object before the outer close.
  const block = `  ${section}: {\n${entryLine}\n  },\n`;
  return insertAtClose(source, outerClose, block);
}
