import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const stmts = [
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_git_pull'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_git_push'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_git_branch_create'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_git_branch_checkout'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_create_requested'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_create_approved'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_create_rejected'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_delete_requested'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_delete_approved'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_delete_rejected'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_delete_executed'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_clear_files_requested'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_clear_files_approved'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_clear_files_rejected'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_clear_files_executed'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'sso_denial_dismiss'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'sso_denial_unhandle'`,
];
for (const s of stmts) {
  try { await c.query(s); console.log("OK:", s.slice(0,80)); }
  catch (e) { console.log("ERR:", s.slice(0,80), "::", e.message); }
}
const e = await c.query(`SELECT enumlabel FROM pg_enum WHERE enumtypid=(SELECT oid FROM pg_type WHERE typname='audit_action') ORDER BY enumsortorder`);
console.log("\nFINAL count:", e.rows.length, "values");
await c.end();
