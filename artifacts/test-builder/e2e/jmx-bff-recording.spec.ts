import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { startBffStub, type BffStub } from "./fixtures/bff-stub";

/**
 * End-to-end Playwright spec for task #17 — JMX BFF recording smoke
 * test. Drives the live api-server + test-builder workflows behind
 * the shared proxy (gated on `E2E_API_BASE_URL`, e.g.
 * `http://localhost:80`, with `APP_ENVIRONMENT=development` so
 * `/api/auth/dev-login` works). The test:
 *
 *   1. Stands up three stub HTTP servers on 127.0.0.1 (BFF + IdP +
 *      Upstream) representing a complete BFF-style OAuth +
 *      double-submit-CSRF dance — see `fixtures/bff-stub.ts`.
 *   2. Creates a JMX project from the UI with the **BFF
 *      (Backend-for-Frontend) auth** checkbox ticked, pointing at the
 *      BFF stub's `/start` URL. The marker file persists `bff: true`
 *      and the JMX recorder loads that flag at session start so the
 *      classifier + body capture + storageState capture all branch on.
 *   3. Drives the headless recorder Chromium through the dance via
 *      `/ws/jmx-recording` `navigate` messages (the same hook
 *      `jmx-no-auto-record.spec.ts` uses): BFF/start → IdP/authorize
 *      (302 → BFF/callback?code=...&state=...) → callback's inline
 *      script POSTs the code to IdP/token (the OAuth code-exchange
 *      leg), then issues the protected fetch with `X-XSRF-TOKEN`
 *      echoed from the cookie (the BFF rejects the request with 403
 *      unless the double-submit header matches the cookie, so a
 *      regression in the callback script fails the capture loudly
 *      instead of silently), plus a cross-origin fetch to the
 *      upstream API.
 *   4. Stops the recording and reads the emitted `.jmx` file. Asserts
 *      the IR's BFF grouping (controllers `BFF`, `IdP`,
 *      `Upstream API`), the OAuth correlation Regex Extractors
 *      (`OAuth extractor (state ...)` + `OAuth extractor (code ...)`),
 *      the CSRF double-submit substitution (literal `X-XSRF-TOKEN`
 *      header value rewritten to `${csrf_token}`, the literal token
 *      value does NOT leak into the serialized XML), and that an
 *      `auth_states` row was written for this project (task #16
 *      storageState capture only fires when `bff:true`).
 */

const BASE = process.env.E2E_API_BASE_URL;

interface JmxStatus {
  sessionId: string | null;
  isCapturing: boolean;
}

async function devLoginAdmin(
  request: APIRequestContext,
  username: string,
): Promise<void> {
  const res = await request.get(
    `${BASE}/api/auth/dev-login?email=${encodeURIComponent(username + "@example.com")}&role=admin`,
  );
  expect(res.ok(), `dev-login(${username}) failed`).toBeTruthy();
  const profile = await request.put(`${BASE}/api/auth/profile`, {
    data: {
      firstName: "E2E",
      lastName: "JmxBffRecording",
      title: "QA",
      email: `${username}@example.com`,
    },
  });
  expect(profile.ok()).toBeTruthy();
}

async function seedPageSession(page: Page, username: string): Promise<void> {
  const res = await page.goto(
    `${BASE}/api/auth/dev-login?email=${encodeURIComponent(username + "@example.com")}&role=admin`,
  );
  expect(res?.ok(), "page dev-login").toBeTruthy();
}

async function dismissTour(page: Page): Promise<void> {
  const tourClose = page.getByTestId("button-tour-close");
  try {
    await tourClose.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    return;
  }
  await tourClose.click();
  await expect(page.getByTestId("onboarding-tour-overlay")).toHaveCount(0);
}

async function getJmxStatus(
  request: APIRequestContext,
): Promise<JmxStatus> {
  const res = await request.get(`${BASE}/api/jmx/recording/status`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as JmxStatus;
}

async function navigateRecorderBrowser(
  page: Page,
  sessionId: string,
  url: string,
  waitMs = 2_500,
): Promise<void> {
  await page.evaluate(
    async ({ sid, target, hold }) => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${proto}//${window.location.host}/ws/jmx-recording?sessionId=${encodeURIComponent(sid)}`,
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("WS open timed out")),
          10_000,
        );
        ws.onopen = () => {
          clearTimeout(timer);
          ws.send(JSON.stringify({ type: "navigate", url: target }));
          // Hold the WS open long enough for the recorder Chromium to
          // (a) issue the navigation, (b) follow any 302 redirects,
          // (c) execute the page's inline <script> fetches, and
          // (d) round-trip CDP `Network.*` events back to the recorder.
          setTimeout(() => {
            ws.close();
            resolve();
          }, hold);
        };
        ws.onerror = (e) => {
          clearTimeout(timer);
          reject(new Error(`WS error: ${String((e as Event).type)}`));
        };
      });
    },
    { sid: sessionId, target: url, hold: waitMs },
  );
}

test.describe("JMX BFF recording smoke (#17)", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec.",
  );
  test.setTimeout(240_000);

  let stub: BffStub;

  test.beforeAll(async () => {
    stub = await startBffStub();
  });

  test.afterAll(async () => {
    if (stub) await stub.close();
  });

  test("BFF/IdP/Upstream grouping + OAuth extractors + CSRF rewrite + auth_states row", async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now().toString(36)}`;
    const username = `e2e-jmxbff-${suffix}`;
    const solutionName = `JmxBffRecording${suffix}`;
    const { urls } = stub;
    const startUrl = `${urls.bffUrl}/start`;

    await devLoginAdmin(request, username);

    // --- Create JMX project from the UI with BFF checkbox ON --------------
    await seedPageSession(page, username);
    await page.goto(`${BASE}/projects`);
    await dismissTour(page);
    await page.getByTestId("button-new-project").click();
    await page.getByTestId("tab-new-project-jmx").click();
    await page.getByTestId("input-jmx-name").fill(solutionName);
    await page.getByTestId("input-jmx-target-url").fill(startUrl);
    await page.getByTestId("checkbox-jmx-bff").check();
    await page.getByTestId("button-create-jmx-project").click();

    await page.waitForURL(/\/workbench/, { timeout: 30_000 });
    await dismissTour(page);

    // --- Auto-opened preview session: assert and capture sessionId -------
    await expect
      .poll(
        async () => {
          const s = await getJmxStatus(request);
          return s.sessionId !== null && s.isCapturing === false;
        },
        {
          timeout: 30_000,
          message: "JMX status reports preview (session live, not capturing)",
        },
      )
      .toBe(true);
    const previewStatus = await getJmxStatus(request);
    const sessionId = previewStatus.sessionId as string;

    await expect(page.getByTestId("button-start-recording")).toBeVisible({
      timeout: 10_000,
    });

    // --- Arm capture via Start Recording ---------------------------------
    const armRequest = page.waitForRequest(
      (req) =>
        req.url().includes("/api/jmx/recording/arm") && req.method() === "POST",
      { timeout: 15_000 },
    );
    await page.getByTestId("button-start-recording").click();
    await armRequest;

    await expect
      .poll(
        async () => (await getJmxStatus(request)).isCapturing,
        { timeout: 15_000, message: "JMX status flips to capturing" },
      )
      .toBe(true);

    // --- Drive the BFF dance via WS navigate -----------------------------
    // 1. Visit BFF /start to set the XSRF-TOKEN cookie + render the
    //    page with the IdP authorize link.
    await navigateRecorderBrowser(page, sessionId, startUrl, 2_000);
    // 2. Navigate to the IdP authorize endpoint. It 302s straight to
    //    BFF /callback?code=...&state=...; the recorder Chromium
    //    follows the redirect, runs the callback page's inline script
    //    (which fires the CSRF-bearing protected fetch + the
    //    upstream-API fetch), so CDP captures every leg.
    const authorizeUrl =
      `${urls.idpUrl}/authorize?response_type=code` +
      `&client_id=bff` +
      `&state=${encodeURIComponent(urls.state)}` +
      `&nonce=NC_nonce_abcdef123456` +
      `&redirect_uri=${encodeURIComponent(`${urls.bffUrl}/callback`)}`;
    await navigateRecorderBrowser(page, sessionId, authorizeUrl, 4_000);

    // --- Stop recording: assert .jmx path returned -----------------------
    const stopResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/jmx/recording/stop") &&
        resp.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.getByTestId("button-stop-recording").click();
    const stopResp = await stopResponse;
    expect(stopResp.ok()).toBeTruthy();
    const stopBody = (await stopResp.json()) as {
      jmxFilePath: string | null;
      eventCount: number;
    };
    expect(
      stopBody.jmxFilePath,
      "stop response should carry the emitted .jmx file path",
    ).not.toBeNull();
    expect(stopBody.eventCount).toBeGreaterThan(0);
    const jmxRelPath = stopBody.jmxFilePath as string;

    // --- Load the saved .jmx file via /api/files -------------------------
    const fileRes = await request.get(
      `${BASE}/api/files?path=${encodeURIComponent(jmxRelPath)}`,
    );
    expect(fileRes.ok(), "GET /api/files for the emitted .jmx").toBeTruthy();
    const fileBody = (await fileRes.json()) as { content: string };
    const xml = fileBody.content;
    expect(xml.length).toBeGreaterThan(0);

    // --- BFF grouping: three controllers `BFF`, `IdP`, `Upstream API` ---
    expect(xml, "BFF controller node").toMatch(/testname="BFF"/);
    expect(xml, "IdP controller node").toMatch(/testname="IdP"/);
    expect(xml, "Upstream API controller node").toMatch(
      /testname="Upstream API"/,
    );

    // --- OAuth correlation: Regex Extractors for state + code -----------
    expect(xml, "OAuth state extractor").toMatch(
      /OAuth extractor \(state/,
    );
    expect(xml, "OAuth code extractor").toMatch(
      /OAuth extractor \(code/,
    );

    // --- CSRF double-submit: literal X-XSRF-TOKEN value rewritten to
    //     `${csrf_token}`. The literal cookie token (`urls.csrfToken`)
    //     must NOT survive in the serialized XML — that's how we know
    //     `replaceLiterals` swept the consumer header / body.
    expect(xml, "CSRF var substitution").toContain("${csrf_token}");
    expect(
      xml.includes(urls.csrfToken),
      `CSRF literal token (${urls.csrfToken}) should not appear in the emitted XML`,
    ).toBe(false);

    // --- auth_states row: storageState capture fires only when bff:true.
    //     The JMX recorder writes the row keyed by (userId, projectName)
    //     where projectName is the JMX project's solution name. We
    //     verify it through `GET /api/auth-state` which the workbench
    //     uses — by this point the workbench has the JMX project
    //     loaded as the current project, so the route resolves to the
    //     same row.
    await expect
      .poll(
        async () => {
          const res = await request.get(`${BASE}/api/auth-state`);
          if (!res.ok()) return null;
          const body = (await res.json()) as {
            hasState: boolean;
            label: string | null;
          };
          return body.hasState ? body.label : null;
        },
        {
          timeout: 15_000,
          message: "auth_states row written for the JMX BFF session",
        },
      )
      .toMatch(/^JMX session /);
  });
});
