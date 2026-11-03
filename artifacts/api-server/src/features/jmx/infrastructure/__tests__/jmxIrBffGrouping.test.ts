import { describe, it, expect } from "vitest";
import { buildJmxTree } from "@/features/jmx/infrastructure/jmxIr";
import { serializeJmxTree } from "@/features/jmx/infrastructure/jmxSerializer";
import type {
  JmxExportOptions,
  JmxHttpEvent,
} from "@/features/jmx/domain/types";

function evt(p: Partial<JmxHttpEvent>): JmxHttpEvent {
  return {
    method: "GET",
    url: "https://app.example.com/",
    headers: {},
    contentType: "",
    bodyText: "",
    statusCode: 200,
    responseBody: "",
    timestamp: 0,
    ...p,
  };
}

const baseOptions = (over: Partial<JmxExportOptions> = {}): JmxExportOptions => ({
  embedCredentials: true,
  jwtAuth: false,
  baseUrl: "https://app.example.com",
  csvMode: "off",
  ...over,
});

describe("buildJmxTree BFF grouping", () => {
  const events: JmxHttpEvent[] = [
    evt({ method: "GET", url: "https://app.example.com/api/me" }),
    evt({
      method: "GET",
      url: "https://idp.example.com/.well-known/openid-configuration",
    }),
    evt({ method: "POST", url: "https://idp.example.com/oauth2/token" }),
    evt({ method: "GET", url: "https://api.third.com/v1/widgets" }),
    evt({ method: "POST", url: "https://app.example.com/api/orders" }),
  ];

  it("bff=false leaves the existing flat sampler layout unchanged", () => {
    const tree = buildJmxTree(events, baseOptions({ bff: false }));
    const tg = tree.testPlan.children?.[0];
    const tags = (tg?.children ?? []).map((c) => c.tag);
    // Five flat samplers, no GenericControllers introduced by the BFF
    // grouping pass.
    expect(tags.filter((t) => t === "HTTPSamplerProxy")).toHaveLength(5);
    expect(tags.filter((t) => t === "GenericController")).toHaveLength(0);
    // Names are unprefixed.
    const xml = serializeJmxTree(tree);
    expect(xml).not.toContain("[BFF]");
    expect(xml).not.toContain("[IdP]");
    expect(xml).not.toContain("[Upstream]");
  });

  it("bff=true groups samplers under BFF/IdP/Upstream controllers and prefixes names", () => {
    const tree = buildJmxTree(events, baseOptions({ bff: true }));
    const tg = tree.testPlan.children?.[0];
    // Three controllers added at the end, after Defaults/Cookie/Header.
    const controllers = (tg?.children ?? []).filter(
      (c) => c.tag === "GenericController",
    );
    expect(controllers.map((c) => c.attrs?.testname)).toEqual([
      "BFF",
      "IdP",
      "Upstream API",
    ]);
    // No flat samplers should remain at the top level.
    expect(
      (tg?.children ?? []).filter((c) => c.tag === "HTTPSamplerProxy"),
    ).toHaveLength(0);
    // BFF bucket has 2 samplers, IdP 2, Upstream 1.
    expect(controllers[0]!.children?.length).toBe(2);
    expect(controllers[1]!.children?.length).toBe(2);
    expect(controllers[2]!.children?.length).toBe(1);
    // Sampler names carry the class prefix.
    const xml = serializeJmxTree(tree);
    expect(xml).toContain("[BFF] GET /api/me");
    expect(xml).toContain("[IdP] POST /oauth2/token");
    expect(xml).toContain("[Upstream] GET /v1/widgets");
  });

  it("omits empty class buckets (e.g. no IdP requests in this session)", () => {
    const onlyBff: JmxHttpEvent[] = [
      evt({ url: "https://app.example.com/a" }),
      evt({ url: "https://app.example.com/b" }),
    ];
    const tree = buildJmxTree(onlyBff, baseOptions({ bff: true }));
    const controllers = (tree.testPlan.children?.[0]?.children ?? []).filter(
      (c) => c.tag === "GenericController",
    );
    expect(controllers.map((c) => c.attrs?.testname)).toEqual(["BFF"]);
  });
});
