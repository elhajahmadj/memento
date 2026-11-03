/**
 * check-db-drift.ts
 *
 * Compares the live Postgres database against the Drizzle schema and
 * exits non-zero on drift. Designed to catch the failure mode from
 * task #144, where the dev DB was missing
 * `project_assignments.organization_id` and tests blew up with
 * `column "organization_id" does not exist` (PG 42703) instead of a
 * useful diagnostic.
 *
 * Behavior:
 * - Skips with exit 0 (and a clear message) when DATABASE_URL is unset
 *   so the build doesn't break in environments without a DB.
 * - Reports missing tables, missing columns, and extra columns/tables
 *   present in the DB but absent from the schema.
 * - Tells the operator exactly which command to run to fix drift.
 */

import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";
import pg from "pg";

const FIX_HINT =
  "Run `pnpm --filter @workspace/db run push` to apply the Drizzle schema to the dev database.";

type ColumnInfo = { name: string };
type TableInfo = { name: string; columns: Map<string, ColumnInfo> };

function collectSchemaTables(): Map<string, TableInfo> {
  const tables = new Map<string, TableInfo>();
  for (const value of Object.values(schema)) {
    // PgTable instances expose a Symbol-keyed config; getTableConfig is the
    // public way to read it. Guard with a duck-type check so we skip enums,
    // zod schemas, types, etc.
    if (!(value instanceof PgTable)) {
      continue;
    }
    const cfg = getTableConfig(value);
    const cols = new Map<string, ColumnInfo>();
    for (const c of cfg.columns) {
      cols.set(c.name, { name: c.name });
    }
    tables.set(cfg.name, { name: cfg.name, columns: cols });
  }
  return tables;
}

async function collectDbTables(
  pool: pg.Pool,
): Promise<Map<string, TableInfo>> {
  const tables = new Map<string, TableInfo>();
  const { rows } = await pool.query<{
    table_name: string;
    column_name: string;
  }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  for (const row of rows) {
    let t = tables.get(row.table_name);
    if (!t) {
      t = { name: row.table_name, columns: new Map() };
      tables.set(row.table_name, t);
    }
    t.columns.set(row.column_name, { name: row.column_name });
  }
  return tables;
}

type Drift = {
  missingTables: string[];
  extraTables: string[];
  missingColumns: { table: string; column: string }[];
  extraColumns: { table: string; column: string }[];
};

function diff(
  schemaTables: Map<string, TableInfo>,
  dbTables: Map<string, TableInfo>,
): Drift {
  const drift: Drift = {
    missingTables: [],
    extraTables: [],
    missingColumns: [],
    extraColumns: [],
  };

  for (const [name, sTable] of schemaTables) {
    const dTable = dbTables.get(name);
    if (!dTable) {
      drift.missingTables.push(name);
      continue;
    }
    for (const col of sTable.columns.keys()) {
      if (!dTable.columns.has(col)) {
        drift.missingColumns.push({ table: name, column: col });
      }
    }
    for (const col of dTable.columns.keys()) {
      if (!sTable.columns.has(col)) {
        drift.extraColumns.push({ table: name, column: col });
      }
    }
  }

  for (const name of dbTables.keys()) {
    if (!schemaTables.has(name)) {
      // Ignore Drizzle's own bookkeeping table.
      if (name === "__drizzle_migrations") continue;
      drift.extraTables.push(name);
    }
  }

  return drift;
}

function hasDrift(d: Drift): boolean {
  return (
    d.missingTables.length > 0 ||
    d.missingColumns.length > 0 ||
    d.extraTables.length > 0 ||
    d.extraColumns.length > 0
  );
}

function report(d: Drift): void {
  if (d.missingTables.length) {
    console.error("Missing tables (in schema, not in DB):");
    for (const t of d.missingTables) console.error(`  - ${t}`);
  }
  if (d.missingColumns.length) {
    console.error("Missing columns (in schema, not in DB):");
    for (const { table, column } of d.missingColumns) {
      console.error(`  - ${table}.${column}`);
    }
  }
  if (d.extraTables.length) {
    console.error("Extra tables (in DB, not in schema):");
    for (const t of d.extraTables) console.error(`  - ${t}`);
  }
  if (d.extraColumns.length) {
    console.error("Extra columns (in DB, not in schema):");
    for (const { table, column } of d.extraColumns) {
      console.error(`  - ${table}.${column}`);
    }
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(
      "check-db-drift: DATABASE_URL is not set; skipping drift check.",
    );
    return;
  }

  const pool = new pg.Pool({ connectionString: url });
  try {
    const [schemaTables, dbTables] = await Promise.all([
      Promise.resolve(collectSchemaTables()),
      collectDbTables(pool),
    ]);

    const drift = diff(schemaTables, dbTables);
    if (!hasDrift(drift)) {
      console.log(
        `check-db-drift: OK — ${schemaTables.size} tables in sync with the Drizzle schema.`,
      );
      return;
    }

    console.error(
      "check-db-drift: drift detected between the live database and the Drizzle schema.",
    );
    report(drift);
    console.error("");
    console.error(FIX_HINT);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("check-db-drift: failed to run drift check.");
  console.error(err);
  process.exit(1);
});
