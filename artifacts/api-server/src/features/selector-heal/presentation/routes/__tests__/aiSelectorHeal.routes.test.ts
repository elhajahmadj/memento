/**
 * REST coverage for the AI Fix Selector endpoints (task #15).
 *
 *   1. POST /api/selectors/heal/ai-suggest — success path returns the
 *      provider/model/confidence/tokens echoed back, and records an
 *      `ai_selector_heal_suggest` audit row with the same provenance.
 *   2. POST /api/selectors/heal/ai-suggest — provider error mapped to
 *      502 with `kind: "infrastructure"` and no audit row.
 *   3. POST /api/selectors/heal/ai-suggest — missing AI key mapped to
 *      404 with `kind: "not_found"` (the UI uses this to flip into the
 *      no_key empty state).
 *   4. POST /api/selectors/heal/ai-suggest — Zod schema check: empty
 *      `oldSelector` is rejected 400 before the use case is even
 *      invoked.
 *   5. POST /api/selectors/heal/ai-suggest — auth: 401 with no session,
 *      403 for an unassigned limited_admin (project-scope gate), 404
 *      with a signed-in user but no project loaded.
 *   6. GET /api/selectors/heal/ai-available — returns `{available:true,
 *      provider}` when a key is configured, `{available:false, reason:
 *      "NO_API_KEY", setupHref}` when not, and is hard-wired never to
 *      return 5xx so the UI can treat any non-200 the same.
 *
 * The AI use case (`suggestSelectorFix`) and the readiness gate
 * (`assertAgentReady`) are mocked so the test never reaches a real
 * LLM provider — the route's contract with its application layer is
 * the thing under test.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import {
  setCurrentProject,
  type Project,
} from "@/features/projects/infrastructure/projectService";
import {
  err,
  infrastructureError,
  notFoundError,
  ok,
} from "@workspace/kernel";
import { AiAgentDisabledError } from "@/features/ai-agent/domain/types";

vi.mock("@/features/audit/infrastructure/recordAudit", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    recordAudit: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock(
  "@/features/selector-heal/application/aiHealUseCase",
  async (orig) => {
    const real = (await orig()) as Record<string, unknown>;
    return {
      ...real,
      suggestSelectorFix: vi.fn(),
    };
  },
);

vi.mock(
  "@/features/ai-agent/infrastructure/aiAgentService",
  async (orig) => {
    const real = (await orig()) as Record<string, unknown>;
    return {
      ...real,
      assertAgentReady: vi.fn(),
    };
  },
);

import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import { suggestSelectorFix } from "@/features/selector-heal/application/aiHealUseCase";
import { assertAgentReady } from "@/features/ai-agent/infrastructure/aiAgentService";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedCookie: string;
let adminUserId = "";
let limitedUserId = "";

const ADMIN_USERNAME = "vitest-ai-heal-admin";
const LIMITED_USERNAME = "vitest-ai-heal-limited";
const PROJECT_NAME = "AiHealProj";
const TEST_PROJECT = "AiHealProj.Tests";
const NAMESPACE = "AiHealProj";

function makeProject(): Project {
  return {
    solutionName: PROJECT_NAME,
    testProjectName: TEST_PROJECT,
    namespace: NAMESPACE,
    rootPath: "/tmp/ai-heal-fake",
    slnPath: `/tmp/ai-heal-fake/${PROJECT_NAME}.sln`,
    language: "csharp",
  };
}

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  adminUserId = (
    await provisionUser({ username: ADMIN_USERNAME, role: "admin" })
  ).id;
  limitedUserId = (
    await provisionUser({ username: LIMITED_USERNAME, role: "limited_admin" })
  ).id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await close();
});

beforeEach(() => {
  vi.mocked(suggestSelectorFix).mockReset();
  vi.mocked(assertAgentReady).mockReset();
  vi.mocked(recordAudit).mockClear();
});

afterEach(() => {
  setCurrentProject(null, adminUserId);
  setCurrentProject(null, limitedUserId);
});

const VALID_BODY = {
  oldSelector: "[data-testid=submit]",
  actionDescription: "click submit",
  errorMessage: "Timed out waiting for selector",
  pageUrl: "https://example.com/login",
  domSnippet: "<button data-testid=\"login-submit\">Submit</button>",
  priorSteps: ["goto https://example.com/login", "fill #user with 'u'"],
};

const SUCCESS_VALUE = {
  suggestedSelector: "[data-testid=login-submit]",
  confidence: "high" as const,
  explanation: "Use the more specific login-submit testid that's still present.",
  model: "claude-3-5-sonnet-20241022",
  provider: "anthropic",
  tokensIn: 123,
  tokensOut: 45,
};

describe("POST /api/selectors/heal/ai-suggest — success path", () => {
  it("returns suggestion fields and writes an ai_selector_heal_suggest audit row", async () => {
    setCurrentProject(makeProject(), adminUserId);
    vi.mocked(suggestSelectorFix).mockResolvedValue(ok(SUCCESS_VALUE));

    const res = await fetch(`${baseUrl}/api/selectors/heal/ai-suggest`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      suggestedSelector: SUCCESS_VALUE.suggestedSelector,
      confidence: SUCCESS_VALUE.confidence,
      explanation: SUCCESS_VALUE.explanation,
      model: SUCCESS_VALUE.model,
      provider: SUCCESS_VALUE.provider,
      tokensIn: SUCCESS_VALUE.tokensIn,
      tokensOut: SUCCESS_VALUE.tokensOut,
    });

    // The use case got the request context unchanged.
    expect(suggestSelectorFix).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(suggestSelectorFix).mock.calls[0]![0]!;
    expect(arg.projectName).toBe(PROJECT_NAME);
    expect(arg.oldSelector).toBe(VALID_BODY.oldSelector);
    expect(arg.context.actionDescription).toBe(VALID_BODY.actionDescription);
    expect(arg.context.errorMessage).toBe(VALID_BODY.errorMessage);
    expect(arg.context.pageUrl).toBe(VALID_BODY.pageUrl);
    expect(arg.context.domSnippet).toBe(VALID_BODY.domSnippet);
    expect(arg.context.priorSteps).toEqual(VALID_BODY.priorSteps);

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditArg = vi.mocked(recordAudit).mock.calls[0]![0] as {
      action: string;
      details: Record<string, unknown>;
    };
    expect(auditArg.action).toBe("ai_selector_heal_suggest");
    expect(auditArg.details).toMatchObject({
      oldSelector: VALID_BODY.oldSelector,
      suggestedSelector: SUCCESS_VALUE.suggestedSelector,
      provider: SUCCESS_VALUE.provider,
      model: SUCCESS_VALUE.model,
      confidence: SUCCESS_VALUE.confidence,
      tokensIn: SUCCESS_VALUE.tokensIn,
      tokensOut: SUCCESS_VALUE.tokensOut,
    });
  });
});

describe("POST /api/selectors/heal/ai-suggest — error mapping", () => {
  it("provider/infrastructure error → 502 with kind:infrastructure and no audit row", async () => {
    setCurrentProject(makeProject(), adminUserId);
    vi.mocked(suggestSelectorFix).mockResolvedValue(
      err(infrastructureError("The AI provider failed (HTTP 503).")),
    );

    const res = await fetch(`${baseUrl}/api/selectors/heal/ai-suggest`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind: string };
    expect(body.kind).toBe("infrastructure");
    expect(body.error).toMatch(/AI provider failed/);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("missing AI key → 404 with kind:not_found (UI flips to no_key state)", async () => {
    setCurrentProject(makeProject(), adminUserId);
    vi.mocked(suggestSelectorFix).mockResolvedValue(
      err(
        notFoundError(
          "ai_agent",
          "NO_API_KEY",
          "No AI provider API key is configured.",
        ),
      ),
    );

    const res = await fetch(`${baseUrl}/api/selectors/heal/ai-suggest`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; kind: string };
    expect(body.kind).toBe("not_found");
    expect(body.error).toMatch(/No AI provider API key/i);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("POST /api/selectors/heal/ai-suggest — schema + auth guards", () => {
  it("400 when the request body fails Zod validation (empty oldSelector)", async () => {
    setCurrentProject(makeProject(), adminUserId);
    const res = await fetch(`${baseUrl}/api/selectors/heal/ai-suggest`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ ...VALID_BODY, oldSelector: "" }),
    });
    expect(res.status).toBe(400);
    expect(suggestSelectorFix).not.toHaveBeenCalled();
  });

  it("401 without a session cookie", async () => {
    const res = await fetch(`${baseUrl}/api/selectors/heal/ai-suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(401);
    expect(suggestSelectorFix).not.toHaveBeenCalled();
  });

  it("404 when signed in but no project is loaded (shared guard rejects first)", async () => {
    const res = await fetch(`${baseUrl}/api/selectors/heal/ai-suggest`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(404);
    expect(suggestSelectorFix).not.toHaveBeenCalled();
  });

  it("403 for an unassigned limited_admin (project-scope gate)", async () => {
    setCurrentProject(makeProject(), limitedUserId);
    const res = await fetch(`${baseUrl}/api/selectors/heal/ai-suggest`, {
      method: "POST",
      headers: withCookie(limitedCookie, { "content-type": "application/json" }),
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(403);
    expect(suggestSelectorFix).not.toHaveBeenCalled();
  });
});

describe("GET /api/selectors/heal/ai-available", () => {
  it("returns {available:true, provider} when a key is configured", async () => {
    setCurrentProject(makeProject(), adminUserId);
    vi.mocked(assertAgentReady).mockResolvedValue({
      provider: "anthropic",
      apiKey: "redacted",
      extras: { model: "claude-3-5-sonnet-20241022" },
    } as Awaited<ReturnType<typeof assertAgentReady>>);

    const res = await fetch(`${baseUrl}/api/selectors/heal/ai-available`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      available: boolean;
      provider?: string;
    };
    expect(body.available).toBe(true);
    expect(body.provider).toBe("anthropic");
  });

  it("returns {available:false, reason:NO_API_KEY, setupHref} on AiAgentDisabledError — never 5xx", async () => {
    setCurrentProject(makeProject(), adminUserId);
    vi.mocked(assertAgentReady).mockRejectedValue(
      new AiAgentDisabledError("NO_API_KEY"),
    );

    const res = await fetch(`${baseUrl}/api/selectors/heal/ai-available`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      available: boolean;
      reason?: string;
      message?: string;
      setupHref?: string;
    };
    expect(body.available).toBe(false);
    expect(body.reason).toBe("NO_API_KEY");
    expect(body.setupHref).toBe("/tools/ai-agent");
    expect(body.message).toMatch(/AI provider API key/i);
  });

  it("returns {available:false, reason:no_project} when no project is loaded", async () => {
    const res = await fetch(`${baseUrl}/api/selectors/heal/ai-available`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      available: boolean;
      reason?: string;
    };
    expect(body.available).toBe(false);
    expect(body.reason).toBe("no_project");
  });

  it("401 without a session cookie", async () => {
    const res = await fetch(`${baseUrl}/api/selectors/heal/ai-available`);
    expect(res.status).toBe(401);
  });
});
