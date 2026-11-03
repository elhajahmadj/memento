import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Mock playwright so the open-browser unit tests below never spawn a
// real chromium browser. We expose the page/context/browser mocks so
// the tests can reach into `exposeBinding.mock.calls[0][1]` and invoke
// the registered `__recorderEmit` handler directly.
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
    screenshot: vi
      .fn()
      .mockImplementation(() => new Promise(() => undefined)),
    route: vi.fn().mockResolvedValue(undefined),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    exposeBinding: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
  };
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
  _getSessionActionsForTest,
  shutdown,
} from "@/features/recording/infrastructure/recordingService";

let tmp: string;
let originalWorkspace: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-ob-unit-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  mocks.context.exposeBinding.mockClear();
});

afterEach(async () => {
  await shutdown().catch(() => {});
  setCurrentProject(null);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("recordingService — open-browser binding gating", () => {
  it("drops __recorderEmit events before attach and captures them after attach", async () => {
    const project = await createProject({
      solutionName: "BindingGate",
      namespace: "BindingGate.QA",
    });
    setCurrentProject(project);

    // Seed an existing test class on disk so attachToOpenBrowser passes
    // the file-existence check.
    const relSuite = path.join("Tests", "BindingGateSuite.cs");
    const abs = path.join(project.rootPath, relSuite);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, "// seeded\n");

    await openBrowser({
      url: "https://example.com/",
      userId: "test-user-id",
      project,
    });

    // openBrowser registered exactly one __recorderEmit binding on the
    // mock context — grab the handler so we can drive it directly.
    expect(mocks.context.exposeBinding).toHaveBeenCalledTimes(1);
    const [bindingName, handler] = mocks.context.exposeBinding.mock
      .calls[0] as [string, (src: unknown, raw: unknown) => void];
    expect(bindingName).toBe("__recorderEmit");

    // Pre-attach: the open-browser session was created with
    // `attached: false`. A captured click must be dropped.
    handler(
      {},
      {
        type: "click",
        selector: "button.signin",
        editable: false,
      },
    );
    expect(_getSessionActionsForTest()?.length).toBe(0);

    // Promote the session by attaching to the seeded suite.
    await attachToOpenBrowser({
      userId: "test-user-id",
      existingTestClassPath: relSuite,
      methodName: "PostAttach",
    });

    // Post-attach: the same handler must now record the click into the
    // session's action buffer.
    handler(
      {},
      {
        type: "click",
        selector: "button.confirm",
        editable: false,
      },
    );
    const after = _getSessionActionsForTest() ?? [];
    expect(after.length).toBe(1);
    expect(after[0]).toMatchObject({
      type: "click",
      selector: "button.confirm",
    });
  });

  it("framenavigated events are also dropped pre-attach and captured post-attach", async () => {
    const project = await createProject({
      solutionName: "FrameGate",
      namespace: "FrameGate.QA",
    });
    setCurrentProject(project);

    const relSuite = path.join("Tests", "FrameGateSuite.cs");
    const abs = path.join(project.rootPath, relSuite);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, "// seeded\n");

    await openBrowser({
      url: "https://example.com/",
      userId: "test-user-id",
      project,
    });

    // page.on("framenavigated", handler) was registered exactly once
    // during openBrowser — grab the handler by event name.
    const onCalls = (mocks.page.on as unknown as Mock).mock.calls as Array<
      [string, (frame: { url: () => string }) => void]
    >;
    const frameCall = onCalls.find((c) => c[0] === "framenavigated");
    expect(frameCall).toBeDefined();
    const frameHandler = frameCall![1];

    const fakeFrame = { url: () => "https://example.com/page-pre" };
    // The handler checks `frame === page.mainFrame()`, which our mock
    // returns a fresh object for each call. Stub mainFrame to return
    // the same `fakeFrame` we pass in.
    const originalMainFrame = mocks.page.mainFrame;
    mocks.page.mainFrame = () => fakeFrame;
    try {
      frameHandler(fakeFrame);
      expect(_getSessionActionsForTest()?.length).toBe(0);

      await attachToOpenBrowser({
        userId: "test-user-id",
        existingTestClassPath: relSuite,
        methodName: "PostAttachNav",
      });

      const postFrame = { url: () => "https://example.com/page-post" };
      mocks.page.mainFrame = () => postFrame;
      frameHandler(postFrame);

      const after = _getSessionActionsForTest() ?? [];
      expect(after.length).toBe(1);
      expect(after[0]).toMatchObject({
        type: "navigate",
        url: "https://example.com/page-post",
      });
    } finally {
      mocks.page.mainFrame = originalMainFrame;
    }
  });
});
