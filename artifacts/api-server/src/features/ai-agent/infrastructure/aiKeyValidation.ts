import type { AiProvider } from "@/features/ai-agent/domain/types";
import { AiKeyServiceError } from "./aiKeyTypes";
import {
  ProviderExtrasWhitelistError,
  ProviderRequirementsError,
  validateExtrasWhitelist,
  validateProviderRequirements,
} from "./providers";

export interface ProviderExtrasPatch {
  model?: string | null;
  endpointUrl?: string | null;
  apiVersion?: string | null;
  refererUrl?: string | null;
  appName?: string | null;
}

/**
 * Run a registry validation and rethrow as `AiKeyServiceError(400)`
 * so the existing route error handler reports a clean HTTP 400.
 */
function runRegistryValidation(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    if (
      e instanceof ProviderExtrasWhitelistError ||
      e instanceof ProviderRequirementsError
    ) {
      throw new AiKeyServiceError(400, e.message);
    }
    throw e;
  }
}

/**
 * Whitelist provider-specific extras: setting a field the chosen
 * provider doesn't accept (Azure-only fields against OpenAI,
 * OpenRouter attribution headers against Anthropic, …) is rejected
 * so the stored row stays coherent. Delegates to the per-provider
 * definitions in `./providers`.
 */
export function validateExtrasForProvider(
  provider: AiProvider,
  patch: ProviderExtrasPatch,
): void {
  runRegistryValidation(() => validateExtrasWhitelist(provider, patch));
}

/**
 * Per-provider mandatory-fields check (today: Azure's endpointUrl +
 * deployment-name model). Delegates to the per-provider definitions
 * in `./providers`; kept under the legacy name so existing call
 * sites in `aiKeyCrud.ts` need no changes.
 */
export function validateAzureRequirements(opts: {
  endpointUrl: string | null;
  model: string | null;
}): void {
  // Azure is currently the only provider that declares mandatory
  // fields, so the legacy call-site signature still applies. New
  // providers can opt in by setting `requiresEndpointUrl` /
  // `requiresExplicitModel` in their definition file.
  runRegistryValidation(() =>
    validateProviderRequirements("azure_openai", opts),
  );
}
