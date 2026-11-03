import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { assertResponseShape } from "@/shared/assertResponseShape";
import { GetAiAgentOrgConfigResponse } from "@workspace/api-zod";

vi.mock("@/shared/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("assertResponseShape()", () => {
  it("returns the parsed value untouched on a valid payload", () => {
    const valid = {
      organizationId: "org-1",
      enabled: true,
      provider: "openai" as const,
      apiKeyLastFour: "abcd",
      model: "gpt-4o-mini",
      endpointUrl: "https://api.openai.com/v1",
      apiVersion: "2024-02-15-preview",
      refererUrl: "https://memento.local",
      appName: "Memento",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = assertResponseShape(
      GetAiAgentOrgConfigResponse,
      valid,
      "GET /ai-agent/org-config",
    );
    expect(result).toMatchObject(valid);
  });

  it("throws with a route-tagged message on a known-bad payload", () => {
    const invalid = {
      organizationId: "org-1",
      enabled: "yes", // wrong type
      provider: "openai",
      apiKeyLastFour: null,
      updatedAt: null,
    };
    expect(() =>
      assertResponseShape(
        GetAiAgentOrgConfigResponse,
        invalid,
        "GET /ai-agent/org-config",
      ),
    ).toThrow(/AI Agent response schema mismatch on GET \/ai-agent\/org-config/);
  });

  it("includes the failing field path in the thrown message", () => {
    const schema = z.object({
      foo: z.object({
        bar: z.number(),
      }),
    });
    expect(() =>
      assertResponseShape(schema, { foo: { bar: "nope" } }, "TEST /route"),
    ).toThrow(/foo\.bar/);
  });
});
