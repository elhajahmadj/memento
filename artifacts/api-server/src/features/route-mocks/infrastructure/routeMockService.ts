// Per-(user, project) network mock rules. Loaded by the recorder and
// the validation replay before the first navigation and installed as
// `page.route()` interceptions on the active browser context.
import { and, asc, eq } from "drizzle-orm";
import type { Page } from "playwright";
import {
  db,
  routeMocksTable,
  type InsertRouteMock,
  type RouteMockRow,
} from "@workspace/db";

export type RouteMockMethod = RouteMockRow["method"];

export async function listRouteMocks(args: {
  userId: string;
  projectName: string;
}): Promise<RouteMockRow[]> {
  return db
    .select()
    .from(routeMocksTable)
    .where(
      and(
        eq(routeMocksTable.userId, args.userId),
        eq(routeMocksTable.projectName, args.projectName),
      ),
    )
    .orderBy(asc(routeMocksTable.createdAt));
}

export async function createRouteMock(
  row: InsertRouteMock,
): Promise<RouteMockRow> {
  const inserted = await db
    .insert(routeMocksTable)
    .values(row)
    .returning();
  return inserted[0]!;
}

export async function updateRouteMock(args: {
  id: string;
  userId: string;
  patch: {
    [K in keyof Omit<InsertRouteMock, "userId" | "projectName">]?:
      | InsertRouteMock[K]
      | undefined;
  };
}): Promise<RouteMockRow | null> {
  const rows = await db
    .update(routeMocksTable)
    .set({ ...args.patch, updatedAt: new Date() })
    .where(
      and(
        eq(routeMocksTable.id, args.id),
        eq(routeMocksTable.userId, args.userId),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function deleteRouteMock(args: {
  id: string;
  userId: string;
}): Promise<boolean> {
  const rows = await db
    .delete(routeMocksTable)
    .where(
      and(
        eq(routeMocksTable.id, args.id),
        eq(routeMocksTable.userId, args.userId),
      ),
    )
    .returning({ id: routeMocksTable.id });
  return rows.length > 0;
}

/**
 * Install enabled mock rules for `(userId, projectName)` as
 * `page.route()` interceptions. Returns the count installed so callers
 * can surface "N mocks active" hints.
 */
export async function installPersistentRouteMocks(
  page: Page,
  userId: string,
  projectName: string,
): Promise<number> {
  const rows = await listRouteMocks({ userId, projectName });
  let installed = 0;
  for (const row of rows) {
    if (!row.enabled) continue;
    const wantMethod = row.method.toUpperCase();
    const status = row.status;
    const body =
      row.bodyJson === null || row.bodyJson === undefined
        ? ""
        : JSON.stringify(row.bodyJson);
    await page.route(row.urlPattern, async (route) => {
      if (route.request().method().toUpperCase() !== wantMethod) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body,
      });
    });
    installed += 1;
  }
  return installed;
}
