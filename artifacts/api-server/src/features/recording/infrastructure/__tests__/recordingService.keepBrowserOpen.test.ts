import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Mock Playwright so the keep-browser-open unit tests never spawn a
// real chromium process. The mock browser's `close` call counter is
// what drives every assertion in this file — it proves whether the
// recycle / teardown branches behaved correctly.
const mocks = vi.hoisted(() => {
  const page = {
    mouse: { click: vi.fn().mockResolvedValue(undefined) },
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    goto: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    mainFrame: () => ({ url: () => "" }),
    url: vi.fn().mockReturnValue("https://example.com/"),
    locator: vi.fn().mockReturnValue({ first: () => ({ fill: vi.fn() }) }),
    screenshot: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    route: vi.fn().mockResolvedValue(undefined),
    context: vi.fn(),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    exposeBinding: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
    storageState: vi.fn().mockResolvedValue({}),
  };
  page.context = vi.fn().mockReturnValue(context);
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, context, page };
});

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mocks.browser) },
}));

import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import {
  openBrowser,
  attachToOpenBrowser,
  start,
  stopBrowser,
  getStatus,
  shutdown,
  finalize,
  discardSession,
} from "@/features/recording/infrastructure/recordingService";

/**
 * Every session in this file is started as this user. `stopBrowser` and
 * `finalize` are owner-scoped (audit H-8), so they need the owner id.
 */
const OWNER = "u1";

let tmp: string;
let originalWorkspace: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-kbo-unit-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  mocks.browser.close.mockClear();
});

afterEach(async () => {
  await shutdown().catch(() => {});
  setCurrentProject(null);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("recordingService — task #120 keep browser open", () => {
  it("stopBrowser leaves the chromium process alive when keepBrowserOpen=true", async () => {
    const project = await createProject({
      solutionName: "KeepOpenStop",
      namespace: "KeepOpenStop.QA",
    });
    setCurrentProject(project);
    const relSuite = path.join("Tests", "KeepOpenStopSuite.cs");
    await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
    await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");

    await openBrowser({
      url: "https://example.com/",
      userId: "u1",
      project,
    });
    await attachToOpenBrowser({
      userId: "u1",
      existingTestClassPath: relSuite,
      methodName: "M1",
      keepBrowserOpen: true,
    });

    expect(getStatus().keepBrowserOpen).toBe(true);
    await stopBrowser(OWNER);

    expect(mocks.browser.close).not.toHaveBeenCalled();
    expect(getStatus().phase).toBe("stopped");
    expect(getStatus().keepBrowserOpen).toBe(true);
  });

  it("stopBrowser closes the chromium process when keepBrowserOpen is unset", async () => {
    const project = await createProject({
      solutionName: "KeepClosedStop",
      namespace: "KeepClosedStop.QA",
    });
    setCurrentProject(project);
    const relSuite = path.join("Tests", "KeepClosedStopSuite.cs");
    await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
    await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");

    await openBrowser({
      url: "https://example.com/",
      userId: "u1",
      project,
    });
    await attachToOpenBrowser({
      userId: "u1",
      existingTestClassPath: relSuite,
      methodName: "M1",
      // keepBrowserOpen omitted -> default off
    });
    await stopBrowser(OWNER);

    expect(mocks.browser.close).toHaveBeenCalledTimes(1);
    expect(getStatus().keepBrowserOpen).toBe(false);
  });

  it("start() tears down a kept-open session belonging to the same user instead of throwing", async () => {
    const project = await createProject({
      solutionName: "KeepOpenFreshStart",
      namespace: "KeepOpenFreshStart.QA",
    });
    setCurrentProject(project);
    const relSuite = path.join("Tests", "KeepOpenFreshStartSuite.cs");
    await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
    await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");

    await openBrowser({
      url: "https://example.com/",
      userId: "u1",
      project,
    });
    await attachToOpenBrowser({
      userId: "u1",
      existingTestClassPath: relSuite,
      methodName: "M1",
      keepBrowserOpen: true,
    });
    await stopBrowser(OWNER);

    // Fresh start from the same user should succeed: the kept-open
    // session is torn down (closing its browser) and a brand-new
    // session takes its place. Previously this threw
    // "Recording already in progress".
    await expect(
      start(
        {
          startUrl: "https://example.com/",
          urlName: "BaseUrl",
          target: "testMethod",
          methodName: "M2",
          newTestClassName: "Fresh",
        },
        "u1",
        project,
      ),
    ).resolves.toBeDefined();

    // Exactly one close: the teardown of the prior kept-open session.
    expect(mocks.browser.close).toHaveBeenCalledTimes(1);
    expect(getStatus().phase).toBe("recording");
    expect(getStatus().keepBrowserOpen).toBe(false);
  });

  it("start() still throws when a kept-open session is actively attached (no silent data loss)", async () => {
    const project = await createProject({
      solutionName: "KeepOpenAttachedBlocks",
      namespace: "KeepOpenAttachedBlocks.QA",
    });
    setCurrentProject(project);
    const relSuite = path.join("Tests", "KeepOpenAttachedBlocksSuite.cs");
    await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
    await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");

    await openBrowser({
      url: "https://example.com/",
      userId: "u1",
      project,
    });
    await attachToOpenBrowser({
      userId: "u1",
      existingTestClassPath: relSuite,
      methodName: "M1",
      keepBrowserOpen: true,
    });
    // Note: NO stopBrowser(OWNER) — the session is in phase="recording"
    // with attached=true. The auto-teardown predicate must reject
    // this shape so the second start() fails loudly instead of
    // discarding the in-flight recording.
    expect(getStatus().phase).toBe("recording");

    await expect(
      start(
        {
          startUrl: "https://example.com/",
          urlName: "BaseUrl",
          target: "testMethod",
          methodName: "M2",
          newTestClassName: "Second",
        },
        "u1",
        project,
      ),
    ).rejects.toThrow(/Recording already in progress/);

    // Browser was never closed — the attached session is intact.
    expect(mocks.browser.close).not.toHaveBeenCalled();
    expect(getStatus().phase).toBe("recording");
  });

  it("finalize({mode:'save'}, OWNER) on a keepBrowserOpen session keeps the browser alive and recycles the session into the open-browser pre-attach shape (task #121)", async () => {
    const project = await createProject({
      solutionName: "KeepOpenFinalizeRecycle",
      namespace: "KeepOpenFinalizeRecycle.QA",
    });
    setCurrentProject(project);
    const relSuite = path.join("Tests", "KeepOpenFinalizeRecycleSuite.cs");
    await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
    await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");

    await openBrowser({
      url: "https://example.com/",
      userId: "u1",
      project,
    });
    await attachToOpenBrowser({
      userId: "u1",
      existingTestClassPath: relSuite,
      methodName: "FirstMethod",
      keepBrowserOpen: true,
    });
    await stopBrowser(OWNER);

    const result = await finalize(undefined, OWNER);
    expect(result.status).toBe("completed");
    // The headline: at least one file was generated AND the browser
    // was not closed by either stopBrowser or finalize.
    if (result.status === "completed") {
      expect(result.generatedFiles.length).toBeGreaterThan(0);
    }
    expect(mocks.browser.close).not.toHaveBeenCalled();

    // The session has been recycled into the open-browser pre-attach
    // shape: still active, phase recording, but no targetClass /
    // methodName yet — that's how the workbench detects "the next
    // dialog should open in attach mode."
    const status = getStatus();
    expect(status.active).toBe(true);
    expect(status.phase).toBe("recording");
    expect(status.keepBrowserOpen).toBe(true);
    expect(status.methodName ?? null).toBeFalsy();
    expect(status.targetClass ?? null).toBeFalsy();
  });

  it("discardSession() tears down a kept-open browser (task #121)", async () => {
    const project = await createProject({
      solutionName: "KeepOpenDiscard",
      namespace: "KeepOpenDiscard.QA",
    });
    setCurrentProject(project);
    const relSuite = path.join("Tests", "KeepOpenDiscardSuite.cs");
    await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
    await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");

    await openBrowser({
      url: "https://example.com/",
      userId: "u1",
      project,
    });
    await attachToOpenBrowser({
      userId: "u1",
      existingTestClassPath: relSuite,
      methodName: "M1",
      keepBrowserOpen: true,
    });
    await stopBrowser(OWNER);
    expect(mocks.browser.close).not.toHaveBeenCalled();

    const cleared = await discardSession("u1");
    expect(cleared).toBe(true);
    // Discard must close the kept-open Chromium — the previous
    // phase === "recording" guard would have leaked the browser.
    expect(mocks.browser.close).toHaveBeenCalledTimes(1);
    expect(getStatus().active).toBe(false);
    expect(getStatus().phase).toBe("idle");
  });

  it("shutdown() (the sign-out / process-exit teardown) closes a kept-open browser (task #121)", async () => {
    const project = await createProject({
      solutionName: "KeepOpenShutdown",
      namespace: "KeepOpenShutdown.QA",
    });
    setCurrentProject(project);
    const relSuite = path.join("Tests", "KeepOpenShutdownSuite.cs");
    await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
    await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");

    await openBrowser({
      url: "https://example.com/",
      userId: "u1",
      project,
    });
    await attachToOpenBrowser({
      userId: "u1",
      existingTestClassPath: relSuite,
      methodName: "M1",
      keepBrowserOpen: true,
    });
    await stopBrowser(OWNER);
    expect(mocks.browser.close).not.toHaveBeenCalled();

    await shutdown();
    expect(mocks.browser.close).toHaveBeenCalledTimes(1);
    expect(getStatus().active).toBe(false);
    expect(getStatus().phase).toBe("idle");
  });

  it("start() tears down a kept-open pre-attach (recycled) session instead of throwing — regression for the attached-flag guard", async () => {
    // Reproduces the latent bug where the pre-attach guard read
    // `session.config.attached` (never set) instead of `session.attached`
    // (the runtime flag). With the old code the predicate silently
    // returned false, so a recycled keep-open session in
    // phase=recording + attached=false would throw "Recording already in
    // progress" instead of being torn down to make room for a fresh
    // start.
    const project = await createProject({
      solutionName: "KeepOpenRecycledFreshStart",
      namespace: "KeepOpenRecycledFreshStart.QA",
    });
    setCurrentProject(project);
    const relSuite = path.join("Tests", "KeepOpenRecycledFreshStartSuite.cs");
    await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
    await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");

    await openBrowser({
      url: "https://example.com/",
      userId: "u1",
      project,
    });
    await attachToOpenBrowser({
      userId: "u1",
      existingTestClassPath: relSuite,
      methodName: "FirstMethod",
      keepBrowserOpen: true,
    });
    await stopBrowser(OWNER);
    await finalize(undefined, OWNER);

    // After finalize the session is recycled into the open-browser
    // pre-attach shape: phase=recording, attached=false,
    // keepBrowserOpen=true. Confirm the precondition the regression
    // turns on.
    expect(getStatus().phase).toBe("recording");
    expect(getStatus().keepBrowserOpen).toBe(true);
    expect(getStatus().methodName ?? null).toBeFalsy();
    expect(mocks.browser.close).not.toHaveBeenCalled();

    // The fresh start must succeed: the recycled session is torn down
    // (closing its browser exactly once) and a brand-new session takes
    // its place. The same predicate is exercised through openBrowser
    // below.
    await expect(
      start(
        {
          startUrl: "https://example.com/",
          urlName: "BaseUrl",
          target: "testMethod",
          methodName: "M2",
          newTestClassName: "FreshAfterRecycle",
        },
        "u1",
        project,
      ),
    ).resolves.toBeDefined();

    expect(mocks.browser.close).toHaveBeenCalledTimes(1);
    expect(getStatus().phase).toBe("recording");
    expect(getStatus().keepBrowserOpen).toBe(false);
  });

  it("openBrowser() tears down a kept-open pre-attach (recycled) session instead of throwing — regression for the attached-flag guard", async () => {
    const project = await createProject({
      solutionName: "KeepOpenRecycledFreshOpen",
      namespace: "KeepOpenRecycledFreshOpen.QA",
    });
    setCurrentProject(project);
    const relSuite = path.join("Tests", "KeepOpenRecycledFreshOpenSuite.cs");
    await fs.mkdir(path.join(project.rootPath, "Tests"), { recursive: true });
    await fs.writeFile(path.join(project.rootPath, relSuite), "// seeded\n");

    await openBrowser({
      url: "https://example.com/",
      userId: "u1",
      project,
    });
    await attachToOpenBrowser({
      userId: "u1",
      existingTestClassPath: relSuite,
      methodName: "FirstMethod",
      keepBrowserOpen: true,
    });
    await stopBrowser(OWNER);
    await finalize(undefined, OWNER);

    expect(getStatus().phase).toBe("recording");
    expect(getStatus().keepBrowserOpen).toBe(true);
    expect(mocks.browser.close).not.toHaveBeenCalled();

    await expect(
      openBrowser({
        url: "https://example.com/new",
        userId: "u1",
        project,
      }),
    ).resolves.toBeDefined();

    expect(mocks.browser.close).toHaveBeenCalledTimes(1);
    expect(getStatus().phase).toBe("recording");
  });

  it("start() still throws when a non-kept-open session is live", async () => {
    const project = await createProject({
      solutionName: "BlockingSession",
      namespace: "BlockingSession.QA",
    });
    setCurrentProject(project);

    await start(
      {
        startUrl: "https://example.com/",
        urlName: "BaseUrl",
        target: "testMethod",
        methodName: "First",
        newTestClassName: "First",
      },
      "u1",
      project,
    );

    await expect(
      start(
        {
          startUrl: "https://example.com/",
          urlName: "BaseUrl",
          target: "testMethod",
          methodName: "Second",
          newTestClassName: "Second",
        },
        "u1",
        project,
      ),
    ).rejects.toThrow(/Recording already in progress/);
  });
});
