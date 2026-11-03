import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`SELECT id, email, username, role FROM users ORDER BY email`);
console.table(r.rows);
await c.end();
