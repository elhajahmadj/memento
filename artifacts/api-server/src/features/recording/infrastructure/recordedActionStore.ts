import { and, eq, sql } from "drizzle-orm";
import {
  db,
  recordedActionSetsTable,
  type RecordedActionSetKind,
} from "@workspace/db";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

export interface StoredHookActionSet {
  kind: RecordedActionSetKind;
  urlName: string;
  startUrl: string;
  actions: RecordedAction[];
  /** Method name for `kind = 'testMethod'`; null for hooks. */
  methodName: string | null;
}

/**
 * Persist (upsert) the RecordedAction[] for a recording so it can be
 * replayed later — either as a setup-hook restore before a fresh test
 * recording, or as an end-to-end Validate run for a single test method.
 *
 * Replaces any prior entry for the same (user, project, file, kind,
 * methodName). Scoped per user because limited users work in per-user
 * FORKS that share solution names with other users — without `userId` in
 * the key, two users editing the same class in their own forks would
 * clobber each other's sidecar data and could even replay another user's
 * data at validation time.
 */
export async function saveActionSet(args: {
  userId: string;
  projectName: string;
  filePath: string;
  kind: RecordedActionSetKind;
  methodName?: string | null;
  urlName: string;
  startUrl: string;
  actions: RecordedAction[];
}): Promise<void> {
  const {
    userId,
    projectName,
    filePath,
    kind,
    methodName,
    urlName,
    startUrl,
    actions,
  } = args;
  const normalizedMethodName =
    kind === "testMethod" ? (methodName ?? "") : "";
  await db
    .insert(recordedActionSetsTable)
    .values({
      userId,
      projectName,
      filePath,
      kind,
      methodName: normalizedMethodName,
      urlName,
      startUrl,
      actions: actions as unknown as object,
    })
    .onConflictDoUpdate({
      target: [
        recordedActionSetsTable.userId,
        recordedActionSetsTable.projectName,
        recordedActionSetsTable.filePath,
        recordedActionSetsTable.kind,
        recordedActionSetsTable.methodName,
      ],
      set: {
        urlName,
        startUrl,
        actions: actions as unknown as object,
        updatedAt: new Date(),
      },
    });
}

/** Backwards-compatible alias used by the existing hook codepath. */
export const saveHookActions = saveActionSet;

export async function loadHookActions(args: {
  userId: string;
  projectName: string;
  filePath: string;
  kind: Exclude<RecordedActionSetKind, "testMethod">;
}): Promise<StoredHookActionSet | null> {
  const rows = await db
    .select()
    .from(recordedActionSetsTable)
    .where(
      and(
        eq(recordedActionSetsTable.userId, args.userId),
        eq(recordedActionSetsTable.projectName, args.projectName),
        eq(recordedActionSetsTable.filePath, args.filePath),
        eq(recordedActionSetsTable.kind, args.kind),
        eq(recordedActionSetsTable.methodName, ""),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    kind: row.kind,
    urlName: row.urlName,
    startUrl: row.startUrl,
    actions: row.actions as RecordedAction[],
    methodName: row.methodName === "" ? null : row.methodName,
  };
}

export async function loadTestMethodActions(args: {
  userId: string;
  projectName: string;
  filePath: string;
  methodName: string;
}): Promise<StoredHookActionSet | null> {
  const rows = await db
    .select()
    .from(recordedActionSetsTable)
    .where(
      and(
        eq(recordedActionSetsTable.userId, args.userId),
        eq(recordedActionSetsTable.projectName, args.projectName),
        eq(recordedActionSetsTable.filePath, args.filePath),
        eq(recordedActionSetsTable.kind, "testMethod"),
        eq(recordedActionSetsTable.methodName, args.methodName),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    kind: row.kind,
    urlName: row.urlName,
    startUrl: row.startUrl,
    actions: row.actions as RecordedAction[],
    methodName: row.methodName === "" ? null : row.methodName,
  };
}

/**
 * Load every stored hook action set for a class file, scoped to one
 * user. Returns a map keyed by hook kind; missing entries indicate no
 * replay data exists for that user / class / hook. Test-method
 * recordings are NOT included in the returned map (they have their own
 * loader since they're keyed by methodName as well).
 */
export async function loadHooksForClass(args: {
  userId: string;
  projectName: string;
  filePath: string;
}): Promise<Partial<Record<"beforeEach" | "oneTimeSetup", StoredHookActionSet>>> {
  const rows = await db
    .select()
    .from(recordedActionSetsTable)
    .where(
      and(
        eq(recordedActionSetsTable.userId, args.userId),
        eq(recordedActionSetsTable.projectName, args.projectName),
        eq(recordedActionSetsTable.filePath, args.filePath),
        sql`${recordedActionSetsTable.kind} in ('beforeEach','oneTimeSetup')`,
      ),
    );
  const out: Partial<Record<"beforeEach" | "oneTimeSetup", StoredHookActionSet>> =
    {};
  for (const row of rows) {
    if (row.kind === "beforeEach" || row.kind === "oneTimeSetup") {
      out[row.kind] = {
        kind: row.kind,
        urlName: row.urlName,
        startUrl: row.startUrl,
        actions: row.actions as RecordedAction[],
        methodName: row.methodName === "" ? null : row.methodName,
      };
    }
  }
  return out;
}

/**
 * List every stored recording (hooks + test methods) for a project,
 * scoped to one user. Used by the Validate UI to show what's eligible
 * for replay.
 */
export async function listRecordingsForProject(args: {
  userId: string;
  projectName: string;
}): Promise<
  Array<{
    filePath: string;
    kind: RecordedActionSetKind;
    methodName: string | null;
    urlName: string;
    startUrl: string;
    updatedAt: Date;
  }>
> {
  const rows = await db
    .select({
      filePath: recordedActionSetsTable.filePath,
      kind: recordedActionSetsTable.kind,
      methodName: recordedActionSetsTable.methodName,
      urlName: recordedActionSetsTable.urlName,
      startUrl: recordedActionSetsTable.startUrl,
      updatedAt: recordedActionSetsTable.updatedAt,
    })
    .from(recordedActionSetsTable)
    .where(
      and(
        eq(recordedActionSetsTable.userId, args.userId),
        eq(recordedActionSetsTable.projectName, args.projectName),
      ),
    );
  return rows;
}
