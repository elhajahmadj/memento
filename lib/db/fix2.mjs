import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const stmts = [
  `ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'memento_admin' BEFORE 'admin'`,
];
for (const s of stmts) {
  try { await c.query(s); console.log("OK:", s); }
  catch (e) { console.log("ERR:", s, "::", e.message); }
}
const e = await c.query(`SELECT enumlabel FROM pg_enum WHERE enumtypid=(SELECT oid FROM pg_type WHERE typname='user_role') ORDER BY enumsortorder`);
console.log("user_role now:", e.rows.map(r=>r.enumlabel).join(", "));
await c.end();
