import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Bring the dev/test database in line with the small set of additive
 * schema changes our test suites depend on.
 *
 * Background: this repo uses `drizzle-kit push` (not versioned
 * migrations) to apply schema changes. In CI/dev sandboxes the push
 * step is interactive whenever an existing constraint can't be
 * confirmed automatically (e.g. the `users_idp_external_id_unique`
 * prompt), so contributors regularly end up with a dev DB that lags
 * the Drizzle schema. When that happens, unrelated tests start
 * failing deep inside an INSERT with cryptic `column "…" does not
 * exist` errors that look like real regressions.
 *
 * To make tests reproducible from a fresh checkout we apply a small
 * set of strictly additive, idempotent ALTERs here. This is *not* a
 * substitute for `pnpm --filter @workspace/db run push` for ongoing
 * schema work — it's a safety net that keeps the test suite honest
 * about what regressions are real.
 *
 * Add a new entry to `STATEMENTS` whenever a test file starts
 * depending on a fresh column/table that may not yet exist on
 * everyone's dev DB. Keep every statement idempotent (`IF NOT
 * EXISTS`) and additive — never destructive.
 */
const STATEMENTS: string[] = [
  // Added when OIDC org-scoped multi-tenancy landed on
  // `project_assignments`. See lib/db/src/schema/project_assignments.ts.
  `ALTER TABLE project_assignments
     ADD COLUMN IF NOT EXISTS organization_id uuid
     REFERENCES organizations(id) ON DELETE SET NULL`,
  // Same OIDC org-scoping feature also added `organization_id` to
  // `project_access_requests` so requests stay scoped to the
  // requester's active org. See
  // lib/db/src/schema/project_access_requests.ts.
  `ALTER TABLE project_access_requests
     ADD COLUMN IF NOT EXISTS organization_id uuid
     REFERENCES organizations(id) ON DELETE SET NULL`,
  // Per-project Git provider configuration (see lib/db/src/schema/project_git_configs.ts).
  // Required by the gitConfig.routes integration tests.
  `CREATE TABLE IF NOT EXISTS project_git_configs (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     project_name text NOT NULL,
     provider text NOT NULL DEFAULT 'azure_repos',
     repo_url text NOT NULL,
     branch text NOT NULL DEFAULT 'main',
     pat_encrypted text NOT NULL,
     pat_last_four text NOT NULL,
     pat_set_at timestamptz NOT NULL DEFAULT now(),
     updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_project_git_configs_project"
     ON project_git_configs (project_name)`,
  // The audit_action enum values added when Git Repos shipped. Older
  // dev DBs may have an enum that predates these values.
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_git_pull'`,
  `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_git_push'`,
  // Audit actions added for the project lifecycle approval workflow.
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
  // Project lifecycle approval table (see
  // lib/db/src/schema/project_lifecycle_requests.ts).
  `DO $$ BEGIN
     CREATE TYPE project_lifecycle_request_kind AS ENUM ('create', 'delete');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `ALTER TYPE project_lifecycle_request_kind ADD VALUE IF NOT EXISTS 'clear_files'`,
  `DO $$ BEGIN
     CREATE TYPE project_lifecycle_request_status AS ENUM ('pending', 'approved', 'rejected');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS project_lifecycle_requests (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     project_name text NOT NULL,
     organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
     kind project_lifecycle_request_kind NOT NULL,
     status project_lifecycle_request_status NOT NULL DEFAULT 'pending',
     requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     requested_by_role user_role NOT NULL,
     requested_at timestamptz NOT NULL DEFAULT now(),
     decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
     decided_at timestamptz,
     decision_note text
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_project_lifecycle_requests_status"
     ON project_lifecycle_requests (status)`,
  `CREATE INDEX IF NOT EXISTS "IDX_project_lifecycle_requests_org_status"
     ON project_lifecycle_requests (organization_id, status)`,
  `CREATE INDEX IF NOT EXISTS "IDX_project_lifecycle_requests_project"
     ON project_lifecycle_requests (project_name)`,
  // Reusable Git PATs (Admin → Source control → Repos PAT). See
  // lib/db/src/schema/repo_pats.ts. Required by the repo-pats unit
  // and route tests, and by the gitConfig `existing_pat` branch.
  `CREATE TABLE IF NOT EXISTS repo_pats (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     provider text NOT NULL,
     name text NOT NULL,
     pat_encrypted text NOT NULL,
     pat_last_four text NOT NULL,
     created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
     updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_repo_pats_provider_name"
     ON repo_pats (provider, name)`,
  // Shared-PAT support on project_git_configs. The original schema
  // had all PAT columns NOT NULL; the shared-PAT branch needs them
  // nullable and adds a mutually-exclusive check constraint.
  `ALTER TABLE project_git_configs
     ADD COLUMN IF NOT EXISTS repo_pat_id uuid
     REFERENCES repo_pats(id) ON DELETE RESTRICT`,
  `ALTER TABLE project_git_configs
     ALTER COLUMN pat_encrypted DROP NOT NULL`,
  `ALTER TABLE project_git_configs
     ALTER COLUMN pat_last_four DROP NOT NULL`,
  `ALTER TABLE project_git_configs
     ALTER COLUMN pat_set_at DROP NOT NULL`,
  `ALTER TABLE project_git_configs
     ALTER COLUMN pat_set_at DROP DEFAULT`,
  `DO $$ BEGIN
     ALTER TABLE project_git_configs
       ADD CONSTRAINT "CK_project_git_configs_pat_source"
       CHECK (
         (repo_pat_id IS NOT NULL
            AND pat_encrypted IS NULL
            AND pat_last_four IS NULL
            AND pat_set_at IS NULL)
         OR
         (repo_pat_id IS NULL
            AND pat_encrypted IS NOT NULL
            AND pat_last_four IS NOT NULL
            AND pat_set_at IS NOT NULL)
       );
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  // Additional AI Agent provider columns shipped with task #71
  // (multi-provider support: Gemini, OpenRouter, Azure OpenAI, Groq,
  // DeepSeek, Mistral alongside Anthropic/OpenAI). See
  // lib/db/src/schema/ai_agent_org_configs.ts.
  `ALTER TABLE ai_agent_org_configs
     ADD COLUMN IF NOT EXISTS model text`,
  `ALTER TABLE ai_agent_org_configs
     ADD COLUMN IF NOT EXISTS endpoint_url text`,
  `ALTER TABLE ai_agent_org_configs
     ADD COLUMN IF NOT EXISTS api_version text`,
  `ALTER TABLE ai_agent_org_configs
     ADD COLUMN IF NOT EXISTS referer_url text`,
  `ALTER TABLE ai_agent_org_configs
     ADD COLUMN IF NOT EXISTS app_name text`,
];

let applied = false;

export async function ensureTestDbSchema(): Promise<void> {
  if (applied) return;
  for (const stmt of STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }
  applied = true;
}
