import type { AiProvider, AiProviderExtras } from "@/features/ai-agent/domain/types";

/**
 * Public, redacted view of a stored AI key. The plaintext key never
 * leaves the server — only `apiKeyLastFour` is exposed.
 */
export interface PublicAiKey {
  id: string;
  organizationId: string | null;
  name: string;
  provider: AiProvider;
  apiKeyLastFour: string;
  model: string | null;
  endpointUrl: string | null;
  apiVersion: string | null;
  refererUrl: string | null;
  appName: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export class AiKeyServiceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AiKeyServiceError";
    this.status = status;
  }
}

export interface CreateAiKeyInput {
  organizationId: string | null;
  name: string;
  provider: string;
  apiKey: string;
  model?: string | null;
  endpointUrl?: string | null;
  apiVersion?: string | null;
  refererUrl?: string | null;
  appName?: string | null;
  /** When true, mark the new key as the org default (clears any other). */
  isDefault?: boolean;
  userId: string;
}

export interface UpdateAiKeyInput {
  id: string;
  organizationId: string | null;
  name?: string | undefined;
  provider?: string | undefined;
  /** Plaintext API key. `null`/`undefined` to leave the existing key untouched. */
  apiKey?: string | null | undefined;
  model?: string | null | undefined;
  endpointUrl?: string | null | undefined;
  apiVersion?: string | null | undefined;
  refererUrl?: string | null | undefined;
  appName?: string | null | undefined;
  isDefault?: boolean | undefined;
  userId: string;
}

export interface ResolvedAiKey {
  keyId: string;
  source: "project_override" | "org_default";
  provider: AiProvider;
  apiKey: string;
  extras: AiProviderExtras;
}
