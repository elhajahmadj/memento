import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";

process.env.PROJECT_SECRETS_KEY ??=
  "vitest-ai-assists-secret-xxxxxxxxxxxxxx";

/**
 * Tests for the single AI-assist dispatch endpoint
 *
 *   POST /api/ai-agent/assists/:purpose
 *
 * shipped with task #17. Covers every registered purpose for the
 * happy path, plus the four normalized failure modes the route maps
 * out of `AiAssistError`:
 *
 *   - 503 "disabled"   — org/project disabled or no key configured
 *   - 502 "provider"   — upstream LLM 4xx/5xx
 *   - 502 "bad_output" — model returned no parseable JSON / wrong shape
 *   - 400              — input fails the per-purpose Zod schema
 *   - 404              — unknown purpose id
 *
 * The `chat()` call out to the real provider is mocked module-wide so
 * the tests never hit a live LLM, and `assertAgentReady` is mocked so
 * the tests don't need a real org-config row + ai_agent_keys row.
 *
 * The route also pipes its response through `assertResponseShape`
 * against a local Zod schema; the happy-path assertions therefore
 * double as the schema-mismatch regression guard task #24 calls for.
 */

const { chatMock, assertAgentReadyMock } = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chatMock: vi.fn<(...args: any[]) => any>(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assertAgentReadyMock: vi.fn<(...args: any[]) => any>(),
}));

vi.mock("@/features/ai-agent/infrastructure/llmProviders", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/ai-agent/infrastructure/llmProviders")
  >("@/features/ai-agent/infrastructure/llmProviders");
  return { ...actual, chat: chatMock };
});

vi.mock("@/features/ai-agent/infrastructure/aiAgentService", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/ai-agent/infrastructure/aiAgentService")
  >("@/features/ai-agent/infrastructure/aiAgentService");
  return { ...actual, assertAgentReady: assertAgentReadyMock };
});

import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import {
  createProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import {
  AiAgentDisabledError,
  AiProviderError,
} from "@/features/ai-agent/domain/types";
import { listAiAssistPurposeIds } from "@/features/ai-agent/infrastructure/aiAssistPurposes";

const ADMIN_USERNAME = "vitest-ai-assists-admin";
let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let adminUserId = "";

const FAKE_CREDS = {
  provider: "anthropic" as const,
  apiKey: "sk-test",
  extras: { model: "claude-3-5-sonnet" },
};

/**
 * Canned JSON payloads — one per registered purpose — shaped so each
 * purpose's output Zod schema validates cleanly.
 */
const CANNED_OUTPUT: Record<string, unknown> = {
  "step-from-text": {
    verb: "click",
    selector: "text=Sign In",
    explanation: "Click the Sign In button.",
  },
  "assertion-from-text": {
    kind: "element-visible",
    target: "text=Welcome",
    explanation: "Welcome banner should be visible.",
  },
  "test-ideas-from-url": {
    ideas: [
      {
        name: "Sign-up happy path",
        oneLineDescription: "A new user can sign up successfully.",
        suggestedSteps: ["Navigate to /signup", "Fill email", "Click Submit"],
      },
    ],
  },
  "failure-reason": {
    plainEnglishReason: "The Sign In button never appeared.",
    suggestedNextAction: "Wait longer — the page seems slow.",
  },
  "suite-summary": {
    summaryMarkdown: "## What this suite covers\n- login\n",
  },
  "doc-page": {
    markdown: "# Project\n## What the app appears to do\nIt does things.\n",
  },
};

const SAMPLE_INPUT: Record<string, unknown> = {
  "step-from-text": { text: "Click the Sign In button" },
  "assertion-from-text": { text: "I expect to see the Welcome banner" },
  "test-ideas-from-url": { url: "https://example.com" },
  "failure-reason": {
    stepDescription: "Click Sign In",
    errorMessage: "Timeout 30s exceeded waiting for selector text=Sign In",
  },
  "suite-summary": { projectName: "Demo", testNames: ["LoginTest"] },
  "doc-page": { projectName: "Demo", testNames: ["LoginTest"] },
};

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const u = await provisionUser({ username: ADMIN_USERNAME, role: "admin" });
  adminUserId = u.id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
});

afterAll(async () => {
  setCurrentProject(null, adminUserId);
  await deleteUserByUsername(ADMIN_USERNAME);
  await close();
});

beforeEach(async () => {
  chatMock.mockReset();
  assertAgentReadyMock.mockReset();
  assertAgentReadyMock.mockResolvedValue(FAKE_CREDS);
  const project = await createProject({
    solutionName: "AiAssistsTest",
    namespace: "AiAssistsTest.QA",
  });
  setCurrentProject(project, adminUserId);
});

async function post(purpose: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/ai-agent/assists/${purpose}`, {
    method: "POST",
    headers: withCookie(adminCookie, { "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai-agent/assists/:purpose — happy path", () => {
  for (const purposeId of listAiAssistPurposeIds()) {
    it(`returns the model output for "${purposeId}" with the standard wrapper shape`, async () => {
      chatMock.mockResolvedValue({
        text: JSON.stringify(CANNED_OUTPUT[purposeId]),
        finishReason: "stop",
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      });
      const res = await post(purposeId, SAMPLE_INPUT[purposeId]);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        output: unknown;
        model: string | null;
        usage: { promptTokens: number; completionTokens: number; totalTokens: number };
        purpose: string;
      };
      // Wrapper shape — what `assertResponseShape` on the route guards.
      expect(body.purpose).toBe(purposeId);
      expect(body.model).toBe(FAKE_CREDS.extras.model);
      expect(body.usage.totalTokens).toBe(30);
      expect(body.output).toEqual(CANNED_OUTPUT[purposeId]);
      expect(chatMock).toHaveBeenCalledTimes(1);
    });
  }
});

describe("POST /api/ai-agent/assists/:purpose — failure modes", () => {
  it("returns 503 + disabledReason when no key is configured", async () => {
    assertAgentReadyMock.mockRejectedValue(
      new AiAgentDisabledError("NO_API_KEY"),
    );
    const res = await post("step-from-text", SAMPLE_INPUT["step-from-text"]);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      code: string;
      disabledReason: string;
    };
    expect(body.code).toBe("disabled");
    expect(body.disabledReason).toBe("NO_API_KEY");
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("returns 503 when org is disabled", async () => {
    assertAgentReadyMock.mockRejectedValue(
      new AiAgentDisabledError("ORG_DISABLED"),
    );
    const res = await post("step-from-text", SAMPLE_INPUT["step-from-text"]);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { disabledReason: string };
    expect(body.disabledReason).toBe("ORG_DISABLED");
  });

  it("returns 502 + providerStatus when the upstream LLM errors", async () => {
    chatMock.mockRejectedValue(new AiProviderError(429, "rate limited"));
    const res = await post("step-from-text", SAMPLE_INPUT["step-from-text"]);
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      code: string;
      providerStatus: number;
    };
    expect(body.code).toBe("provider");
    expect(body.providerStatus).toBe(429);
  });

  it('returns 502 "bad_output" when the model returns no parseable JSON', async () => {
    chatMock.mockResolvedValue({
      text: "this is not JSON at all, sorry",
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    const res = await post("step-from-text", SAMPLE_INPUT["step-from-text"]);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("bad_output");
  });

  it('returns 502 "bad_output" when the model returns JSON of the wrong shape', async () => {
    chatMock.mockResolvedValue({
      text: JSON.stringify({ totally: "wrong" }),
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    const res = await post("step-from-text", SAMPLE_INPUT["step-from-text"]);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("bad_output");
  });

  it("returns 404 for an unknown purpose id", async () => {
    const res = await post("not-a-real-purpose", { text: "x" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the input fails the per-purpose Zod schema", async () => {
    // step-from-text requires `text` to be a non-empty string.
    const res = await post("step-from-text", { text: "" });
    expect(res.status).toBe(400);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("rejects requests when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await post("step-from-text", SAMPLE_INPUT["step-from-text"]);
    // The shared role middleware returns 404 when there's no current
    // project; the route's own "no project loaded" branch is a 400.
    // Both are acceptable — what matters is that we don't reach the
    // chat() call.
    expect([400, 404]).toContain(res.status);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await fetch(
      `${baseUrl}/api/ai-agent/assists/step-from-text`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(SAMPLE_INPUT["step-from-text"]),
      },
    );
    expect(res.status).toBe(401);
  });
});
