import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const all = await c.query(`SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname IN ('user_role','project_lifecycle_request_kind','project_lifecycle_request_status','recording_kind','validation_status','ai_run_status','ai_run_kind','solution_type','language','auth_source','nav_layout','sso_decision','sso_gate') ORDER BY 1, e.enumsortorder`);
const byT = {};
for (const r of all.rows) (byT[r.typname] ??= []).push(r.enumlabel);
for (const [t,v] of Object.entries(byT)) console.log(t, "=>", v.join(", "));
await c.end();
