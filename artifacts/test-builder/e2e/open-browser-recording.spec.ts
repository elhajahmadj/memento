import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * End-to-end Playwright spec for the "Open Browser" recording flow
 * (task #119). Drives the live api-server + test-builder workflows
 * behind the shared proxy.
 *
 * The spec has three groups of checks:
 *
 *   1. **Per-language byte-identical named-URL store check** — the
 *      Workbench Actions → Open Browser → attach → Save flow is
 *      driven for each of the four supported languages (C#, Python,
 *      Node.js, Java). The "named-URL store" files on disk —
 *      `appsettings.json` (C# / Java) and `.env` (Python / Node.js)
 *      — must be byte-identical before vs. after the flow. The
 *      snapshot is computed by walking `/api/projects/tree` and
 *      reading every matching basename via `/api/files`, mirroring
 *      the server-side route test (`recording.openBrowser.routes.test.ts`).
 *
 *   2. **Single-language deep round-trip (C#)** — drives a real
 *      recording on top of an open browser, using the dev-only
 *      `/api/recording/dev-fixture-login` page as the start URL.
 *      That page self-fires `change` + `click` DOM events on load,
 *      so the recorder Chromium captures a real action sequence
 *      without the harness needing to drive the inner browser.
 *      Asserts:
 *        a. The attach-mode Start Recording dialog disables
 *           `#mode-new` (Create new test suite) and the
 *           `#target-before` / `#target-onetime` hook targets, so
 *           attach is restricted to "Add a new [Test] method" on
 *           an existing suite.
 *        b. The Base URL block (`section-base-url`) and Browser
 *           size block (`section-browser-size`) are absent — the
 *           URL and viewport are pinned by the live session.
 *        c. After finalize, the seeded suite file on disk has
 *           grown (i.e. the captured actions were materialized
 *           into language-specific test code), and the project
 *           tree still contains the seeded suite path. This is the
 *           "synthetic interaction → action in feed → code on
 *           disk" round-trip.
 *
 *   3. **Cancel + API attach-guards** — two single-shot checks:
 *        a. Close Browser tears the pre-attach session down and
 *           Build with AI re-enables (the `extraDisabledReason`
 *           clears once the open-browser slot frees up).
 *        b. `POST /api/recording/attach-to-open-browser` rejects
 *           an attempt to override the pinned `suiteMode='existing'`
 *           or `target='testMethod'` flags (HTTP 400).
 *
 * Gated on `E2E_API_BASE_URL` (e.g. `http://localhost:80`) with
 * `APP_ENVIRONMENT=development` on the api-server so `dev-login`
 * and `dev-fixture-login` are both enabled.
 */

const BASE = process.env.E2E_API_BASE_URL;

type Language = "csharp" | "python" | "nodejs" | "java";

const LANGUAGES: Language[] = ["csharp", "python", "nodejs", "java"];

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
      lastName: "OpenBrowser",
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

async function createProject(
  request: APIRequestContext,
  language: Language,
  suffix: string,
): Promise<{ solutionName: string }> {
  const solutionName = `OpenBrowserE2E${suffix}`;
  const res = await request.post(`${BASE}/api/projects`, {
    data: {
      solutionName,
      testProjectName: `${solutionName}Tests`,
      namespace: "OpenBrowserE2E.QA",
      language,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { solutionName };
}

async function seedTestClass(
  request: APIRequestContext,
  className: string,
): Promise<string> {
  const res = await request.post(`${BASE}/api/codegen/test-class`, {
    data: { className },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { message: string };
  return body.message;
}

interface TreeNode {
  path: string;
  children?: TreeNode[];
}

function walkPaths(root: TreeNode): string[] {
  const out: string[] = [];
  (function recur(n: TreeNode): void {
    out.push(n.path);
    if (Array.isArray(n.children)) for (const k of n.children) recur(k);
  })(root);
  return out;
}

/**
 * Walk the project tree and return a sorted snapshot of every file
 * whose basename is `appsettings.json` or `.env`, mapped to its
 * `/api/files` content body. This mirrors the server-side
 * `namedUrlStoreFiles()` helper in `recording.openBrowser.routes.test.ts`.
 */
async function snapshotNamedUrlStore(
  request: APIRequestContext,
): Promise<Map<string, string>> {
  const tree = await request.get(`${BASE}/api/projects/tree`);
  expect(tree.ok(), `tree → ${tree.status()}`).toBeTruthy();
  const treeJson = (await tree.json()) as TreeNode;
  const matches = walkPaths(treeJson)
    .filter((p) => {
      const base = p.split("/").pop() ?? "";
      return base === "appsettings.json" || base === ".env";
    })
    .sort();
  const out = new Map<string, string>();
  for (const rel of matches) {
    const res = await request.get(
      `${BASE}/api/files?path=${encodeURIComponent(rel)}`,
    );
    if (res.status() === 404) continue;
    expect(res.ok(), `GET /api/files?path=${rel}`).toBeTruthy();
    const body = (await res.json()) as { content: string };
    out.set(rel, body.content);
  }
  return out;
}

function expectByteIdenticalStore(
  before: Map<string, string>,
  after: Map<string, string>,
  context: string,
): void {
  expect(
    [...after.keys()].sort(),
    `${context}: named-URL store file set changed`,
  ).toEqual([...before.keys()].sort());
  for (const [rel, content] of before) {
    expect(after.get(rel), `${context}: ${rel} drifted`).toBe(content);
  }
}

interface RecordingStatus {
  active?: boolean;
  phase?: "idle" | "recording" | "stopped";
  methodName?: string | null;
  targetClass?: string | null;
}

async function getRecordingStatus(
  request: APIRequestContext,
): Promise<RecordingStatus> {
  const res = await request.get(`${BASE}/api/recording/status`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as RecordingStatus;
}

async function readFile(
  request: APIRequestContext,
  relPath: string,
): Promise<string> {
  const res = await request.get(
    `${BASE}/api/files?path=${encodeURIComponent(relPath)}`,
  );
  expect(res.ok(), `GET /api/files?path=${relPath}`).toBeTruthy();
  const body = (await res.json()) as { content: string };
  return body.content;
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

test.describe("Open Browser recording flow (#119)", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec.",
  );
  test.setTimeout(180_000);

  for (const language of LANGUAGES) {
    test(`open → attach → save keeps appsettings.json / .env byte-identical (${language})`, async ({
      page,
      request,
    }) => {
      const suffix = `${language[0].toUpperCase()}${language.slice(1)}${Date.now().toString(36)}`;
      const username = `e2e-openbrowser-${language}-${Date.now().toString(36)}`;

      await devLoginAdmin(request, username);
      await createProject(request, language, suffix);
      const seededClassName = `OpenBrowserSeed${suffix}`;
      const seededRel = await seedTestClass(request, seededClassName);
      expect(seededRel.length).toBeGreaterThan(0);

      // Snapshot the full set of named-URL store files BEFORE the
      // flow — appsettings.json (C# / Java) AND .env (Python /
      // Node.js). The end-to-end assertion is "whatever was on disk
      // stays byte-identical."
      const beforeStore = await snapshotNamedUrlStore(request);

      await seedPageSession(page, username);
      await page.goto(`${BASE}/workbench`);
      await dismissTour(page);

      // Use the dev-only /api/recording/dev-fixture-login start URL
      // (available when APP_ENVIRONMENT=local|development) — that
      // page self-fires `change` + `click` DOM events on load so the
      // recorder Chromium captures real actions without the harness
      // driving the inner browser. This is the per-language
      // synthetic-interaction → action-in-feed → code-on-disk path.
      await page.getByTestId("button-workbench-actions-menu").click();
      await page.getByTestId("button-open-browser").click();
      const dialog = page.getByTestId("dialog-open-browser");
      await expect(dialog).toBeVisible();
      await page
        .getByTestId("input-open-browser-url")
        .fill(`${BASE}/api/recording/dev-fixture-login`);
      await page.getByTestId("button-open-browser-confirm").click();
      await expect(dialog).toHaveCount(0, { timeout: 30_000 });

      // Pre-attach: phase recording, no method yet.
      await expect
        .poll(
          async () => {
            const s = await getRecordingStatus(request);
            return s.phase === "recording" && !s.methodName;
          },
          { timeout: 30_000, message: "open-browser pre-attach status" },
        )
        .toBe(true);

      // Toolbar swaps + Build with AI is parked with the pinned
      // tooltip.
      await expect(
        page.getByTestId("button-start-recording-attach"),
      ).toBeVisible();
      await expect(page.getByTestId("button-close-open-browser")).toBeVisible();
      const aiBtn = page.getByTestId("button-test-with-ai");
      await expect(aiBtn).toBeDisabled();
      await expect(aiBtn).toHaveAttribute(
        "title",
        "Close the open browser session first.",
      );

      // After /open-browser alone the named-URL store must already
      // be untouched — proves the start path skipped
      // upsertNamedUrl.
      expectByteIdenticalStore(
        beforeStore,
        await snapshotNamedUrlStore(request),
        "after /open-browser",
      );

      await page.getByTestId("button-start-recording-attach").click();
      await expect(page.getByTestId("note-attach-open-browser")).toBeVisible();

      // Attach-mode locks (visible + behavioral). These are the
      // exact constraints the server enforces and the dialog
      // mirrors.
      await expect(page.getByTestId("section-base-url")).toHaveCount(0);
      await expect(page.getByTestId("section-browser-size")).toHaveCount(0);
      await expect(page.locator("#mode-new")).toBeDisabled();
      await expect(page.locator("#mode-existing")).toBeEnabled();
      await expect(page.locator("#target-before")).toBeDisabled();
      await expect(page.locator("#target-onetime")).toBeDisabled();
      await expect(page.locator("#target-test")).toBeEnabled();

      await page.getByTestId("select-existing-class").click();
      await page
        .getByRole("option", { name: seededClassName })
        .first()
        .click();
      const methodName = `OpenBrowserAttached${suffix}`;
      await page.getByTestId("input-method-name").fill(methodName);
      await page.getByTestId("button-confirm-start-recording").click();

      await expect
        .poll(
          async () => {
            const s = await getRecordingStatus(request);
            return s.phase === "recording" && !!s.methodName;
          },
          { timeout: 30_000, message: "attach landed: methodName set" },
        )
        .toBe(true);

      // Give the recorder script in the inner Chromium a beat to
      // capture the self-fired change/click events from the dev
      // fixture page. The fixture self-fires within ~100ms of
      // load; we wait longer for the broadcast to land.
      await page.waitForTimeout(2_500);

      const seededBefore = await readFile(request, seededRel);

      const stop = await request.post(`${BASE}/api/recording/stop`);
      expect(stop.ok(), await stop.text()).toBeTruthy();
      const finalize = await request.post(
        `${BASE}/api/recording/finalize`,
        { data: { mode: "save" } },
      );
      expect(finalize.ok(), await finalize.text()).toBeTruthy();

      // The headline assertion: byte-identical end-to-end.
      expectByteIdenticalStore(
        beforeStore,
        await snapshotNamedUrlStore(request),
        `after open-browser → attach → save (${language})`,
      );

      // Post-attach validation: the seeded suite file on disk now
      // contains the new method body — this is the per-language
      // proof that (a) at least one action was captured in the
      // feed, (b) it was materialized into language-specific test
      // code on save, and (c) we attached to the seeded suite
      // instead of scaffolding a sibling.
      const seededAfter = await readFile(request, seededRel);
      expect(
        seededAfter.length,
        `${language}: seeded suite file did not grow after attach → save`,
      ).toBeGreaterThan(seededBefore.length);
      expect(
        seededAfter,
        `${language}: method "${methodName}" not found in seeded suite after save`,
      ).toContain(methodName);

      // Sanity: the seeded suite still exists in the project tree
      // and so does the language-appropriate suite-file basename.
      const treeAfter = await request.get(`${BASE}/api/projects/tree`);
      expect(treeAfter.ok()).toBeTruthy();
      const paths = walkPaths((await treeAfter.json()) as TreeNode);
      expect(paths).toContain(seededRel);
      const expectedSuiteBasename = {
        csharp: `${seededClassName}.cs`,
        java: `${seededClassName}.java`,
        nodejs: `${seededClassName}.spec.ts`,
        python: seededRel.split("/").pop()!,
      }[language];
      expect(
        paths.some((p) => p.endsWith(expectedSuiteBasename)),
        `${language}: expected suite file basename "${expectedSuiteBasename}" not present in /api/projects/tree`,
      ).toBe(true);
    });
  }

  // (The dedicated "synthetic interaction" round-trip is folded
  // into the per-language flow above — each language now uses the
  // dev-fixture-login start URL and asserts the seeded suite file
  // grew + contains the attached method name after save. Keeping
  // a focused C# round-trip in addition that re-asserts the
  // attach-mode locks one more time, in case the per-language
  // path's polls race past the dialog state.)
  test("attach-mode locks remain enforced through a full round-trip (csharp)", async ({
    page,
    request,
  }) => {
    const suffix = `Synth${Date.now().toString(36)}`;
    const username = `e2e-openbrowser-synth-${Date.now().toString(36)}`;

    await devLoginAdmin(request, username);
    await createProject(request, "csharp", suffix);
    const seededClassName = `OpenBrowserSynthSeed${suffix}`;
    const seededRel = await seedTestClass(request, seededClassName);

    const seededBefore = await readFile(request, seededRel);

    await seedPageSession(page, username);
    await page.goto(`${BASE}/workbench`);
    await dismissTour(page);

    // Open the browser at the dev fixture login page. That page
    // self-fires `change` + `click` DOM events on load, so the
    // recorder script in the inner Chromium captures a real
    // 4-action sequence without the harness needing to drive it.
    // The fixture is registered at /api/recording/dev-fixture-login
    // and only responds when APP_ENVIRONMENT=local|development.
    await page.getByTestId("button-workbench-actions-menu").click();
    await page.getByTestId("button-open-browser").click();
    await expect(page.getByTestId("dialog-open-browser")).toBeVisible();
    await page
      .getByTestId("input-open-browser-url")
      .fill(`${BASE}/api/recording/dev-fixture-login`);
    await page.getByTestId("button-open-browser-confirm").click();

    await expect
      .poll(
        async () => {
          const s = await getRecordingStatus(request);
          return s.phase === "recording" && !s.methodName;
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // Attach.
    await page.getByTestId("button-start-recording-attach").click();
    await expect(page.getByTestId("note-attach-open-browser")).toBeVisible();
    // Reconfirm the attach-mode locks here too (this test is the
    // one that lingers on the dialog long enough to catch any
    // regressions in `disabled` wiring).
    await expect(page.locator("#mode-new")).toBeDisabled();
    await expect(page.locator("#target-before")).toBeDisabled();
    await expect(page.locator("#target-onetime")).toBeDisabled();

    await page.getByTestId("select-existing-class").click();
    await page
      .getByRole("option", { name: seededClassName })
      .first()
      .click();
    const methodName = `SynthAttached${suffix}`;
    await page.getByTestId("input-method-name").fill(methodName);
    await page.getByTestId("button-confirm-start-recording").click();

    await expect
      .poll(
        async () => {
          const s = await getRecordingStatus(request);
          return s.phase === "recording" && !!s.methodName;
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // Give the recorder a beat to capture the self-fired events.
    // The dev-fixture-login page self-fires within ~100ms of load;
    // we wait a bit longer for the action broadcast to land.
    await page.waitForTimeout(2_000);

    const stop = await request.post(`${BASE}/api/recording/stop`);
    expect(stop.ok()).toBeTruthy();
    const finalize = await request.post(
      `${BASE}/api/recording/finalize`,
      { data: { mode: "save" } },
    );
    expect(finalize.ok(), await finalize.text()).toBeTruthy();

    // Post-attach validation: the seeded suite file on disk now
    // contains the new method, and the file body has grown — this
    // is the "synthetic interaction → action in feed → code on
    // disk" proof.
    const seededAfter = await readFile(request, seededRel);
    expect(seededAfter.length).toBeGreaterThan(seededBefore.length);
    expect(seededAfter).toContain(methodName);
  });

  test("cancel: Close Browser tears the session down and re-enables Build with AI", async ({
    page,
    request,
  }) => {
    const username = `e2e-openbrowser-cancel-${Date.now().toString(36)}`;
    await devLoginAdmin(request, username);
    await createProject(
      request,
      "csharp",
      `Cancel${Date.now().toString(36)}`,
    );

    await seedPageSession(page, username);
    await page.goto(`${BASE}/workbench`);
    await dismissTour(page);

    await page.getByTestId("button-workbench-actions-menu").click();
    await page.getByTestId("button-open-browser").click();
    await page
      .getByTestId("input-open-browser-url")
      .fill("https://example.com/");
    await page.getByTestId("button-open-browser-confirm").click();

    await expect(page.getByTestId("button-close-open-browser")).toBeVisible({
      timeout: 30_000,
    });
    const aiBtn = page.getByTestId("button-test-with-ai");
    await expect(aiBtn).toBeDisabled();
    await expect(aiBtn).toHaveAttribute(
      "title",
      "Close the open browser session first.",
    );

    await page.getByTestId("button-close-open-browser").click();
    await expect
      .poll(
        async () => {
          const s = await getRecordingStatus(request);
          return s.phase === "idle" || !s.phase;
        },
        { timeout: 20_000, message: "session returned to idle" },
      )
      .toBe(true);
    await expect(page.getByTestId("button-close-open-browser")).toHaveCount(0);

    // Build with AI re-enables once the open-browser slot frees.
    await expect(aiBtn).toBeEnabled({ timeout: 10_000 });
    await expect(aiBtn).not.toHaveAttribute(
      "title",
      "Close the open browser session first.",
    );

    // Second cancel via API is a no-op (canceled:false) — the
    // session is already gone.
    const second = await request.post(
      `${BASE}/api/recording/cancel-open-browser`,
    );
    expect(second.ok()).toBeTruthy();
    const secondBody = (await second.json()) as { canceled: boolean };
    expect(secondBody.canceled).toBe(false);
  });

  test("attach guards: pinned flags can't be overridden (suiteMode='new' → 400, target!='testMethod' → 400)", async ({
    request,
  }) => {
    const username = `e2e-openbrowser-guards-${Date.now().toString(36)}`;
    await devLoginAdmin(request, username);
    await createProject(
      request,
      "csharp",
      `Guards${Date.now().toString(36)}`,
    );
    const seededRel = await seedTestClass(request, "GuardsSuite");

    const open = await request.post(`${BASE}/api/recording/open-browser`, {
      data: { url: "https://example.com/" },
    });
    expect(open.ok(), await open.text()).toBeTruthy();

    const badSuiteMode = await request.post(
      `${BASE}/api/recording/attach-to-open-browser`,
      {
        data: {
          suiteMode: "new",
          existingTestClassPath: seededRel,
          methodName: "Whatever",
        },
      },
    );
    expect(badSuiteMode.status()).toBe(400);

    const badTarget = await request.post(
      `${BASE}/api/recording/attach-to-open-browser`,
      {
        data: {
          target: "beforeEach",
          existingTestClassPath: seededRel,
          methodName: "Whatever",
        },
      },
    );
    expect(badTarget.status()).toBe(400);

    await request.post(`${BASE}/api/recording/cancel-open-browser`);
  });
});
