import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * End-to-end Playwright spec for task #5 — JMX no auto-record. Drives
 * the live api-server + test-builder workflows behind the shared
 * proxy. Gated on `E2E_API_BASE_URL` (e.g. `http://localhost:80`) with
 * `APP_ENVIRONMENT=development` on the api-server so `dev-login` and
 * the `/api/recording/dev-fixture-login` page are both enabled.
 *
 * Asserts the new "preview-on-create, record-on-click" contract:
 *
 *   1. Create a JMX project from the **UI** (`Projects → New project →
 *      JMX tab → Create`). Driving the UI is load-bearing: only the
 *      UI's create-success handler sets the in-memory `jmx-auto-start`
 *      marker that the workbench's `<JmxRecordingControls />` consumes
 *      on mount. Creating via API alone would NOT auto-open the
 *      preview.
 *   2. Workbench mounts, auto-opens the recorder browser at the
 *      project's `targetUrl` (the dev-fixture login page) in
 *      PREVIEW mode. Assert `GET /api/jmx/recording/status` returns
 *      a non-null `sessionId` with `isCapturing === false`, the
 *      toolbar shows `button-start-recording` (NOT
 *      `button-stop-recording`), and the live canvas reports
 *      `jmx-canvas-status-preview`.
 *   3. Click `button-start-recording`. The preview is ARMED via
 *      `POST /api/jmx/recording/arm` (observed via
 *      `page.waitForRequest`) — never a second
 *      `/api/jmx/recording/start`. Status flips to
 *      `isCapturing: true` and the toolbar swaps to
 *      `button-stop-recording`.
 *   4. Drive a couple of in-browser interactions by piggy-backing on
 *      the existing JMX screencast WebSocket (`/ws/jmx-recording`)
 *      and sending two `navigate` messages — this triggers real
 *      Document-typed HTTP requests inside the headless recorder
 *      Chromium, which the just-armed CDP `Network.*` listeners
 *      capture.
 *   5. Click `button-stop-recording`. The stop response carries a
 *      non-null `jmxFilePath`, `project.jmxFiles` now contains the
 *      new `.jmx` row, and the Explorer's JMX files tab renders the
 *      matching `jmx-file-row-<relPath>` element.
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
      lastName: "JmxNoAutoRecord",
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

/**
 * Drive the headless recorder Chromium from the test page by piggy-
 * backing on the in-page session cookie — opens a new WebSocket to
 * `/ws/jmx-recording` and posts a `navigate` message. The
 * just-armed CDP `Network.*` listeners capture the resulting
 * Document request as a sampler.
 */
async function navigateRecorderBrowser(
  page: Page,
  sessionId: string,
  url: string,
): Promise<void> {
  await page.evaluate(
    async ({ sid, target }) => {
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
          // Give the recorder Chromium time to issue the request and
          // CDP to round-trip the response before we close.
          setTimeout(() => {
            ws.close();
            resolve();
          }, 1_500);
        };
        ws.onerror = (e) => {
          clearTimeout(timer);
          reject(new Error(`WS error: ${String((e as Event).type)}`));
        };
      });
    },
    { sid: sessionId, target: url },
  );
}

test.describe("JMX no auto-record (#5)", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec.",
  );
  test.setTimeout(180_000);

  test("preview-on-create, arm on Start Recording, .jmx in Explorer on Stop", async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now().toString(36)}`;
    const username = `e2e-jmxnoauto-${suffix}`;
    const solutionName = `JmxNoAutoRecord${suffix}`;
    const targetUrl = `${BASE}/api/recording/dev-fixture-login`;

    await devLoginAdmin(request, username);

    // Drive the UI create path so the in-memory `jmx-auto-start`
    // marker is set — that marker is what tells the workbench to
    // open the preview browser on mount.
    await seedPageSession(page, username);
    await page.goto(`${BASE}/projects`);
    await dismissTour(page);
    await page.getByTestId("button-new-project").click();
    await page.getByTestId("tab-new-project-jmx").click();
    await page.getByTestId("input-jmx-name").fill(solutionName);
    await page.getByTestId("input-jmx-target-url").fill(targetUrl);
    await page.getByTestId("button-create-jmx-project").click();

    // Navigates to /workbench and auto-opens the preview.
    await page.waitForURL(/\/workbench/, { timeout: 30_000 });
    await dismissTour(page);

    // Step 2 — assert preview phase (sessionId set, isCapturing false).
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
    expect(previewStatus.sessionId).not.toBeNull();
    expect(previewStatus.isCapturing).toBe(false);
    const sessionId = previewStatus.sessionId as string;

    // Toolbar reflects preview phase: Start Recording visible,
    // Stop Recording NOT present.
    await expect(page.getByTestId("button-start-recording")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("button-stop-recording")).toHaveCount(0);
    await expect(page.getByTestId("jmx-canvas-status-preview")).toBeVisible({
      timeout: 10_000,
    });

    // Step 3 — click Start Recording. Must route through
    // /api/jmx/recording/arm, NEVER through a second /start.
    let startCalled = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/jmx/recording/start")) startCalled = true;
    });
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
    expect(
      startCalled,
      "no second /api/jmx/recording/start request after Start Recording was clicked",
    ).toBe(false);

    await expect(page.getByTestId("button-stop-recording")).toBeVisible({
      timeout: 10_000,
    });

    // Step 4 — drive two captured interactions by re-navigating the
    // headless recorder Chromium. Document-typed navigations are NOT
    // in the NOISY_RESOURCE_TYPES set, so CDP captures both.
    await navigateRecorderBrowser(page, sessionId, targetUrl);
    await navigateRecorderBrowser(
      page,
      sessionId,
      `${BASE}/api/recording/dev-fixture-login?second`,
    );

    // Step 5 — click Stop Recording. Stop response must carry the
    // emitted .jmx file path, and project.jmxFiles + the Explorer
    // panel must reflect it.
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

    // Server-side: the marker file on disk (`.testbuilder.json#jmxFiles`)
    // is indexed by the file writer, AND `stopJmxRecording` rewrites
    // the in-memory current-project cache for the user with the
    // refreshed `jmxFiles` list (task #50) so the workbench's next
    // `/api/projects/current` poll sees the new row without a reload.
    //
    // UI: the Explorer's JMX files tab renders the file row. The
    // panel auto-refreshes when the current-project query invalidates
    // on stop.
    await expect(page.getByTestId("button-stop-recording")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByTestId(`jmx-file-row-${jmxRelPath}`)).toBeVisible({
      timeout: 15_000,
    });
  });
});
