import type { AiRunStep } from "@/features/ai-agent/domain/types";

/**
 * Derive a `Given<StartingPoint>_When<Action>_Then<Assertion>`-shaped
 * PascalCase method name from a parsed plan. The starting point comes
 * from the first navigate step (or the suite name when there is none),
 * the action comes from the dominant Click/Fill step, and the
 * assertion comes from the trailing Assert step.
 *
 * Always falls back to a sensible default rather than throwing — the
 * normalizer is also applied to LLM-supplied names to coerce
 * non-conforming output back into shape.
 */
export function deriveGivenWhenThen(
  steps: AiRunStep[],
  suiteName: string,
): string {
  const given = pickGiven(steps, suiteName);
  const when = pickWhen(steps);
  const then = pickThen(steps);
  return `Given${given}_When${when}_Then${then}`;
}

/**
 * Coerce an arbitrary identifier into the `Given_When_Then` shape. If
 * the LLM returned `Given..._When..._Then...`, return it cleaned;
 * otherwise derive from steps/suite.
 */
export function normalizeGivenWhenThen(
  candidate: string | null | undefined,
  steps: AiRunStep[],
  suiteName: string,
): string {
  const c = (candidate ?? "").trim();
  if (c) {
    const cleaned = c.replace(/[^A-Za-z0-9_]/g, "");
    // Accept any valid identifier the caller supplied verbatim — the
    // "Build with AI" dialog lets users type an explicit method name,
    // and that name must round-trip unchanged. The Given_When_Then
    // template is only used as the auto-derived fallback when the
    // caller leaves the field blank.
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)) {
      return cleaned;
    }
  }
  return deriveGivenWhenThen(steps, suiteName);
}

function pickGiven(steps: AiRunStep[], suiteName: string): string {
  for (const s of steps) {
    for (const c of s.playwrightCalls ?? []) {
      if (c.method === "page.goto" && c.args?.[0]) {
        const u = String(c.args[0]);
        try {
          const host = new URL(
            /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`,
          ).hostname.replace(/^www\./i, "");
          const brand = host.split(".")[0] ?? "";
          if (brand) return pascal(brand);
        } catch {
          /* fallthrough */
        }
      }
    }
  }
  return pascal(stripSuiteSuffix(suiteName)) || "Suite";
}

function pickWhen(steps: AiRunStep[]): string {
  // Prefer the last Click step, else the last Fill, else any non-goto action.
  let lastClick: AiRunStep | null = null;
  let lastFill: AiRunStep | null = null;
  let anyAction: AiRunStep | null = null;
  for (const s of steps) {
    for (const c of s.playwrightCalls ?? []) {
      if (c.method === "page.click") lastClick = s;
      else if (c.method === "page.fill") lastFill = s;
      else if (c.method !== "page.goto") anyAction = s;
    }
  }
  const target = lastClick ?? lastFill ?? anyAction;
  if (target) {
    const name = target.method?.name ?? "";
    const stripped = name.replace(/^(Click|Fill|Set|Enter|Type|Assert)/, "");
    if (stripped) return pascal(stripped);
    if (name) return pascal(name);
  }
  return "Acting";
}

function pickThen(steps: AiRunStep[]): string {
  // Last assertion step wins.
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    for (const c of s.playwrightCalls ?? []) {
      if (
        c.method === "expect.toBeVisible" ||
        c.method === "expect.toHaveURL"
      ) {
        const name = s.method?.name ?? "";
        const stripped = name.replace(/^(Assert|Expect|Verify|Check)/, "");
        if (stripped) return pascal(stripped);
        if (c.method === "expect.toHaveURL") return "UrlMatches";
        return "Visible";
      }
    }
    for (const c of s.httpCalls ?? []) {
      if (c.status) return `Status${c.status}`;
    }
    for (const c of s.unitCalls ?? []) {
      if (c.expected !== undefined)
        return `Returns${pascal(String(c.expected).slice(0, 16) || "Value")}`;
    }
  }
  return "Succeeds";
}

function pascal(s: string): string {
  return (s ?? "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function stripSuiteSuffix(s: string): string {
  return (s ?? "").replace(/Tests?$/i, "");
}
