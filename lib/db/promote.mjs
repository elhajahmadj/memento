import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const before = await c.query(`SELECT id, email, username, role FROM users WHERE lower(email)=lower($1)`, ['elhaj_ahmad@yahoo.com']);
console.log("BEFORE:", before.rows);
if (before.rows.length === 0) {
  console.log("No user with that email. Listing all users:");
  const all = await c.query(`SELECT id, email, username, role FROM users ORDER BY email`);
  console.table(all.rows);
} else {
  const upd = await c.query(`UPDATE users SET role='memento_admin' WHERE lower(email)=lower($1) RETURNING id, email, username, role`, ['elhaj_ahmad@yahoo.com']);
  console.log("AFTER:", upd.rows);
}
await c.end();
