import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { like } from "drizzle-orm";
import { db, aiAgentOrgConfigsTable } from "@workspace/db";
import { provisionUser, deleteUserByUsername } from "@/shared/test-helpers";
import {
  upsertOrgConfig,
  getOrgConfig,
  AiProviderConfigError,
} from "@/features/ai-agent/infrastructure/aiAgentService";

/**
 * Service-layer coverage for `ai_agent_org_configs` after task #42.
 * The legacy per-key columns (apiKeyEncrypted / apiKeyLastFour /
 * apiKeySetAt / model / endpointUrl / apiVersion / refererUrl /
 * appName) are no longer written here — they live exclusively in
 * `ai_agent_keys` and are covered by that table's tests. This file
 * pins the surviving behavior: `enabled` + `provider` round-trip,
 * unknown-provider rejection, and the redacted view shape.
 */

process.env.PROJECT_SECRETS_KEY ??=
  "vitest-ai-agent-secret-xxxxxxxxxxxxxxxx";

const ADMIN = "vitest-ai-providers-admin";
const ORG_PREFIX = "vitest-ai-providers-org-";

let adminId = "";
let nextOrgN = 0;
function nextOrg(): string {
  return `${ORG_PREFIX}${++nextOrgN}-${Date.now()}`;
}

async function scrub(): Promise<void> {
  await db
    .delete(aiAgentOrgConfigsTable)
    .where(like(aiAgentOrgConfigsTable.organizationId, `${ORG_PREFIX}%`));
}

beforeAll(async () => {
  await scrub();
  const u = await provisionUser({ username: ADMIN, role: "admin" });
  adminId = u.id;
});

afterAll(async () => {
  await scrub();
  await deleteUserByUsername(ADMIN);
});

beforeEach(async () => {
  await scrub();
});

describe("aiAgentService.upsertOrgConfig — enabled + provider only", () => {
  it("creates a row with enabled + provider and returns the redacted view", async () => {
    const orgId = nextOrg();
    const v = await upsertOrgConfig({
      organizationId: orgId,
      enabled: true,
      provider: "anthropic",
      updatedByUserId: adminId,
    });
    expect(v.organizationId).toBe(orgId);
    expect(v.enabled).toBe(true);
    expect(v.provider).toBe("anthropic");
    // Per-key fields are never exposed via this view — they live on
    // ai_agent_keys.
    expect(v.apiKeyLastFour).toBeNull();
    expect(v.apiKeySetAt).toBeNull();
    expect(v.model).toBeNull();
    expect(v.endpointUrl).toBeNull();
    expect(v.apiVersion).toBeNull();
    expect(v.refererUrl).toBeNull();
    expect(v.appName).toBeNull();
  });

  it("updates enabled + provider on follow-up writes", async () => {
    const orgId = nextOrg();
    await upsertOrgConfig({
      organizationId: orgId,
      enabled: true,
      provider: "anthropic",
      updatedByUserId: adminId,
    });
    const v = await upsertOrgConfig({
      organizationId: orgId,
      enabled: false,
      provider: "openai",
      updatedByUserId: adminId,
    });
    expect(v.enabled).toBe(false);
    expect(v.provider).toBe("openai");
    const persisted = await getOrgConfig(orgId);
    expect(persisted.enabled).toBe(false);
    expect(persisted.provider).toBe("openai");
  });

  it("rejects unknown providers", async () => {
    await expect(
      upsertOrgConfig({
        organizationId: nextOrg(),
        provider: "not-a-real-provider" as never,
        updatedByUserId: adminId,
      }),
    ).rejects.toBeInstanceOf(AiProviderConfigError);
  });

  it("returns a defaults view when no row exists", async () => {
    const v = await getOrgConfig(nextOrg());
    expect(v.enabled).toBe(false);
    expect(v.provider).toBeNull();
    expect(v.apiKeyLastFour).toBeNull();
  });
});
