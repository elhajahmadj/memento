import { and, eq } from "drizzle-orm";
import { db, aiAgentKeysTable } from "@workspace/db";
import { decryptSecret } from "@/shared/crypto";
import type { AiProvider } from "@/features/ai-agent/domain/types";
import {
  verifyKey,
  type VerifyKeyResult,
} from "@/features/ai-agent/infrastructure/llmProviders";
import { AiKeyServiceError } from "./aiKeyTypes";
import { isAiProvider, whereOrg } from "./aiKeyShared";

/**
 * Run the provider's lightest auth-only "ping" against the saved
 * key. Returns the verifier's normalized result without exposing
 * the plaintext key.
 */
export async function checkAiKeyHealth(opts: {
  id: string;
  organizationId: string | null;
}): Promise<VerifyKeyResult> {
  const row = (
    await db
      .select()
      .from(aiAgentKeysTable)
      .where(
        and(eq(aiAgentKeysTable.id, opts.id), whereOrg(opts.organizationId)),
      )
      .limit(1)
  )[0];
  if (!row) {
    throw new AiKeyServiceError(404, "AI key not found");
  }
  const provider: AiProvider = isAiProvider(row.provider)
    ? row.provider
    : "anthropic";
  return verifyKey({
    provider,
    apiKey: decryptSecret(row.apiKeyEncrypted),
    extras: {
      endpointUrl: row.endpointUrl,
      apiVersion: row.apiVersion,
      refererUrl: row.refererUrl,
      appName: row.appName,
      model: row.model,
    },
  });
}
