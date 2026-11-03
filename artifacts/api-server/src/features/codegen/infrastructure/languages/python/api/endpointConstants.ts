import {
  ensureTrailingNewline,
  insertBeforeLine,
  insertBlockBeforeLine,
} from "./fileUtils";
import { ident, pyStr } from "./naming";

// ─── api_endpoints.py upsert ────────────────────────────────────────────

/**
 * Insert (or update) a `Name = "/path"` attribute inside `class
 * ApiEndpoints:`. When `section` is non-empty the attribute is placed
 * inside a nested `class {section}:` (created if absent). Idempotent — an
 * existing same-named attribute at the target site is replaced.
 *
 * Indentation is fixed: 4 spaces for outer attributes, 8 for nested.
 */
export function upsertEndpointConstant(
  source: string,
  endpointName: string,
  endpointPath: string,
  section?: string | null,
): string {
  ident(endpointName, "Endpoint name");
  if (section) ident(section, "Endpoint section");

  if (!/class\s+ApiEndpoints\s*:/m.test(source)) {
    throw new Error(
      "constants/api_endpoints.py is missing `class ApiEndpoints:`",
    );
  }

  const lines = source.split("\n");
  const outerIdx = lines.findIndex((l) => /^class\s+ApiEndpoints\s*:/.test(l));
  // Outer body extent: every following line indented >= 4 spaces (or blank).
  let outerEnd = lines.length;
  for (let i = outerIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") continue;
    if (!/^[\t ]/.test(l)) {
      outerEnd = i;
      break;
    }
  }

  if (!section) {
    const attrRe = new RegExp(`^[ \\t]{4}${endpointName}\\s*=`);
    for (let i = outerIdx + 1; i < outerEnd; i++) {
      if (attrRe.test(lines[i])) {
        lines[i] = `    ${endpointName} = ${pyStr(endpointPath)}`;
        return ensureTrailingNewline(lines.join("\n"));
      }
    }
    return ensureTrailingNewline(
      insertBeforeLine(
        lines,
        outerEnd,
        `    ${endpointName} = ${pyStr(endpointPath)}`,
      ),
    );
  }

  // Locate or create the nested section class.
  const sectionRe = new RegExp(`^[ \\t]{4}class\\s+${section}\\s*:`);
  let sectionIdx = -1;
  for (let i = outerIdx + 1; i < outerEnd; i++) {
    if (sectionRe.test(lines[i])) {
      sectionIdx = i;
      break;
    }
  }
  if (sectionIdx === -1) {
    // Create the section right at the end of the outer body.
    const block = [
      `    class ${section}:`,
      `        ${endpointName} = ${pyStr(endpointPath)}`,
    ];
    return ensureTrailingNewline(insertBlockBeforeLine(lines, outerEnd, block));
  }

  let sectionEnd = outerEnd;
  for (let i = sectionIdx + 1; i < outerEnd; i++) {
    const l = lines[i];
    if (l.trim() === "") continue;
    if (!/^[\t ]{8}/.test(l)) {
      sectionEnd = i;
      break;
    }
  }
  // Drop a stub `pass` if it's the only body of an otherwise-empty section.
  let stripped = false;
  for (let i = sectionIdx + 1; i < sectionEnd; i++) {
    if (/^[ \t]{8}pass\s*$/.test(lines[i])) {
      lines.splice(i, 1);
      sectionEnd--;
      stripped = true;
      break;
    }
  }
  void stripped;
  const innerAttrRe = new RegExp(`^[ \\t]{8}${endpointName}\\s*=`);
  for (let i = sectionIdx + 1; i < sectionEnd; i++) {
    if (innerAttrRe.test(lines[i])) {
      lines[i] = `        ${endpointName} = ${pyStr(endpointPath)}`;
      return ensureTrailingNewline(lines.join("\n"));
    }
  }
  return ensureTrailingNewline(
    insertBeforeLine(
      lines,
      sectionEnd,
      `        ${endpointName} = ${pyStr(endpointPath)}`,
    ),
  );
}
