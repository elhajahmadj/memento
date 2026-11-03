import { and, asc, eq } from "drizzle-orm";
import { db, sharedStepsTable, type SharedStep } from "@workspace/db";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

/**
 * Reusable named macros — a stored RecordedAction[] snippet that the
 * recorder can splice into any new recording. Scoped per-(user, project)
 * to respect the per-user fork model: each fork's owner manages their
 * own library.
 */

export interface SharedStepDto {
  id: string;
  name: string;
  description: string;
  actions: RecordedAction[];
  createdAt: string;
  updatedAt: string;
}

function toDto(row: SharedStep): SharedStepDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    actions: (row.actions as RecordedAction[]) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSharedSteps(args: {
  userId: string;
  projectName: string;
}): Promise<SharedStepDto[]> {
  const rows = await db
    .select()
    .from(sharedStepsTable)
    .where(
      and(
        eq(sharedStepsTable.userId, args.userId),
        eq(sharedStepsTable.projectName, args.projectName),
      ),
    )
    .orderBy(asc(sharedStepsTable.name));
  return rows.map(toDto);
}

export async function getSharedStep(args: {
  userId: string;
  projectName: string;
  name: string;
}): Promise<SharedStepDto | null> {
  const rows = await db
    .select()
    .from(sharedStepsTable)
    .where(
      and(
        eq(sharedStepsTable.userId, args.userId),
        eq(sharedStepsTable.projectName, args.projectName),
        eq(sharedStepsTable.name, args.name),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toDto(row) : null;
}

export async function upsertSharedStep(args: {
  userId: string;
  projectName: string;
  name: string;
  description: string;
  actions: RecordedAction[];
}): Promise<SharedStepDto> {
  await db
    .insert(sharedStepsTable)
    .values({
      userId: args.userId,
      projectName: args.projectName,
      name: args.name,
      description: args.description,
      actions: args.actions,
    })
    .onConflictDoUpdate({
      target: [
        sharedStepsTable.userId,
        sharedStepsTable.projectName,
        sharedStepsTable.name,
      ],
      set: {
        description: args.description,
        actions: args.actions,
        updatedAt: new Date(),
      },
    });
  const dto = await getSharedStep(args);
  if (!dto) throw new Error("upsertSharedStep: row missing after upsert");
  return dto;
}

export async function deleteSharedStep(args: {
  userId: string;
  projectName: string;
  name: string;
}): Promise<boolean> {
  const result = await db
    .delete(sharedStepsTable)
    .where(
      and(
        eq(sharedStepsTable.userId, args.userId),
        eq(sharedStepsTable.projectName, args.projectName),
        eq(sharedStepsTable.name, args.name),
      ),
    )
    .returning({ id: sharedStepsTable.id });
  return result.length > 0;
}
