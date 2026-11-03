import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
  afterEach,
} from "vitest";
import { like } from "drizzle-orm";
import { db, aiAgentOrgConfigsTable, usersTable } from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
} from "@/shared/test-helpers";

/**
 * Route-level coverage for `/api/ai-agent/org-config` and
 * `/api/ai-agent/verify-key` after task #42.
 *
 * Per-key fields (`apiKey`, `model`, `endpointUrl`, `apiVersion`,
 * `refererUrl`, `appName`) live exclusively on `/ai-agent/keys` (the
 * AI Key library). The org-config PUT only accepts `enabled` +
 * `provider`; sending any per-key field returns HTTP 410. The
 * verify-key tests stub `globalThis.fetch` so the route never talks
 * to a real provider.
 */

process.env.PROJECT_SECRETS_KEY ??=
  "vitest-ai-agent-routes-secret-xxxxxxxx";

const PREFIX = "vitest-aiagent-routes-";
const ADMIN = `${PREFIX}admin`;
const NON_ADMIN = `${PREFIX}user`;

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let userCookie: string;

async function scrub(): Promise<void> {
  await db.delete(aiAgentOrgConfigsTable);
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
}

beforeAll(async () => {
  await scrub();
  ({ baseUrl, close } = await bootServer());
  await provisionUser({ username: ADMIN, role: "admin" });
  await provisionUser({ username: NON_ADMIN, role: "limited" });
  adminCookie = await login(baseUrl, ADMIN);
  userCookie = await login(baseUrl, NON_ADMIN);
});

afterAll(async () => {
  await db.delete(aiAgentOrgConfigsTable);
  await deleteUserByUsername(ADMIN);
  await deleteUserByUsername(NON_ADMIN);
  await close();
}, 30_000);

beforeEach(async () => {
  await db.delete(aiAgentOrgConfigsTable);
});

interface OrgCfgView {
  organizationId: string | null;
  enabled: boolean;
  provider: string | null;
  apiKeyLastFour: string | null;
  model: string | null;
  endpointUrl: string | null;
  apiVersion: string | null;
  refererUrl: string | null;
  appName: string | null;
}

async function putOrgConfig(body: unknown, cookie = adminCookie) {
  return await fetch(`${baseUrl}/api/ai-agent/org-config`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function getOrgConfig(cookie = adminCookie) {
  return await fetch(`${baseUrl}/api/ai-agent/org-config`, {
    headers: { cookie },
  });
}

async function jsonAs<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("PUT /api/ai-agent/org-config — enabled + provider only", () => {
  it("persists enabled + provider and round-trips via GET with per-key fields null", async () => {
    const put = await putOrgConfig({ enabled: true, provider: "anthropic" });
    expect(put.status).toBe(200);
    const putBody = await jsonAs<OrgCfgView>(put);
    expect(putBody.enabled).toBe(true);
    expect(putBody.provider).toBe("anthropic");
    expect(putBody.apiKeyLastFour).toBeNull();
    expect(putBody.model).toBeNull();
    expect(putBody.endpointUrl).toBeNull();

    const got = await getOrgConfig();
    expect(got.status).toBe(200);
    const cfg = await jsonAs<OrgCfgView>(got);
    expect(cfg.enabled).toBe(true);
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.apiKeyLastFour).toBeNull();
  });

  it.each([
    "apiKey",
    "model",
    "endpointUrl",
    "apiVersion",
    "refererUrl",
    "appName",
  ])("returns HTTP 410 when the legacy field %s is sent", async (field) => {
    const r = await putOrgConfig({
      enabled: true,
      provider: "anthropic",
      [field]: "anything",
    });
    expect(r.status).toBe(410);
    const body = (await r.json()) as { error: string };
    expect(body.error).toMatch(/ai-agent\/keys/);
    expect(body.error).toContain(field);
  });

  it("rejects unknown providers with HTTP 400", async () => {
    const r = await putOrgConfig({
      enabled: true,
      provider: "not-a-real-provider",
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toMatch(/Unknown provider/);
  });

  it("non-admins receive HTTP 401/403", async () => {
    const r = await putOrgConfig(
      { enabled: true, provider: "openai" },
      userCookie,
    );
    expect([401, 403]).toContain(r.status);
  });
});

describe("POST /api/ai-agent/verify-key — per-provider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubUpstream(status = 200, headers: Record<string, string> = {}) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) {
        return originalFetch(input as never, init as never);
      }
      calls.push({ url, ...(init !== undefined ? { init } : {}) });
      return new Response(status === 200 ? "{}" : '{"error":"nope"}', {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    }) as unknown as typeof fetch;
    return calls;
  }

  it.each([
    "anthropic",
    "openai",
    "gemini",
    "openrouter",
    "groq",
    "deepseek",
    "mistral",
  ] as const)("%s — happy path returns ok:true", async (provider) => {
    stubUpstream(200);
    const r = await fetch(`${baseUrl}/api/ai-agent/verify-key`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ provider, apiKey: "key-12345678" }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("azure_openai — happy path with endpointUrl + apiVersion returns ok:true", async () => {
    stubUpstream(200);
    const r = await fetch(`${baseUrl}/api/ai-agent/verify-key`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        provider: "azure_openai",
        apiKey: "az-key-12345678",
        endpointUrl: "https://r.openai.azure.com",
        apiVersion: "2024-10-21",
      }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("propagates Retry-After header on a 429 from the upstream", async () => {
    stubUpstream(429, { "retry-after": "42" });
    const r = await fetch(`${baseUrl}/api/ai-agent/verify-key`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ provider: "openai", apiKey: "bad-12345678" }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("retry-after")).toBe("42");
    const body = (await r.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/retry after 42s/);
  });

  it("rejects requests without apiKey with HTTP 400", async () => {
    stubUpstream(200);
    const r = await fetch(`${baseUrl}/api/ai-agent/verify-key`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ provider: "openai" }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/apiKey/);
  });

  it("rejects unknown providers with HTTP 400", async () => {
    stubUpstream(200);
    const r = await fetch(`${baseUrl}/api/ai-agent/verify-key`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        provider: "not-a-real-provider",
        apiKey: "x-12345678",
      }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { message: string };
    expect(body.message).toMatch(/Unknown provider/);
  });

  it("non-admins receive HTTP 401/403", async () => {
    stubUpstream(200);
    const r = await fetch(`${baseUrl}/api/ai-agent/verify-key`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: userCookie },
      body: JSON.stringify({ provider: "openai", apiKey: "x-12345678" }),
    });
    expect([401, 403]).toContain(r.status);
  });
});
