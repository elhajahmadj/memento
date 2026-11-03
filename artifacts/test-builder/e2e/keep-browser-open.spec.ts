import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * End-to-end Playwright spec for task #121 — "Keep browser open after
 * stop recording" checkbox on the Start Recording dialog. Drives the
 * live api-server + test-builder workflows behind the shared proxy.
 *
 * Happy path (single C# project):
 *   1. Open the Start Recording dialog, tick the new checkbox, fill
 *      out a new-suite recording, perform a couple of actions in the
 *      recorder Chromium via the `/api/recording/dev-fixture-login`
 *      fixture URL, then POST /recording/stop.
 *   2. Assert the Chromium is still alive via GET /recording/status
 *      (`phase === "stopped"` AND `keepBrowserOpen === true`).
 *   3. POST /recording/finalize {mode:"save"} — assert the suite file
 *      now exists on disk with the first method body.
 *   4. The workbench swaps to the attach toolbar. Click "Start
 *      Recording", assert the dialog opens in attach mode, and that
 *      submitting routes through `/recording/attach-to-open-browser`
 *      (observed via `page.waitForRequest`). Add a second `[Test]`
 *      method into the same suite, stop + save, and assert BOTH
 *      methods are now in the same suite file.
 *
 * Negative path:
 *   - A recording started with the checkbox OFF still tears the
 *     browser down on stop+save: `GET /recording/status` returns
 *     `phase === "idle"` and the toolbar shows the fresh
 *     `button-start-recording` (NOT `button-start-recording-attach`).
 *
 * Gated on `E2E_API_BASE_URL` (e.g. `http://localhost:80`) with
 * `APP_ENVIRONMENT=development` on the api-server so dev-login and
 * `dev-fixture-login` are both enabled.
 */

const BASE = process.env.E2E_API_BASE_URL;

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
      lastName: "KeepOpen",
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
  suffix: string,
): Promise<{ solutionName: string }> {
  const solutionName = `KeepOpenE2E${suffix}`;
  const res = await request.post(`${BASE}/api/projects`, {
    data: {
      solutionName,
      testProjectName: `${solutionName}Tests`,
      namespace: "KeepOpenE2E.QA",
      language: "csharp",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { solutionName };
}

interface RecordingStatus {
  active?: boolean;
  phase?: "idle" | "recording" | "stopped";
  methodName?: string | null;
  targetClass?: string | null;
  keepBrowserOpen?: boolean;
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

async function findSuitePath(
  request: APIRequestContext,
  className: string,
): Promise<string> {
  const tree = await request.get(`${BASE}/api/projects/tree`);
  expect(tree.ok()).toBeTruthy();
  const paths = walkPaths((await tree.json()) as TreeNode);
  const match = paths.find((p) =>
    p.endsWith(`/${className}TestSuite.cs`) || p.endsWith(`/${className}.cs`),
  );
  expect(match, `expected to find ${className} suite in tree`).toBeTruthy();
  return match!;
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

test.describe("Keep browser open after stop recording (#121)", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec.",
  );
  test.setTimeout(180_000);

  test("happy path: stop keeps the browser alive, save writes the suite, attach adds a 2nd [Test] into the same file", async ({
    page,
    request,
  }) => {
    const suffix = `Happy${Date.now().toString(36)}`;
    const username = `e2e-keepopen-${Date.now().toString(36)}`;
    await devLoginAdmin(request, username);
    await createProject(request, suffix);

    await seedPageSession(page, username);
    await page.goto(`${BASE}/workbench`);
    await dismissTour(page);

    // 1. Open the standard Start Recording dialog, tick the new
    //    checkbox, fill out a new-suite recording targeting the dev
    //    fixture page (self-fires `change` + `click` on load), then
    //    submit.
    const suiteName = `KeepOpenSuite${suffix}`;
    const firstMethod = `FirstKeptOpen${suffix}`;
    await page.getByTestId("button-start-recording").click();
    const dialog = page.getByTestId("dialog-start-recording");
    await expect(dialog).toBeVisible();
    await page
      .getByTestId("input-start-url")
      .fill(`${BASE}/api/recording/dev-fixture-login`);
    await page.getByTestId("input-url-name").fill("DevFixture");
    await page.getByTestId("input-new-class").fill(suiteName);
    await page.getByTestId("input-method-name").fill(firstMethod);
    // The headline assertion for the dialog leg: ticking the
    // checkbox is what makes the kept-open lifecycle apply.
    const keepCheckbox = page.getByTestId("checkbox-keep-browser-open");
    await expect(keepCheckbox).not.toBeChecked();
    await keepCheckbox.check();
    await expect(keepCheckbox).toBeChecked();
    await page.getByTestId("button-confirm-start-recording").click();

    // Wait for the session to be live with our method pinned.
    await expect
      .poll(
        async () => {
          const s = await getRecordingStatus(request);
          return (
            s.phase === "recording" &&
            s.methodName === firstMethod &&
            s.keepBrowserOpen === true
          );
        },
        { timeout: 30_000, message: "first recording landed with keepBrowserOpen=true" },
      )
      .toBe(true);

    // Give the dev-fixture page a moment to self-fire its synthetic
    // actions in the inner Chromium so the recorder captures
    // something to materialize.
    await page.waitForTimeout(2_500);

    // 2. Stop — the browser MUST stay alive, phase becomes "stopped",
    //    keepBrowserOpen still true.
    const stop1 = await request.post(`${BASE}/api/recording/stop`);
    expect(stop1.ok(), await stop1.text()).toBeTruthy();
    const afterStop = await getRecordingStatus(request);
    expect(afterStop.phase).toBe("stopped");
    expect(afterStop.keepBrowserOpen).toBe(true);

    // 3. Save — writes the suite file AND recycles the session into
    //    the open-browser pre-attach shape (phase=recording, no
    //    methodName / targetClass) so the next Start Recording lands
    //    in attach mode.
    const finalize1 = await request.post(`${BASE}/api/recording/finalize`, {
      data: { mode: "save" },
    });
    expect(finalize1.ok(), await finalize1.text()).toBeTruthy();
    const suiteRel = await findSuitePath(request, suiteName);
    const suiteAfterFirst = await readFile(request, suiteRel);
    expect(suiteAfterFirst).toContain(firstMethod);

    await expect
      .poll(
        async () => {
          const s = await getRecordingStatus(request);
          return (
            s.phase === "recording" &&
            !s.methodName &&
            s.keepBrowserOpen === true
          );
        },
        {
          timeout: 30_000,
          message: "session recycled into open-browser pre-attach mode",
        },
      )
      .toBe(true);

    // 4. The toolbar swaps to the attach button. Click it, fill in a
    //    second [Test] method, and assert the submit fires
    //    `/recording/attach-to-open-browser` (NOT `/recording/start`).
    const attachBtn = page.getByTestId("button-start-recording-attach");
    await expect(attachBtn).toBeVisible({ timeout: 20_000 });
    await attachBtn.click();
    await expect(page.getByTestId("note-attach-open-browser")).toBeVisible();

    await page.getByTestId("select-existing-class").click();
    await page
      .getByRole("option", { name: new RegExp(suiteName) })
      .first()
      .click();
    const secondMethod = `SecondKeptOpen${suffix}`;
    await page.getByTestId("input-method-name").fill(secondMethod);

    const attachReq = page.waitForRequest((r) =>
      r.url().includes("/api/recording/attach-to-open-browser") &&
      r.method() === "POST",
    );
    await page.getByTestId("button-confirm-start-recording").click();
    await attachReq;

    await expect
      .poll(
        async () => {
          const s = await getRecordingStatus(request);
          return s.phase === "recording" && s.methodName === secondMethod;
        },
        { timeout: 30_000, message: "second attach landed" },
      )
      .toBe(true);

    await page.waitForTimeout(2_500);

    // Stop + save the second method.
    const stop2 = await request.post(`${BASE}/api/recording/stop`);
    expect(stop2.ok()).toBeTruthy();
    const finalize2 = await request.post(`${BASE}/api/recording/finalize`, {
      data: { mode: "save" },
    });
    expect(finalize2.ok(), await finalize2.text()).toBeTruthy();

    // 5. BOTH methods must live in the SAME suite file on disk.
    const suiteAfterSecond = await readFile(request, suiteRel);
    expect(suiteAfterSecond).toContain(firstMethod);
    expect(suiteAfterSecond).toContain(secondMethod);
    expect(
      suiteAfterSecond.length,
      "suite file should have grown after adding the 2nd method",
    ).toBeGreaterThan(suiteAfterFirst.length);
  });

  test("negative: with the checkbox OFF, stop+save tears the browser down and the dialog re-opens in fresh (non-attach) mode", async ({
    page,
    request,
  }) => {
    const suffix = `Neg${Date.now().toString(36)}`;
    const username = `e2e-keepopen-neg-${Date.now().toString(36)}`;
    await devLoginAdmin(request, username);
    await createProject(request, suffix);

    await seedPageSession(page, username);
    await page.goto(`${BASE}/workbench`);
    await dismissTour(page);

    const suiteName = `NoKeepSuite${suffix}`;
    const methodName = `NoKeepMethod${suffix}`;
    await page.getByTestId("button-start-recording").click();
    await expect(page.getByTestId("dialog-start-recording")).toBeVisible();
    await page
      .getByTestId("input-start-url")
      .fill(`${BASE}/api/recording/dev-fixture-login`);
    await page.getByTestId("input-url-name").fill("DevFixture");
    await page.getByTestId("input-new-class").fill(suiteName);
    await page.getByTestId("input-method-name").fill(methodName);
    // Explicitly leave the checkbox unchecked.
    await expect(
      page.getByTestId("checkbox-keep-browser-open"),
    ).not.toBeChecked();
    await page.getByTestId("button-confirm-start-recording").click();

    await expect
      .poll(
        async () => {
          const s = await getRecordingStatus(request);
          return s.phase === "recording" && s.methodName === methodName;
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    await page.waitForTimeout(1_000);

    // Stop without keep-open MUST close the browser — status drops
    // straight into the stopped-with-closed-browser shape; finalize
    // then collapses the session to idle.
    const stop = await request.post(`${BASE}/api/recording/stop`);
    expect(stop.ok()).toBeTruthy();
    const afterStop = await getRecordingStatus(request);
    expect(afterStop.phase).toBe("stopped");
    expect(afterStop.keepBrowserOpen ?? false).toBe(false);

    const finalize = await request.post(`${BASE}/api/recording/finalize`, {
      data: { mode: "save" },
    });
    expect(finalize.ok(), await finalize.text()).toBeTruthy();

    // The session must collapse to idle — NOT recycle into the
    // open-browser pre-attach shape.
    await expect
      .poll(
        async () => {
          const s = await getRecordingStatus(request);
          return s.phase === "idle" || !s.phase;
        },
        { timeout: 20_000, message: "session collapses to idle" },
      )
      .toBe(true);

    // The toolbar must show the fresh Start Recording button — NOT
    // the attach variant.
    await expect(page.getByTestId("button-start-recording")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByTestId("button-start-recording-attach"),
    ).toHaveCount(0);
  });
});
