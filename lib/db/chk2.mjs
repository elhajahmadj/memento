import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const e = await c.query(`SELECT enumlabel FROM pg_enum WHERE enumtypid=(SELECT oid FROM pg_type WHERE typname='audit_action') ORDER BY enumsortorder`);
console.log("audit_action:", e.rows.map(r=>r.enumlabel).join(", "));
// also list all enums
const all = await c.query(`SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS vals FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid GROUP BY t.typname ORDER BY 1`);
for (const r of all.rows) console.log(r.typname, "=>", r.vals.join(", "));
await c.end();
