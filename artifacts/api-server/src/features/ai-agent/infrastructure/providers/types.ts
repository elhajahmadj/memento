import type {
  AiProvider,
  AiProviderExtras,
} from "@/features/ai-agent/domain/types";
import type {
  LlmChatMessage,
  LlmChatResult,
  VerifyKeyResult,
} from "../llmProviderTypes";

/**
 * The optional, provider-specific extras a key row can carry. Each
 * provider's `acceptedExtras` whitelists the subset its create/update
 * payloads are allowed to set; anything outside the list is rejected
 * by `validateExtrasWhitelist` before it reaches the database.
 *
 * `model` is excluded here — it's a free-form override every provider
 * supports and is validated separately when `requiresExplicitModel`
 * is set.
 */
export type ProviderExtraField =
  | "endpointUrl"
  | "apiVersion"
  | "refererUrl"
  | "appName";

export interface ServerProviderVerifyOpts {
  apiKey: string;
  extras: Partial<AiProviderExtras>;
}

export interface ServerProviderChatOpts {
  apiKey: string;
  extras: Partial<AiProviderExtras>;
  /** Already resolved by the registry's `pickModel` helper. */
  model: string;
  messages: LlmChatMessage[];
  maxTokens: number;
  temperature: number;
}

/**
 * Single source of truth for a server-side AI provider. Adding a new
 * provider is a single new file in this directory plus a one-line
 * registration in `providers/index.ts`.
 */
export interface ServerProviderDefinition {
  /** Stable id. Must match the `AiProvider` union in `domain/types`. */
  value: AiProvider;
  /** Human-readable name used in error messages and logs. */
  label: string;
  /**
   * Default model id when the admin leaves the Model field blank.
   * `null` means the provider has no usable default (Azure: deployment
   * name is mandatory).
   */
  defaultModel: string | null;
  /**
   * Whitelist of provider-specific extras this provider accepts on
   * its create/update API. Saving any extras field outside this list
   * is rejected with HTTP 400 before the row is written.
   */
  acceptedExtras: ReadonlyArray<ProviderExtraField>;
  /**
   * When true, persisting a key requires the admin to also supply a
   * non-empty `model` (e.g. Azure's deployment name).
   */
  requiresExplicitModel?: boolean;
  /**
   * When true, persisting a key requires the admin to also supply a
   * non-empty `endpointUrl` (e.g. Azure's resource URL).
   */
  requiresEndpointUrl?: boolean;
  /**
   * Default value used for `apiVersion` when the admin leaves it
   * blank. Only meaningful when `apiVersion` is in `acceptedExtras`.
   */
  defaultApiVersion?: string;
  /** Auth-only health check. Implements the `verifyKey` half of the adapter. */
  verify(opts: ServerProviderVerifyOpts): Promise<VerifyKeyResult>;
  /** Single-turn chat. Implements the `chat` half of the adapter. */
  chat(opts: ServerProviderChatOpts): Promise<LlmChatResult>;
}
