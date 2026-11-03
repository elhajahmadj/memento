import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const t = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`);
console.log("tables:", t.rows.length, "=>", t.rows.map(r=>r.table_name).join(", "));
try {
  const r = await c.query(`SELECT id FROM ai_runs WHERE status IN ('pending','running') LIMIT 1`);
  console.log("ai_runs query OK, rows:", r.rows.length);
} catch(e){ console.log("ai_runs ERR:", e.message); }
await c.end();
