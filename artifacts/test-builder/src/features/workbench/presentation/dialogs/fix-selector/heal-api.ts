import type {
  AiApplyMetadata,
  AiAvailability,
  AiSuggestion,
  FixSelectorContext,
  HealResult,
  HealVia,
  RepickPickResult,
  RepickStartResult,
} from "./types";

export async function fetchHealPreview(
  oldSelector: string,
  newSelector: string,
): Promise<HealResult> {
  const r = await fetch("/api/selectors/heal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ oldSelector, newSelector, dryRun: true }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as HealResult;
}

/**
 * Apply a heal. `via` tags the heal with the UI path that produced it
 * (ai / repick / advanced) so the server-side audit row shows which
 * path the user took. AI applies additionally forward the
 * suggestion's provider / model / confidence / token counts so the
 * audit row carries full provenance.
 */
export async function applyHeal(
  oldSelector: string,
  newSelector: string,
  via: HealVia,
  aiMeta?: AiApplyMetadata,
): Promise<HealResult> {
  const r = await fetch("/api/selectors/heal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      oldSelector,
      newSelector,
      via,
      ...(via === "ai" && aiMeta
        ? {
            aiProvider: aiMeta.provider,
            aiModel: aiMeta.model,
            aiConfidence: aiMeta.confidence,
            aiTokensIn: aiMeta.tokensIn,
            aiTokensOut: aiMeta.tokensOut,
          }
        : {}),
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as HealResult;
}

export interface AiSuggestError {
  message: string;
  kind: string | null;
  status: number;
}

export async function fetchAiAvailability(): Promise<AiAvailability> {
  try {
    const r = await fetch("/api/selectors/heal/ai-available", {
      credentials: "include",
    });
    if (!r.ok) {
      return {
        available: false,
        reason: "http_error",
        message: `Couldn't check AI availability (HTTP ${r.status}).`,
      };
    }
    return (await r.json()) as AiAvailability;
  } catch (e) {
    return {
      available: false,
      reason: "network",
      message: (e as Error).message,
    };
  }
}

export async function aiSuggestSelector(
  ctx: FixSelectorContext,
): Promise<AiSuggestion> {
  const r = await fetch("/api/selectors/heal/ai-suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      oldSelector: ctx.selector,
      actionDescription: ctx.actionDescription ?? null,
      errorMessage: ctx.errorMessage ?? null,
      pageUrl: ctx.pageUrl ?? null,
      domSnippet: ctx.domSnippet ?? null,
      priorSteps: ctx.priorSteps ?? [],
    }),
  });
  if (!r.ok) {
    let body: { error?: string; kind?: string } = {};
    try {
      body = (await r.json()) as { error?: string; kind?: string };
    } catch {
      /* fallthrough */
    }
    const e: AiSuggestError = {
      message: body.error ?? `Request failed (HTTP ${r.status})`,
      kind: body.kind ?? null,
      status: r.status,
    };
    throw e;
  }
  return (await r.json()) as AiSuggestion;
}

export function isAiSuggestError(e: unknown): e is AiSuggestError {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    typeof (e as { status: unknown }).status === "number"
  );
}

export function summarizeApply(data: HealResult): string {
  const fileTotal = data.fileDetails.reduce((s, d) => s + d.replacements, 0);
  const fileSuffix =
    fileTotal > 0
      ? ` and ${fileTotal} occurrence${fileTotal === 1 ? "" : "s"} in ${data.filesChanged} selectors file${data.filesChanged === 1 ? "" : "s"}`
      : "";
  return `Replaced ${data.totalReplacements} occurrence${data.totalReplacements === 1 ? "" : "s"} in ${data.recordingsChanged} recording${data.recordingsChanged === 1 ? "" : "s"}${fileSuffix}.`;
}

export async function startRepickSession(
  pageUrl: string,
  oldSelector?: string,
): Promise<RepickStartResult> {
  const r = await fetch("/api/selectors/heal/repick/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(
      oldSelector ? { pageUrl, oldSelector } : { pageUrl },
    ),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as RepickStartResult;
}

export async function repickPick(
  sessionId: string,
  x: number,
  y: number,
): Promise<RepickPickResult> {
  const r = await fetch("/api/selectors/heal/repick/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ sessionId, x, y }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as RepickPickResult;
}

export async function cancelRepickSession(sessionId: string): Promise<void> {
  await fetch("/api/selectors/heal/repick/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ sessionId }),
  }).catch(() => {});
}
