import type {
  AiRunStep,
  AiTestKind,
} from "@/features/ai-agent/domain/types";

/**
 * Lightweight rule-based parser. Recognises the most common shapes
 * the AI Test Runner concept doc enumerates so we don't need to ping
 * an LLM for every line. Lines we can't match get marked
 * `matchType: "none"` and are forwarded to the LLM fallback.
 */

export interface ParsedLine {
  raw: string;
  step: Omit<AiRunStep, "index" | "result">;
}

const PLAYWRIGHT_PATTERNS: Array<{
  re: RegExp;
  build: (m: RegExpMatchArray) => Omit<AiRunStep, "index" | "result">;
}> = [
  {
    re: /^(?:navigate|go|open|visit|browse)\s+(?:to\s+)?['"`]?([^'"`]+?)['"`]?\s*$/i,
    build: (m) => {
      const raw = m[1]!.trim();
      // Default bare hosts (google.com, www.google.com) to https://
      const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
      return {
        input: m[0]!,
        method: {
          name: "NavigateTo",
          source: "existing",
          matchType: "exact",
        },
        playwrightCalls: [{ method: "page.goto", args: [url] }],
      };
    },
  },
  {
    // "click X", "click on the X button", "click 'X' link", "click login button"
    re: /^click\s+(?:on\s+)?(?:the\s+)?['"`]?(.+?)['"`]?(?:\s+(?:button|link|tab|icon|menu|item|element|option))?\s*$/i,
    build: (m) => {
      const target = m[1]!.trim().replace(/\s+(?:button|link|tab|icon|menu|item|element|option)$/i, "");
      const selector = `text=${target}`;
      return {
        input: m[0]!,
        method: {
          name: `Click${pascal(target)}`,
          source: "ai-created",
          matchType: "semantic",
          confidence: 0.7,
        },
        playwrightCalls: [
          { method: "page.click", selector, rawSelector: selector },
        ],
      };
    },
  },
  {
    // Handles all of:
    //   "fill username field with alice"
    //   "fill the 'username' textfield with 'alice@x.com'"
    //   "fill in username textbox with foo"
    //   "enter username 'alice' in username text field"
    //   "type alice into the username input"
    //   "set username to alice"
    re: /^(?:fill\s+(?:in\s+)?(?:the\s+)?['"`]?(.+?)['"`]?\s*(?:field|input|textfield|textbox|text\s*field|text\s*box|box)?\s+(?:with|to)\s+['"`]?(.+?)['"`]?|(?:enter|type|input|set)\s+['"`]?(.+?)['"`]?\s+(?:in(?:to)?|on|for|as)\s+(?:the\s+)?['"`]?(.+?)['"`]?(?:\s*(?:field|input|textfield|textbox|text\s*field|text\s*box|box))?)\s*$/i,
    build: (m) => {
      // Two alternatives: (1) fill F with V    or    (2) enter V in F
      const field = (m[1] ?? m[4] ?? "").trim();
      const value = (m[2] ?? m[3] ?? "").trim();
      const selector = `[name="${camel(field)}"]`;
      return {
        input: m[0]!,
        method: {
          name: `Fill${pascal(field)}`,
          source: "ai-created",
          matchType: "semantic",
          confidence: 0.65,
        },
        inputs: [{ field, value }],
        playwrightCalls: [
          {
            method: "page.fill",
            selector,
            rawSelector: selector,
            value,
          },
        ],
      };
    },
  },
  {
    // "assert url contains google", "url has google", "expect page url to be /home"
    re: /^(?:(?:expect|verify|check(?:\s+that)?|assert)\s+(?:the\s+)?)?(?:url|page\s*url)\s+(?:to\s+)?(?:should\s+)?(?:contain|contains|has|have|equal|equals|equals?\s+to|be|is|=)\s+['"`]?([^'"`]+?)['"`]?\s*$/i,
    build: (m) => ({
      input: m[0]!,
      method: {
        name: "AssertUrlContains",
        source: "existing",
        matchType: "exact",
      },
      playwrightCalls: [
        {
          method: "expect.toHaveURL",
          args: [m[1]!.trim()],
        },
      ],
    }),
  },
  {
    re: /^(?:expect|verify|check that|assert) ['"`]?([^'"`]+?)['"`]? (?:to be )?(?:visible|appears|is shown)/i,
    build: (m) => {
      const target = m[1]!.trim();
      const selector = `text=${target}`;
      return {
        input: m[0]!,
        method: {
          name: `AssertVisible${pascal(target)}`,
          source: "ai-created",
          matchType: "semantic",
          confidence: 0.7,
        },
        playwrightCalls: [
          {
            method: "expect.toBeVisible",
            selector,
            rawSelector: selector,
          },
        ],
      };
    },
  },
  {
    re: /^login as ([\w@.\-]+)(?:\s*\/\s*(\S+))?/i,
    build: (m) => ({
      input: m[0]!,
      method: {
        name: `LoginAs${pascal(m[1]!.split("@")[0]!)}`,
        source: "existing",
        matchType: "semantic",
        confidence: 0.85,
        params: { username: m[1]!, password: m[2] ?? "***" },
      },
    }),
  },
];

const API_PATTERNS: Array<{
  re: RegExp;
  build: (m: RegExpMatchArray) => Omit<AiRunStep, "index" | "result">;
}> = [
  {
    re: /^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)(?:\s+with\s+(.+?))?(?:\s+(?:returns?|expect)\s+(\d{3}))?\s*$/i,
    build: (m) => {
      const method = m[1]!.toUpperCase();
      const url = m[2]!;
      const body = m[3]?.trim();
      const status = m[4] ? Number(m[4]) : 200;
      return {
        input: m[0]!,
        method: {
          name: `${pascal(method.toLowerCase())}${pascalFromUrl(url)}`,
          source: "ai-created",
          matchType: "exact",
        },
        httpCalls: [
          {
            method,
            url,
            body: body ? safeJsonParse(body) : undefined,
            status,
          },
        ],
      };
    },
  },
  {
    re: /^expect (?:the )?(?:status|response status) (?:to be |is |= )?(\d{3})/i,
    build: (m) => ({
      input: m[0]!,
      method: {
        name: `ExpectStatus${m[1]}`,
        source: "existing",
        matchType: "exact",
      },
      httpCalls: [{ method: "ASSERT", url: "(previous)", status: Number(m[1]) }],
    }),
  },
];

const UNIT_PATTERNS: Array<{
  re: RegExp;
  build: (m: RegExpMatchArray) => Omit<AiRunStep, "index" | "result">;
}> = [
  {
    re: /^(\w+)\s*\(([^)]*)\)\s+(?:returns?|=>|equals?|should equal)\s+(.+?)\s*$/i,
    build: (m) => {
      const fn = m[1]!;
      const argsRaw = m[2]!.trim();
      const expected = m[3]!.trim();
      const args = argsRaw
        ? argsRaw.split(",").map((a) => safeJsonParse(a.trim()))
        : [];
      return {
        input: m[0]!,
        method: {
          name: `${pascal(fn)}Returns${pascal(simpleSlug(expected))}`,
          source: "ai-created",
          matchType: "exact",
        },
        unitCalls: [
          {
            function: fn,
            args,
            expected: safeJsonParse(expected),
          },
        ],
      };
    },
  },
];

/**
 * Strip leading list markers that humans naturally add when writing
 * plans — "1. ", "1) ", "1-", "1 - ", "- ", "* ", "• ", "[ ] ". Without
 * this, the rule parser sees "1- go to google.com" and fails to match
 * the "go to ..." regex, leaving every step "Unrecognized" → skipped →
 * empty test file. (This was a real production bug.)
 */
function stripListMarker(line: string): string {
  return line
    .replace(/^[\u2022\u25e6\u2013\u2014>*\-+]\s+/, "") // - * + • ‣ — > etc.
    .replace(/^\[\s?[xX ]?\s?\]\s+/, "") // checkbox
    .replace(/^\d+\s*[.)\-:]\s*/, "") // "1. ", "1) ", "1- ", "1 - ", "1: "
    .replace(/^step\s+\d+\s*[.:\-)]?\s*/i, "") // "Step 1: ", "Step 2 - "
    .trim();
}

export function parsePlan(plan: string, kind: AiTestKind): ParsedLine[] {
  const lines = plan
    .split(/\r?\n/)
    .map((l) => stripListMarker(l.trim()))
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const patterns =
    kind === "playwright"
      ? PLAYWRIGHT_PATTERNS
      : kind === "api"
        ? API_PATTERNS
        : UNIT_PATTERNS;

  return lines.map((raw): ParsedLine => {
    for (const { re, build } of patterns) {
      const m = raw.match(re);
      if (m) return { raw, step: build(m) };
    }
    return {
      raw,
      step: {
        input: raw,
        method: {
          name: "Unrecognized",
          source: "ai-created",
          matchType: "none",
        },
      },
    };
  });
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

export function pascal(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

export function camel(input: string): string {
  const p = pascal(input);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function pascalFromUrl(url: string): string {
  return pascal(url.replace(/[\/{}:?&=]/g, " "));
}

function simpleSlug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "Value";
}

function safeJsonParse(s: string): unknown {
  const t = s.trim();
  try {
    return JSON.parse(t);
  } catch {
    if (/^\d+$/.test(t)) return Number(t);
    if (/^(true|false)$/i.test(t)) return /^true$/i.test(t);
    return t.replace(/^['"`]|['"`]$/g, "");
  }
}
