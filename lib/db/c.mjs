import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_runs' ORDER BY ordinal_position`);
console.log("ai_runs columns:", r.rows);
// Try the failing query directly to capture the real error
try {
  await c.query(`SELECT id, project_name, suite_name FROM ai_runs WHERE triggered_by_user_id=$1 AND status IN ($2,$3) ORDER BY started_at DESC LIMIT 5`, ['5814d688-2b3c-4c4d-b9e6-8726a0249214','pending','running']);
  console.log("QUERY OK");
} catch (e) {
  console.log("QUERY ERR:", e.code, e.message, "::", e.detail, "::", e.hint, "::", e.position);
}
await c.end();
