import { and, eq } from "drizzle-orm";
import { db, aiAgentKeysTable } from "@workspace/db";
import { AiKeyServiceError, type PublicAiKey } from "./aiKeyTypes";
import { toPublic, whereOrg } from "./aiKeyShared";

/**
 * Promote a key to the org default. Atomically clears any other
 * default for the same org.
 */
export async function setDefaultAiKey(opts: {
  id: string;
  organizationId: string | null;
  userId: string;
}): Promise<PublicAiKey> {
  return db.transaction(async (tx) => {
    const existing = (
      await tx
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
    await tx
      .update(aiAgentKeysTable)
      .set({ isDefault: false })
      .where(
        and(
          whereOrg(opts.organizationId),
          eq(aiAgentKeysTable.isDefault, true),
        ),
      );
    const [row] = await tx
      .update(aiAgentKeysTable)
      .set({
        isDefault: true,
        updatedByUserId: opts.userId,
        updatedAt: new Date(),
      })
      .where(eq(aiAgentKeysTable.id, opts.id))
      .returning();
    return toPublic(row!);
  });
}
