import type { Response } from "express";
import { z as _z } from "zod";
import {
  AiKeyServiceError,
  type PublicAiKey,
} from "@/features/ai-agent/infrastructure/aiKeyService";

export function viewKey(k: PublicAiKey) {
  return {
    id: k.id,
    organizationId: k.organizationId,
    name: k.name,
    provider: k.provider,
    apiKeyLastFour: k.apiKeyLastFour,
    model: k.model,
    endpointUrl: k.endpointUrl,
    apiVersion: k.apiVersion,
    refererUrl: k.refererUrl,
    appName: k.appName,
    isDefault: k.isDefault,
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
  };
}

// Conflict-response shapes for `DELETE /ai-agent/keys/:id`. Mirrors
// the OpenAPI `AiAgentKeyDeleteConflict` component — kept inline
// because Orval only emits zod schemas for 2xx responses.
export const DeleteAiKeyConflictShape = _z.object({
  error: _z.string(),
  boundProjects: _z.array(_z.string()).optional(),
});

export function handleKeyError(res: Response, err: unknown): void {
  if (err instanceof AiKeyServiceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}
