import {
  AiProviderError,
  type AiProvider,
  type AiProviderExtras,
} from "@/features/ai-agent/domain/types";
import { anthropicProvider } from "./anthropic";
import { azureOpenAiProvider } from "./azure_openai";
import { deepseekProvider } from "./deepseek";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { mistralProvider } from "./mistral";
import { openaiProvider } from "./openai";
import { openrouterProvider } from "./openrouter";
import type {
  ProviderExtraField,
  ServerProviderDefinition,
} from "./types";

export type {
  ProviderExtraField,
  ServerProviderDefinition,
} from "./types";

/**
 * The single source of truth for every server-side AI provider.
 *
 * Adding a 9th provider is a single new file under this directory
 * plus a one-line registration in the `SERVER_PROVIDERS` record
 * below. The Zod-validated route handlers, the encrypted-row extras
 * whitelist, the Azure-style required-fields validator, and the
 * runner's `verifyKey` / `chat` dispatchers all consume this map
 * generically — none of them switch on provider name.
 */
export const SERVER_PROVIDERS: Record<AiProvider, ServerProviderDefinition> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  openrouter: openrouterProvider,
  azure_openai: azureOpenAiProvider,
  groq: groqProvider,
  deepseek: deepseekProvider,
  mistral: mistralProvider,
};

const ORDERED: ServerProviderDefinition[] = [
  anthropicProvider,
  openaiProvider,
  geminiProvider,
  openrouterProvider,
  azureOpenAiProvider,
  groqProvider,
  deepseekProvider,
  mistralProvider,
];

export const AI_PROVIDERS: readonly AiProvider[] = ORDERED.map((p) => p.value);

export const DEFAULT_MODELS: Record<AiProvider, string | null> =
  Object.fromEntries(ORDERED.map((p) => [p.value, p.defaultModel])) as Record<
    AiProvider,
    string | null
  >;

/**
 * Azure OpenAI's default REST API version. Re-exported as a named
 * constant for the seed/migration paths that need a literal value;
 * the runtime resolves it generically via `getProviderDefinition`.
 */
export const DEFAULT_AZURE_API_VERSION =
  azureOpenAiProvider.defaultApiVersion ?? "2024-10-21";

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === "string" && v in SERVER_PROVIDERS;
}

export function getProviderDefinition(
  provider: AiProvider,
): ServerProviderDefinition {
  return SERVER_PROVIDERS[provider];
}

const ALL_EXTRA_FIELDS: readonly ProviderExtraField[] = [
  "endpointUrl",
  "apiVersion",
  "refererUrl",
  "appName",
];

/**
 * Reverse index: which provider(s) accept each extras field. Used to
 * build a helpful error message when an admin tries to set a field
 * the chosen provider doesn't accept ("only accepted by Azure OpenAI",
 * etc.).
 */
const FIELD_OWNERS: Record<ProviderExtraField, ServerProviderDefinition[]> = {
  endpointUrl: [],
  apiVersion: [],
  refererUrl: [],
  appName: [],
};
for (const def of ORDERED) {
  for (const field of def.acceptedExtras) {
    FIELD_OWNERS[field].push(def);
  }
}

function isProvided(v: string | null | undefined): boolean {
  if (v === undefined || v === null) return false;
  return v.trim().length > 0;
}

export interface ExtrasPatch {
  endpointUrl?: string | null | undefined;
  apiVersion?: string | null | undefined;
  refererUrl?: string | null | undefined;
  appName?: string | null | undefined;
}

/**
 * Whitelist provider-specific extras: setting a field the chosen
 * provider doesn't accept (Azure-only fields against OpenAI,
 * OpenRouter attribution headers against Anthropic, …) throws so
 * the row stays coherent. Treats empty string / whitespace as
 * "not set" since the UI sends `""` when an optional field is
 * cleared.
 *
 * Throws an `Error` with `{ status: 400 }` shape callers can map onto
 * HTTP responses. Pass `null` / `undefined` for the provider to skip
 * the check (used by the OrgConfig path that defers to the existing
 * stored row).
 */
export class ProviderExtrasWhitelistError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ProviderExtrasWhitelistError";
  }
}

export function validateExtrasWhitelist(
  provider: AiProvider | null | undefined,
  patch: ExtrasPatch,
): void {
  if (!provider) return;
  const def = SERVER_PROVIDERS[provider];
  const accepted = new Set<ProviderExtraField>(def.acceptedExtras);
  for (const field of ALL_EXTRA_FIELDS) {
    if (!isProvided(patch[field])) continue;
    if (accepted.has(field)) continue;
    const owners = FIELD_OWNERS[field];
    const ownerLabel =
      owners.length === 0
        ? "any provider"
        : owners.length === 1
          ? owners[0]!.label
          : `${owners
              .slice(0, -1)
              .map((o) => o.label)
              .join(", ")} or ${owners[owners.length - 1]!.label}`;
    throw new ProviderExtrasWhitelistError(
      `${field} is only accepted by ${ownerLabel}.`,
    );
  }
}

export class ProviderRequirementsError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ProviderRequirementsError";
  }
}

/**
 * Per-provider mandatory-fields check, evaluated when the admin is
 * persisting (or rotating) an API key. Today this only fires for
 * Azure OpenAI (endpointUrl + deployment-name model are mandatory),
 * but new providers can declare the same gates via
 * `requiresExplicitModel` / `requiresEndpointUrl`.
 */
export function validateProviderRequirements(
  provider: AiProvider,
  opts: { endpointUrl: string | null; model: string | null },
): void {
  const def = SERVER_PROVIDERS[provider];
  if (def.requiresEndpointUrl && !opts.endpointUrl?.trim()) {
    throw new ProviderRequirementsError(
      `${def.label} requires an Endpoint URL.`,
    );
  }
  if (def.requiresExplicitModel && !opts.model?.trim()) {
    throw new ProviderRequirementsError(
      `${def.label} requires a deployment name in the Model field.`,
    );
  }
}

/**
 * Resolve the model to use for a chat call: caller override → stored
 * extras.model → provider default. Throws when the provider has no
 * usable default and the admin hasn't supplied one (Azure).
 */
export function pickModel(
  provider: AiProvider,
  extras: Partial<AiProviderExtras> | undefined,
  override: string | undefined,
): string {
  const fromOpts = override?.trim();
  if (fromOpts) return fromOpts;
  const stored = extras?.model?.trim();
  if (stored) return stored;
  const def = SERVER_PROVIDERS[provider];
  if (def.defaultModel) return def.defaultModel;
  throw new AiProviderError(
    400,
    `${provider} requires an explicit model/deployment name — set the Model field under Tools → AI Agent.`,
  );
}
