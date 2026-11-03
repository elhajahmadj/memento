/**
 * Post-emit JMX validator.
 *
 * Two independent checks run against the serialized XML before it
 * touches disk:
 *
 *  1. Structural — re-tokenize the XML and walk the tag stack to
 *     confirm every non-leaf element is followed by a matching
 *     `<hashTree>...</hashTree>` (or `<hashTree/>`) sibling. JMeter
 *     refuses to open files where this pairing is wrong, so we'd
 *     rather block emission than write a broken plan.
 *  2. Credential leak — in `withoutCreds` mode, scan the serialized
 *     string for the captured username / password literal values and
 *     for any captured `Authorization: Bearer <token>` value. Either
 *     hit blocks emission with a clear error.
 *
 * No `xml2js` / `fast-xml-parser` dependency on purpose — we only
 * need to validate that *our own* serializer matches its grammar.
 */
import type {
  JmxExportOptions,
  JmxHttpEvent,
} from "@/features/jmx/domain/types";
import { scanAllCredentialLiterals } from "@/features/jmx/infrastructure/jmxIr";

export interface JmxValidationResult {
  ok: boolean;
  errors: string[];
}

/** Minimal tag-stream tokenizer covering open/close/self-closing tags. */
type Token =
  | { kind: "open"; tag: string }
  | { kind: "close"; tag: string }
  | { kind: "self"; tag: string };

function tokenize(xml: string): Token[] {
  const out: Token[] = [];
  // Match a tag: <tag ...>, </tag>, <tag .../>; skip <?xml ... ?> and <!-- -->.
  const re = /<\s*(\/?)([A-Za-z][A-Za-z0-9_-]*)\b[^<>]*?(\/?)\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const closing = m[1] === "/";
    const tag = m[2]!;
    const selfClose = m[3] === "/";
    if (closing) out.push({ kind: "close", tag });
    else if (selfClose) out.push({ kind: "self", tag });
    else out.push({ kind: "open", tag });
  }
  return out;
}

/**
 * Walk the token stream and check JMeter's hashTree pairing rule:
 * inside the body of any element other than `hashTree` itself, each
 * direct child element must be immediately followed by a `hashTree`
 * sibling (either self-closing or paired). We track this with a stack
 * of frames; each frame remembers the just-emitted child element and
 * whether the next sibling has already satisfied the pairing.
 */
function validateStructure(xml: string): string[] {
  const errors: string[] = [];
  const tokens = tokenize(xml);
  interface Frame {
    parent: string;
    /** The most recently opened/closed child tag awaiting a hashTree pair, or null. */
    pendingChild: string | null;
  }
  const stack: Frame[] = [];

  const childOpened = (tag: string) => {
    const frame = stack[stack.length - 1];
    if (!frame) return;
    if (frame.parent === "hashTree") {
      // Inside a hashTree, pairs are (element, hashTree). The hashTree
      // *is* the pairing element for the prior child — clear pending.
      if (tag === "hashTree") {
        frame.pendingChild = null;
      } else {
        if (frame.pendingChild !== null) {
          errors.push(
            `Element <${frame.pendingChild}> inside <hashTree> is missing its <hashTree> sibling (next sibling was <${tag}>)`,
          );
        }
        frame.pendingChild = tag;
      }
    }
  };

  for (const tok of tokens) {
    if (tok.kind === "open") {
      childOpened(tok.tag);
      stack.push({ parent: tok.tag, pendingChild: null });
    } else if (tok.kind === "self") {
      childOpened(tok.tag);
    } else {
      // close
      const frame = stack.pop();
      if (!frame) {
        errors.push(`Unmatched </${tok.tag}>`);
        continue;
      }
      if (frame.parent !== tok.tag) {
        errors.push(`Closing tag </${tok.tag}> does not match <${frame.parent}>`);
      }
      if (frame.parent === "hashTree" && frame.pendingChild !== null) {
        errors.push(
          `Element <${frame.pendingChild}> at end of <hashTree> is missing its <hashTree> sibling`,
        );
      }
    }
  }
  if (stack.length > 0) {
    errors.push(`Unclosed elements: ${stack.map((f) => f.parent).join(", ")}`);
  }
  return errors;
}

function scanForCredentialLeaks(
  xml: string,
  events: JmxHttpEvent[],
  options: JmxExportOptions,
): string[] {
  if (options.embedCredentials) return [];
  const errors: string[] = [];
  // Scan EVERY captured event for credential-shaped pairs (not just the
  // nominated login event) so the safety check still fires when the
  // project marker did not pin an explicit `loginPath`.
  const allCreds = scanAllCredentialLiterals(events);
  for (const creds of allCreds) {
    if (creds.username.length >= 3 && xml.includes(creds.username)) {
      errors.push(
        "Refusing to write JMX in 'withoutCreds' mode: captured username appears verbatim in the output",
      );
      break;
    }
  }
  for (const creds of allCreds) {
    if (creds.password.length >= 3 && xml.includes(creds.password)) {
      errors.push(
        "Refusing to write JMX in 'withoutCreds' mode: captured password appears verbatim in the output",
      );
      break;
    }
  }
  // Scan every event's Authorization header for a Bearer literal and make
  // sure it didn't get baked into the plan.
  for (const e of events) {
    const auth = e.headers["authorization"] ?? e.headers["Authorization"];
    if (!auth) continue;
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    const token = m?.[1];
    if (token && token.length >= 8 && xml.includes(token)) {
      errors.push(
        "Refusing to write JMX in 'withoutCreds' mode: captured bearer token appears verbatim in the output",
      );
      break;
    }
  }
  return errors;
}

export function validateJmxXml(
  xml: string,
  events: JmxHttpEvent[],
  options: JmxExportOptions,
): JmxValidationResult {
  const errors = [
    ...validateStructure(xml),
    ...scanForCredentialLeaks(xml, events, options),
  ];
  return { ok: errors.length === 0, errors };
}
