import { describe, it, expect } from "vitest";
import {
  advanceAndClassify,
  classifyBffEndpoint,
  classifyEventStream,
  looksLikeIdpRequest,
} from "@/features/jmx/infrastructure/bffEndpointClassifier";
import type { JmxHttpEvent } from "@/features/jmx/domain/types";

function evt(partial: Partial<JmxHttpEvent>): JmxHttpEvent {
  return {
    method: "GET",
    url: "https://app.example.com/",
    headers: {},
    contentType: "",
    bodyText: "",
    statusCode: 200,
    responseBody: "",
    timestamp: 0,
    ...partial,
  };
}

describe("classifyBffEndpoint", () => {
  const targetUrl = "https://app.example.com";

  it("classifies same-origin as bff", () => {
    const cls = classifyBffEndpoint(
      evt({ url: "https://app.example.com/api/login" }),
      { targetUrl, idpHosts: new Set() },
    );
    expect(cls).toBe("bff");
  });

  it("classifies cross-origin defaults as upstream", () => {
    const cls = classifyBffEndpoint(
      evt({ url: "https://api.thirdparty.com/v1/widgets" }),
      { targetUrl, idpHosts: new Set() },
    );
    expect(cls).toBe("upstream");
  });

  it("classifies hosts already known as IdPs as idp", () => {
    const cls = classifyBffEndpoint(
      evt({ url: "https://login.idp.example.com/token" }),
      { targetUrl, idpHosts: new Set(["login.idp.example.com"]) },
    );
    expect(cls).toBe("idp");
  });

  it("recognizes OAuth marker paths as idp via heuristic", () => {
    expect(
      classifyBffEndpoint(
        evt({ url: "https://login.idp.example.com/oauth2/authorize?x=1" }),
        { targetUrl, idpHosts: new Set() },
      ),
    ).toBe("idp");
    expect(
      classifyBffEndpoint(
        evt({
          url: "https://login.idp.example.com/.well-known/openid-configuration",
        }),
        { targetUrl, idpHosts: new Set() },
      ),
    ).toBe("idp");
  });

  it("falls through to upstream for malformed urls or empty target", () => {
    expect(
      classifyBffEndpoint(evt({ url: "not-a-url" }), {
        targetUrl,
        idpHosts: new Set(),
      }),
    ).toBe("upstream");
    expect(
      classifyBffEndpoint(evt({ url: "https://x.example.com/foo" }), {
        targetUrl: "",
        idpHosts: new Set(),
      }),
    ).toBe("upstream");
  });

  it("looksLikeIdpRequest matches authorize/token/discovery; rejects others", () => {
    expect(
      looksLikeIdpRequest(
        evt({ url: "https://idp.example.com/connect/token" }),
      ),
    ).toBe(true);
    expect(
      looksLikeIdpRequest(evt({ url: "https://app.example.com/api/users" })),
    ).toBe(false);
  });
});

describe("advanceAndClassify", () => {
  it("grows the sticky idpHosts set in place when an OAuth marker path appears", () => {
    const idpHosts = new Set<string>();
    const ctx = { targetUrl: "https://app.example.com", idpHosts };

    // First request to the IdP host hits a marker path — promotes the
    // host into the sticky set AND returns `idp`.
    const first = advanceAndClassify(
      evt({ url: "https://idp.example.com/oauth2/token" }),
      ctx,
    );
    expect(first).toBe("idp");
    expect(idpHosts.has("idp.example.com")).toBe(true);

    // Follow-up call to a non-marker path on the same host: still
    // `idp` because the sticky set was advanced by the previous call.
    const second = advanceAndClassify(
      evt({ url: "https://idp.example.com/userinfo" }),
      ctx,
    );
    expect(second).toBe("idp");
  });

  it("tolerates an empty targetUrl — IdP detection still works, BFF falls through to upstream", () => {
    const ctx = { targetUrl: "", idpHosts: new Set<string>() };
    expect(
      advanceAndClassify(
        evt({ url: "https://idp.example.com/connect/authorize" }),
        ctx,
      ),
    ).toBe("idp");
    expect(
      advanceAndClassify(
        evt({ url: "https://app.example.com/api/me" }),
        ctx,
      ),
    ).toBe("upstream");
  });
});

describe("classifyEventStream", () => {
  it("promotes a host to IdP once a marker path is seen, then sticks", () => {
    const events: JmxHttpEvent[] = [
      evt({ url: "https://app.example.com/" }),
      evt({
        url: "https://idp.example.com/.well-known/openid-configuration",
      }),
      evt({ url: "https://idp.example.com/oauth2/authorize?x=1" }),
      evt({ url: "https://idp.example.com/some-other-page" }),
      evt({ url: "https://api.third.com/v1/foo" }),
      evt({ url: "https://app.example.com/api/me" }),
    ];
    const cls = classifyEventStream(events, "https://app.example.com");
    expect(cls).toEqual([
      "bff",
      "idp",
      "idp",
      "idp",
      "upstream",
      "bff",
    ]);
  });
});
