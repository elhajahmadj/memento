import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const cols = await c.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('audit_events','validation_runs','organizations','user_organizations','project_assignments','project_git_configs','ai_runs') ORDER BY 1,2`);
const byT = {};
for (const r of cols.rows) (byT[r.table_name] ??= []).push(r.column_name);
for (const [t,cols] of Object.entries(byT)) console.log(t, "=>", cols.join(", "));
await c.end();
