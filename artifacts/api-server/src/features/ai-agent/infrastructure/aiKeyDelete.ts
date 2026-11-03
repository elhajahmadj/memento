import { and, eq, ne } from "drizzle-orm";
import {
  db,
  aiAgentKeysTable,
  aiAgentProjectConfigsTable,
} from "@workspace/db";
import { AiKeyServiceError } from "./aiKeyTypes";
import { whereOrg } from "./aiKeyShared";

/**
 * Project names whose `ai_agent_project_configs.ai_key_id` references
 * the given key. Used by the delete guard.
 */
export async function findProjectsBoundToAiKey(
  keyId: string,
): Promise<string[]> {
  const rows = await db
    .select({ projectName: aiAgentProjectConfigsTable.projectName })
    .from(aiAgentProjectConfigsTable)
    .where(eq(aiAgentProjectConfigsTable.aiKeyId, keyId));
  return rows.map((r) => r.projectName).sort();
}

export async function deleteAiKey(opts: {
  id: string;
  organizationId: string | null;
}): Promise<
  | { deleted: true; boundProjects: [] }
  | { deleted: false; reason: "bound_projects"; boundProjects: string[] }
  | { deleted: false; reason: "default_with_siblings" }
> {
  const existing = (
    await db
      .select()
      .from(aiAgentKeysTable)
      .where(
        and(eq(aiAgentKeysTable.id, opts.id), whereOrg(opts.organizationId)),
      )
      .limit(1)
  )[0];
  if (!existing) {
    throw new AiKeyServiceError(404, "AI key not found");
  }
  const bound = await findProjectsBoundToAiKey(opts.id);
  if (bound.length > 0) {
    return { deleted: false, reason: "bound_projects", boundProjects: bound };
  }
  // Block deletion of the default key while other keys exist —
  // admins should promote another key first so the org isn't left
  // with siblings and no default.
  if (existing.isDefault) {
    const others = (
      await db
        .select({ id: aiAgentKeysTable.id })
        .from(aiAgentKeysTable)
        .where(
          and(
            whereOrg(opts.organizationId),
            ne(aiAgentKeysTable.id, opts.id),
          ),
        )
        .limit(1)
    )[0];
    if (others) {
      return { deleted: false, reason: "default_with_siblings" };
    }
  }
  await db.delete(aiAgentKeysTable).where(eq(aiAgentKeysTable.id, opts.id));
  return { deleted: true, boundProjects: [] };
}
