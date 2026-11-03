import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => {
  const fillMock = vi.fn().mockResolvedValue(undefined);
  const locatorFirst = { fill: fillMock };
  const locator = vi.fn().mockReturnValue({ first: () => locatorFirst });
  const page = {
    mouse: { click: vi.fn().mockResolvedValue(undefined) },
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    goto: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    mainFrame: () => ({ url: () => "" }),
    url: vi.fn().mockReturnValue("https://example.com/login"),
    locator,
    screenshot: vi
      .fn()
      .mockImplementation(() => new Promise(() => undefined)),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    exposeBinding: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { page, context, browser, fillMock, locator };
});

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mocks.browser) },
}));

import { setCurrentProject, type Project } from "@/features/projects/infrastructure/projectService";
import * as recording from "@/features/recording/infrastructure/recordingService";

const TEST_PROJECT = "Acme.Tests";
const NAMESPACE = "Acme";
const REL_TEST_FILE = `${TEST_PROJECT}/Tests/SampleTests.cs`;

const EXISTING_CLASS = `using System.Threading.Tasks;
using NUnit.Framework;
using ${NAMESPACE}.Base;

namespace ${NAMESPACE}.Tests
{
    [TestFixture]
    public class SampleTests : TestFixture
    {
        [Test]
        public async Task LoginAsync()
        {
            await Task.CompletedTask;
        }
    }
}
`;

function makeProject(rootPath: string): Project {
  return {
    solutionName: "Acme",
    testProjectName: TEST_PROJECT,
    namespace: NAMESPACE,
    rootPath,
    slnPath: path.join(rootPath, "Acme.sln"),
    language: "csharp",
  };
}

async function scaffoldProject(): Promise<{ tmp: string; project: Project }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-stop-"));
  const project = makeProject(tmp);
  await fs.mkdir(path.join(tmp, TEST_PROJECT, "Tests"), { recursive: true });
  await fs.writeFile(path.join(tmp, REL_TEST_FILE), EXISTING_CLASS);
  // appsettings.json starts as a valid empty config so upsertNamedUrl works.
  await fs.writeFile(
    path.join(tmp, TEST_PROJECT, "appsettings.json"),
    JSON.stringify({ Urls: {} }, null, 2),
  );
  return { tmp, project };
}

async function startSession(): Promise<void> {
  await recording.start(
    {
      startUrl: "https://example.com/login",
      urlName: "Login",
      target: "testMethod",
      methodName: "Login",
      existingTestClassPath: REL_TEST_FILE,
      newTestClassName: null,
    },
    "00000000-0000-0000-0000-000000000000",
  );
}

describe("recordingService.normalizeNewTestClassName", () => {
  it("leaves csharp names untouched at the session-config layer (the C# codegen suffixes the on-disk class name itself)", () => {
    // Task #104 — for C#, the TestSuite suffix is applied inside
    // codegen.generateTestClass so that the page-object / selector
    // filenames (which key off the raw suite stem via resolveSuiteName)
    // stay unchanged.
    expect(recording.normalizeNewTestClassName("Login", "csharp")).toBe("Login");
  });
  it("leaves nodejs names untouched so the on-disk spec filename matches the user-typed name verbatim (task #93)", () => {
    expect(recording.normalizeNewTestClassName("Login", "nodejs")).toBe("Login");
  });
  it("leaves nodejs names already ending in TestSuite untouched", () => {
    expect(recording.normalizeNewTestClassName("LoginTestSuite", "nodejs")).toBe("LoginTestSuite");
  });
  it("leaves nodejs names ending with Tests untouched", () => {
    expect(recording.normalizeNewTestClassName("LoginTests", "nodejs")).toBe("LoginTests");
  });
  it("does not modify python or java names", () => {
    expect(recording.normalizeNewTestClassName("Login", "python")).toBe("Login");
    expect(recording.normalizeNewTestClassName("Login", "java")).toBe("Login");
  });
  it("returns null for empty/null input", () => {
    expect(recording.normalizeNewTestClassName(null, "csharp")).toBe(null);
    expect(recording.normalizeNewTestClassName("", "csharp")).toBe(null);
    expect(recording.normalizeNewTestClassName("   ", "csharp")).toBe(null);
  });
  it("trims surrounding whitespace from nodejs names", () => {
    expect(recording.normalizeNewTestClassName("  Login  ", "nodejs")).toBe("Login");
  });
});

describe("recordingService.deriveSuiteNameFromConfig — C# TestSuite stripping (task #104)", () => {
  function csProject(): Project {
    return makeProject("/tmp/x");
  }
  it("strips trailing TestSuite from an existing C# test class basename so partner files keep the raw stem", () => {
    const suite = recording.deriveSuiteNameFromConfig(
      {
        startUrl: "",
        urlName: "",
        target: "testMethod",
        methodName: "Login",
        existingTestClassPath: "Acme.Tests/Tests/LoginPageTestSuite.cs",
        newTestClassName: null,
      } as recording.SessionConfig,
      csProject(),
    );
    expect(suite).toBe("LoginPage");
  });
  it("edge case: a user who originally typed `LoginPageTestSuite` will, on append, pivot sidecar naming to `LoginPage*` — by design, since the stripping rule is symmetric with the create-time suffixing", () => {
    // Scenario: on create the user typed `LoginPageTestSuite`. Because
    // normalizeCsharpTestSuiteClassName is idempotent, the test file is
    // `LoginPageTestSuite.cs` and sidecars were created with the raw
    // stem `LoginPageTestSuite` (Selectors, Actions, …). Later, an
    // append-to-existing recording targets `LoginPageTestSuite.cs` and
    // resolves the suite stem to `LoginPage`. This is the intentional
    // canonical form — partner files end up under `LoginPage*` from now
    // on, which matches what a fresh recorder typing `LoginPage` would
    // produce. Users typing `…TestSuite` get the same file layout as
    // users typing the bare stem, instead of two parallel naming
    // worlds. If we ever need to support the literal "keep my raw
    // stem" form, this test should flip and a guard added in
    // `deriveSuiteNameFromConfig` to consult the original
    // `newTestClassName` when available.
    const suite = recording.deriveSuiteNameFromConfig(
      {
        startUrl: "",
        urlName: "",
        target: "testMethod",
        methodName: "Login",
        existingTestClassPath: "Acme.Tests/Tests/LoginPageTestSuite.cs",
        newTestClassName: null,
      } as recording.SessionConfig,
      csProject(),
    );
    expect(suite).toBe("LoginPage");
  });
  it("returns the raw stem unchanged when the existing C# class does not end with TestSuite", () => {
    const suite = recording.deriveSuiteNameFromConfig(
      {
        startUrl: "",
        urlName: "",
        target: "testMethod",
        methodName: "Login",
        existingTestClassPath: "Acme.Tests/Tests/SampleTests.cs",
        newTestClassName: null,
      } as recording.SessionConfig,
      csProject(),
    );
    expect(suite).toBe("SampleTests");
  });
  it("returns the raw new-class name (so partner files use the raw stem on create)", () => {
    const suite = recording.deriveSuiteNameFromConfig(
      {
        startUrl: "",
        urlName: "",
        target: "testMethod",
        methodName: "Login",
        existingTestClassPath: null,
        newTestClassName: "LoginPage",
      } as recording.SessionConfig,
      csProject(),
    );
    expect(suite).toBe("LoginPage");
  });
});

describe("recordingService.resolveSessionFilePath — C# TestSuite suffix (task #104)", () => {
  function makeSession(
    newTestClassName: string,
    language: Project["language"] = "csharp",
  ): recording.Session {
    return {
      config: {
        startUrl: "",
        urlName: "",
        target: "testMethod",
        methodName: "Login",
        existingTestClassPath: null,
        newTestClassName,
      } as recording.SessionConfig,
      project: {
        ...makeProject("/tmp/x"),
        language,
      },
      // The rest of Session is irrelevant for this pure path computation.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
  it("returns the suffixed Tests/<Stem>TestSuite.cs for a brand-new C# class", () => {
    expect(recording.resolveSessionFilePath(makeSession("LoginPage"))).toBe(
      `${TEST_PROJECT}/Tests/LoginPageTestSuite.cs`,
    );
  });
  it("is idempotent — does not double-suffix when the user already typed TestSuite", () => {
    expect(
      recording.resolveSessionFilePath(makeSession("LoginPageTestSuite")),
    ).toBe(`${TEST_PROJECT}/Tests/LoginPageTestSuite.cs`);
  });
  it("does not suffix for non-C# languages", () => {
    expect(
      recording.resolveSessionFilePath(makeSession("LoginPage", "python")),
    ).toBe(`${TEST_PROJECT}/Tests/LoginPage.cs`);
  });
});

describe("recordingService — RecordingMetadata persistence", () => {
  let tmp: string;
  let project: Project;

  beforeEach(async () => {
    ({ tmp, project } = await scaffoldProject());
    setCurrentProject(project);
  });

  afterEach(async () => {
    await recording.shutdown();
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("defaults all three fields to null when start() is called without metadata", async () => {
    await startSession();
    const md = recording.getCurrentSessionMetadata();
    expect(md).not.toBeNull();
    expect(md).toEqual({
      ignoreReason: null,
      categoryConstantName: null,
      categoryValue: null,
    });
  });

  it("persists ignoreReason on the session config", async () => {
    await recording.start(
      {
        startUrl: "https://example.com/login",
        urlName: "Login",
        target: "testMethod",
        methodName: "Login",
        existingTestClassPath: REL_TEST_FILE,
        newTestClassName: null,
        ignoreReason: "Flaky on staging",
        categoryConstantName: null,
        categoryValue: null,
      },
      "00000000-0000-0000-0000-000000000000",
    );
    expect(recording.getCurrentSessionMetadata()).toEqual({
      ignoreReason: "Flaky on staging",
      categoryConstantName: null,
      categoryValue: null,
    });
  });

  it("persists the category pair on the session config", async () => {
    await recording.start(
      {
        startUrl: "https://example.com/login",
        urlName: "Login",
        target: "testMethod",
        methodName: "Login",
        existingTestClassPath: REL_TEST_FILE,
        newTestClassName: null,
        ignoreReason: null,
        categoryConstantName: "Smoke",
        categoryValue: "smoke-tests",
      },
      "00000000-0000-0000-0000-000000000000",
    );
    expect(recording.getCurrentSessionMetadata()).toEqual({
      ignoreReason: null,
      categoryConstantName: "Smoke",
      categoryValue: "smoke-tests",
    });
  });

  it("returns null when no session is active", async () => {
    expect(recording.getCurrentSessionMetadata()).toBeNull();
  });
});

describe("recordingService.stop() — collision flow", () => {
  let tmp: string;
  let project: Project;

  beforeEach(async () => {
    ({ tmp, project } = await scaffoldProject());
    setCurrentProject(project);
  });

  afterEach(async () => {
    await recording.shutdown();
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns a collision payload (without finalizing) when no decision is supplied and the method already exists", async () => {
    await startSession();
    const result = await recording.stop(undefined, recording.getCurrentSessionOwner()!.userId);
    expect(result.status).toBe("collision");
    if (result.status !== "collision") return;
    expect(result.methodName).toBe("LoginAsync");
    expect(result.suggestedName).toBe("LoginAsync2");
    expect(result.targetClass).toBe("SampleTests");

    // The session should still be alive so the user can pick a decision.
    const status = recording.getStatus();
    expect(status.active).toBe(true);

    // The on-disk file is unchanged.
    const text = await fs.readFile(path.join(tmp, REL_TEST_FILE), "utf8");
    expect(text).toBe(EXISTING_CLASS);
  });

  it("overwrites the existing method body when decision.mode === 'overwrite'", async () => {
    await startSession();
    const collision = await recording.stop(undefined, recording.getCurrentSessionOwner()!.userId);
    expect(collision.status).toBe("collision");

    const result = await recording.stop({ mode: "overwrite" }, recording.getCurrentSessionOwner()!.userId);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.summary).toMatch(/overwrote existing \[Test\] LoginAsync/);

    const text = await fs.readFile(path.join(tmp, REL_TEST_FILE), "utf8");
    // Only one LoginAsync method should remain — the previous body is replaced.
    const loginDecls = text.match(/public async Task LoginAsync\(\)/g) ?? [];
    expect(loginDecls.length).toBe(1);
    // The new body contains the Configuration-driven Goto for the named URL.
    expect(text).toContain(
      'await Page.GotoAsync(TestConfig.Login);',
    );
    // The old empty body is gone.
    expect(text).not.toMatch(
      /public async Task LoginAsync\(\)\s*\{\s*await Task\.CompletedTask;/s,
    );
    // After completion the session is cleared.
    expect(recording.getStatus().active).toBe(false);
  });

  it("appends a renamed method when decision.mode === 'rename'", async () => {
    await startSession();
    const collision = await recording.stop(undefined, recording.getCurrentSessionOwner()!.userId);
    expect(collision.status).toBe("collision");

    const result = await recording.stop({
      mode: "rename",
      methodName: "LoginAgain",
    }, recording.getCurrentSessionOwner()!.userId);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.summary).toMatch(/added \[Test\] LoginAgainAsync to SampleTests/);

    const text = await fs.readFile(path.join(tmp, REL_TEST_FILE), "utf8");
    // The original LoginAsync is preserved.
    expect(text).toMatch(
      /public async Task LoginAsync\(\)\s*\{\s*await Task\.CompletedTask;/s,
    );
    // The new method exists with a Goto body.
    expect(text).toMatch(/public async Task LoginAgainAsync\(\)/);
    expect(text).toContain(
      'await Page.GotoAsync(TestConfig.Login);',
    );
    expect(recording.getStatus().active).toBe(false);
  });

  it("rejects rename decisions with an invalid identifier", async () => {
    await startSession();
    await recording.stop(undefined, recording.getCurrentSessionOwner()!.userId); // collision returned, session preserved
    await expect(
      recording.stop({ mode: "rename", methodName: "1nope" }, recording.getCurrentSessionOwner()!.userId),
    ).rejects.toThrow(/methodName must start/);
    // Session is still alive after rejection.
    expect(recording.getStatus().active).toBe(true);
  });
});

describe("recordingService.stop() — hook recording flow", () => {
  let tmp: string;
  let project: Project;

  beforeEach(async () => {
    ({ tmp, project } = await scaffoldProject());
    setCurrentProject(project);
  });

  afterEach(async () => {
    await recording.shutdown();
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function startHookSession(
    target: "beforeEach" | "oneTimeSetup",
  ): Promise<void> {
    await recording.start(
      {
        startUrl: "https://example.com/login",
        urlName: "Login",
        target,
        methodName: "",
        existingTestClassPath: REL_TEST_FILE,
        newTestClassName: null,
      },
      "00000000-0000-0000-0000-000000000000",
    );
  }

  it("writes the recorded body into BeforeEachAsync for the beforeEach target", async () => {
    await startHookSession("beforeEach");
    const result = await recording.stop(undefined, recording.getCurrentSessionOwner()!.userId);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.summary).toMatch(
      /updated BeforeEachAsync in SampleTests/,
    );

    const text = await fs.readFile(path.join(tmp, REL_TEST_FILE), "utf8");
    // Page-object using directives are added.
    expect(text).toContain(`using ${NAMESPACE}.Tests.PageObjects;`);
    expect(text).toContain(`using ${NAMESPACE}.Tests.PageObjects.Interfaces;`);
    expect(text).toContain(`using ${NAMESPACE}.Tests.PageObjects.Selectors;`);
    // Hook signature switched to async Task and contains the recorded Goto.
    expect(text).toMatch(
      /\[SetUp\]\s*\n\s*public async Task BeforeEachAsync\(\)/,
    );
    expect(text).toContain(
      'await Page.GotoAsync(TestConfig.Login);',
    );
    // The default stub body is gone.
    expect(text).not.toMatch(
      /BeforeEachAsync\(\)\s*\{\s*await Task\.CompletedTask;\s*\}/s,
    );
    // The other unrelated test method is preserved.
    expect(text).toMatch(/public async Task LoginAsync\(\)/);
    // No collision check should run for hook flows — session is cleared.
    expect(recording.getStatus().active).toBe(false);
  });

  it("writes the recorded body into OneTimeSetUpAsync, appending the hook when missing", async () => {
    await startHookSession("oneTimeSetup");
    const result = await recording.stop(undefined, recording.getCurrentSessionOwner()!.userId);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.summary).toMatch(
      /updated OneTimeSetUpAsync in SampleTests/,
    );

    const text = await fs.readFile(path.join(tmp, REL_TEST_FILE), "utf8");
    expect(text).toContain(`using ${NAMESPACE}.Tests.PageObjects;`);
    expect(text).toContain(`using ${NAMESPACE}.Tests.PageObjects.Interfaces;`);
    expect(text).toContain(`using ${NAMESPACE}.Tests.PageObjects.Selectors;`);
    expect(text).toMatch(
      /\[OneTimeSetUp\]\s*\n\s*public async Task OneTimeSetUpAsync\(\)/,
    );
    expect(text).toContain(
      'await Page.GotoAsync(TestConfig.Login);',
    );
    // The fixture didn't have the hook beforehand, so it's appended exactly once.
    expect(text.match(/OneTimeSetUpAsync\(\)/g)?.length).toBe(1);
    // The pre-existing Login test is intact.
    expect(text).toMatch(/public async Task LoginAsync\(\)/);
    expect(recording.getStatus().active).toBe(false);
  });
});

describe("recordingService — editable click + fill prompt flow", () => {
  let tmp: string;
  let project: Project;
  type Emit = (src: unknown, action: Record<string, unknown>) => void;
  type WsHandler = (raw: string | Buffer) => void | Promise<void>;
  let emit: Emit;
  let wsHandler: WsHandler;
  const sentToWs: string[] = [];

  function fakeWs() {
    sentToWs.length = 0;
    let onMessage: WsHandler | null = null;
    const ws = {
      on: vi.fn((evt: string, cb: WsHandler) => {
        if (evt === "message") onMessage = cb;
      }),
      send: vi.fn((data: string) => {
        sentToWs.push(data);
      }),
      close: vi.fn(),
      readyState: 1, // WebSocket.OPEN
      OPEN: 1,
    } as unknown as Parameters<typeof recording.attachSocket>[0];
    // attachSocket now requires the authenticated owner id (audit C-2);
  // derive it from the live session so each case stays correct.
  recording.attachSocket(ws, recording.getCurrentSessionOwner()!.userId);
    if (!onMessage) throw new Error("ws message handler not registered");
    wsHandler = onMessage;
    return ws;
  }

  beforeEach(async () => {
    ({ tmp, project } = await scaffoldProject());
    setCurrentProject(project);
    mocks.fillMock.mockClear();
    mocks.locator.mockClear();
    mocks.context.exposeBinding.mockClear();
    await startSession();
    // Capture the binding callback the recorder registered.
    const call = mocks.context.exposeBinding.mock.calls.find(
      (c) => c[0] === "__recorderEmit",
    );
    if (!call) throw new Error("__recorderEmit binding never registered");
    emit = call[1] as Emit;
    fakeWs();
  });

  afterEach(async () => {
    await recording.shutdown();
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("does not record an editable click and synthesizes exactly one fill on submit", async () => {
    // 1. Editable click arrives — should NOT be persisted, just remembered.
    emit(null, {
      type: "click",
      selector: "#username",
      selectorStrategy: "id",
      editable: { kind: "input", label: "username" },
      url: "https://example.com/login",
    });

    // 2. UI submits the prompt over the websocket.
    await wsHandler(
      JSON.stringify({
        type: "fill",
        selector: "#username",
        value: "alice",
      }),
    );

    expect(mocks.locator).toHaveBeenCalledWith("#username");
    expect(mocks.fillMock).toHaveBeenCalledWith("alice");

    // 3. The change-event fill that the page injection emits should be
    //    suppressed (no double-record).
    emit(null, {
      type: "fill",
      selector: "#username",
      selectorStrategy: "id",
      value: "alice",
      url: "https://example.com/login",
    });

    // Stop the session and inspect what got recorded by reading the
    // generated test file.
    const result = await recording.stop({ mode: "overwrite" }, recording.getCurrentSessionOwner()!.userId);
    expect(result.status).toBe("completed");
    const text = await fs.readFile(path.join(tmp, REL_TEST_FILE), "utf8");

    // Exactly one Fill... call for the username field. The recorder hoists
    // typed values into a Constants helper, so the argument is either the
    // generated literal `"alice"` or a `Constants.<Name>` reference — both
    // shapes are acceptable here.
    const fillCalls =
      text.match(/actions\.Fill\w+\((?:"alice"|\w*Constants\.\w+)\)/g) ?? [];
    expect(fillCalls.length).toBe(1);
    // No raw click for the editable target leaked into the generated body.
    expect(text).not.toMatch(/actions\.Click\w*Username/i);
  });

  it("combined fill+name dialog: applies user-supplied methodName to the synthetic fill and broadcasts it", async () => {
    // Editable click first — recorded as pending, awaiting the fill prompt.
    emit(null, {
      type: "click",
      selector: "#email",
      selectorStrategy: "id",
      editable: { kind: "input", label: "email" },
      url: "https://example.com/login",
    });

    sentToWs.length = 0;

    // The combined dialog submits both the value and the chosen
    // method name on a single ws message.
    await wsHandler(
      JSON.stringify({
        type: "fill",
        selector: "#email",
        value: "alice@example.com",
        methodName: "EmailAddress",
      }),
    );

    expect(mocks.fillMock).toHaveBeenCalledWith("alice@example.com");

    // Server should have broadcast an `action` envelope for the
    // synthetic fill that carries the user-applied methodName so the
    // client knows to skip the standalone "Name this action" prompt.
    const fillBroadcast = sentToWs
      .map((s) => JSON.parse(s))
      .find(
        (m) =>
          m?.type === "action" &&
          m?.action?.type === "fill" &&
          m?.action?.selector === "#email",
      );
    expect(fillBroadcast).toBeDefined();
    // Noun-flow languages store the bare noun on the action and send the
    // decorated form alongside it for the client to render.
    expect(fillBroadcast.methodName).toBe("EmailAddress");
    expect(fillBroadcast.action.methodName).toBe("EmailAddress");
    expect(fillBroadcast.decoratedMethodName).toBe("FillEmailAddressAsync");

    // The generated test should pick up the user's chosen name.
    const result = await recording.stop({ mode: "overwrite" }, recording.getCurrentSessionOwner()!.userId);
    expect(result.status).toBe("completed");
    const text = await fs.readFile(path.join(tmp, REL_TEST_FILE), "utf8");
    expect(text).toMatch(/actions\.FillEmailAddressAsync\(/);
  });

  it("combined fill+name dialog: a colliding methodName falls back to auto-name + standalone prompt", async () => {
    // Pre-existing Actions class already exposes FillUsernameAsync, so
    // submitting the same name should NOT silently overwrite — the
    // server records the fill without applying methodName, and the
    // client falls back to enqueuing the standalone name prompt.
    emit(null, {
      type: "click",
      selector: "#username",
      selectorStrategy: "id",
      editable: { kind: "input", label: "username" },
      url: "https://example.com/login",
    });

    sentToWs.length = 0;

    await wsHandler(
      JSON.stringify({
        type: "fill",
        selector: "#username",
        value: "alice",
        // Not a valid identifier — server must reject and not apply.
        methodName: "9-bad name!",
      }),
    );

    const fillBroadcast = sentToWs
      .map((s) => JSON.parse(s))
      .find(
        (m) =>
          m?.type === "action" &&
          m?.action?.type === "fill" &&
          m?.action?.selector === "#username",
      );
    expect(fillBroadcast).toBeDefined();
    // No methodName applied — the auto-suggested fallback is sent so the
    // client can enqueue the standalone "Name this action" prompt.
    expect(fillBroadcast.methodName).toBeUndefined();
    expect(fillBroadcast.action.methodName).toBeUndefined();
    expect(typeof fillBroadcast.suggestedMethodName).toBe("string");
  });

  it("records nothing when the user cancels the fill prompt", async () => {
    emit(null, {
      type: "click",
      selector: "#password",
      selectorStrategy: "id",
      editable: { kind: "input", label: "password" },
      url: "https://example.com/login",
    });

    // No fill ws message arrives — user cancelled. Stop the session.
    const result = await recording.stop({ mode: "overwrite" }, recording.getCurrentSessionOwner()!.userId);
    expect(result.status).toBe("completed");
    const text = await fs.readFile(path.join(tmp, REL_TEST_FILE), "utf8");

    // No fill, no click recorded for the editable target.
    expect(text).not.toMatch(/actions\.Set\w*Password/);
    expect(text).not.toMatch(/actions\.Click\w*Password/i);
    expect(mocks.fillMock).not.toHaveBeenCalled();
    });

    it("live bodyPreview matches the body lines stop() writes to the test class", async () => {
      async function waitForBodyPreview(
        predicate: (lines: string[]) => boolean,
      ): Promise<string[]> {
        const deadline = Date.now() + 1000;
        while (Date.now() < deadline) {
          for (let i = sentToWs.length - 1; i >= 0; i--) {
            const msg = JSON.parse(sentToWs[i]!);
            if (msg.type === "bodyPreview" && predicate(msg.lines as string[])) {
              return msg.lines as string[];
            }
          }
          await new Promise((r) => setImmediate(r));
        }
        throw new Error("timed out waiting for matching bodyPreview broadcast");
      }

      function indexOfActionWithSelector(selector: string): number {
        for (let i = sentToWs.length - 1; i >= 0; i--) {
          const m = JSON.parse(sentToWs[i]!);
          if (
            m.type === "action" &&
            m.action?.selector === selector &&
            typeof m.index === "number"
          ) {
            return m.index as number;
          }
        }
        return -1;
      }

      // 1. Auto-named, non-editable click on a [data-testid] target.
      emit(null, {
        type: "click",
        selector: '[data-testid="submit"]',
        selectorStrategy: "data-testid",
        url: "https://example.com/login",
      });

      // 2. Editable click + fill with a quoted value (synthetic fill recorded
      //    server-side via the locator.fill path).
      emit(null, {
        type: "click",
        selector: "#comment",
        selectorStrategy: "id",
        editable: { kind: "input", label: "comment" },
        url: "https://example.com/login",
      });
      await wsHandler(
        JSON.stringify({
          type: "fill",
          selector: "#comment",
          value: 'He said "hi"',
        }),
      );

      // 3. Another non-editable click that we then explicitly name via
      //    name-action so the preview must honor the user-supplied name.
      emit(null, {
        type: "click",
        selector: '[data-testid="logout"]',
        selectorStrategy: "data-testid",
        url: "https://example.com/login",
      });
      const logoutIdx = indexOfActionWithSelector('[data-testid="logout"]');
      expect(logoutIdx).toBeGreaterThanOrEqual(0);
      await wsHandler(
        JSON.stringify({
          type: "name-action",
          index: logoutIdx,
          methodName: "SignOutCleanly",
        }),
      );

      // Wait deterministically for the bodyPreview broadcast that follows
      // the rename — broadcastBodyPreview() is fire-and-forget inside the
      // ws handler, so we poll instead of guessing a sleep duration.
      const previewLines = await waitForBodyPreview((lines) =>
        lines.some((l) => l.includes("SignOutCleanly")),
      );

      const result = await recording.stop({ mode: "overwrite" }, recording.getCurrentSessionOwner()!.userId);
      expect(result.status).toBe("completed");
      const text = await fs.readFile(path.join(tmp, REL_TEST_FILE), "utf8");
      const m = text.match(
        /public async Task LoginAsync\(\)\s*\{([\s\S]*?)\n\s*\}/,
      );
      expect(m).not.toBeNull();
      const writtenLines = m![1]!
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      // Byte-for-byte: the live preview must equal stop()-time body lines.
      expect(writtenLines).toEqual(previewLines);

      // Sanity: covers auto + custom names, plus a quoted fill value.
      expect(previewLines[0]).toBe(
        "ISampleTestsActions actions = new SampleTestsActions(Page);",
      );
      expect(previewLines[1]).toBe(
        'await Page.GotoAsync(TestConfig.Login);',
      );
      expect(
        previewLines.some((l) =>
          /^await actions\.ClickSubmit(?:\d+)?Async\(\);$/.test(l),
        ),
      ).toBe(true);
      // The fill argument may be the literal value or a Constants.* reference
      // depending on whether the typed value was hoisted into the constants
      // helper. Accept either shape.
      expect(
        previewLines.some((l) =>
          /^await actions\.FillCommentAsync\((?:"He said \\"hi\\""|\w*Constants\.\w+)\);$/.test(
            l,
          ),
        ),
      ).toBe(true);
      // Custom name `SignOutCleanly` becomes `ClickSignOutCleanlyAsync` under
      // the C# convention (verb + noun + Async).
      expect(previewLines).toContain(
        "await actions.ClickSignOutCleanlyAsync();",
      );
    });
  });

describe("recordingService — broadcastBodyPreview lineActionIndices mapping", () => {
  let tmp: string;
  let project: Project;
  type Emit = (src: unknown, action: Record<string, unknown>) => void;
  type WsHandler = (raw: string | Buffer) => void | Promise<void>;
  let emit: Emit;
  let wsHandler: WsHandler;
  const sentToWs: string[] = [];

  function fakeWs() {
    sentToWs.length = 0;
    let onMessage: WsHandler | null = null;
    const ws = {
      on: vi.fn((evt: string, cb: WsHandler) => {
        if (evt === "message") onMessage = cb;
      }),
      send: vi.fn((data: string) => {
        sentToWs.push(data);
      }),
      close: vi.fn(),
      readyState: 1,
      OPEN: 1,
    } as unknown as Parameters<typeof recording.attachSocket>[0];
    // attachSocket now requires the authenticated owner id (audit C-2);
  // derive it from the live session so each case stays correct.
  recording.attachSocket(ws, recording.getCurrentSessionOwner()!.userId);
    if (!onMessage) throw new Error("ws message handler not registered");
    wsHandler = onMessage;
    return ws;
  }

  async function waitForBodyPreview(
    predicate: (
      lines: string[],
      lineActionIndices: Array<number | null>,
    ) => boolean,
  ): Promise<{ lines: string[]; lineActionIndices: Array<number | null> }> {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      for (let i = sentToWs.length - 1; i >= 0; i--) {
        const msg = JSON.parse(sentToWs[i]!);
        if (
          msg.type === "bodyPreview" &&
          predicate(
            msg.lines as string[],
            msg.lineActionIndices as Array<number | null>,
          )
        ) {
          return {
            lines: msg.lines as string[],
            lineActionIndices: msg.lineActionIndices as Array<number | null>,
          };
        }
      }
      await new Promise((r) => setImmediate(r));
    }
    throw new Error("timed out waiting for matching bodyPreview broadcast");
  }

  beforeEach(async () => {
    ({ tmp, project } = await scaffoldProject());
    setCurrentProject(project);
    mocks.context.exposeBinding.mockClear();
    await startSession();
    const call = mocks.context.exposeBinding.mock.calls.find(
      (c) => c[0] === "__recorderEmit",
    );
    if (!call) throw new Error("__recorderEmit binding never registered");
    emit = call[1] as Emit;
    fakeWs();
  });

  afterEach(async () => {
    await recording.shutdown();
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("emits a parallel lineActionIndices array: setup lines null, action lines mapped to session indices", async () => {
    emit(null, {
      type: "click",
      selector: '[data-testid="alpha"]',
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });
    emit(null, {
      type: "click",
      selector: '[data-testid="beta"]',
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });

    const { lines, lineActionIndices } = await waitForBodyPreview(
      (l) => l.some((x) => x.includes("Beta")),
    );

    // Length parity is the invariant the UI relies on.
    expect(lineActionIndices.length).toBe(lines.length);
    // Setup lines (suite ctor + Goto) are not action-derived.
    expect(lineActionIndices[0]).toBeNull();
    expect(lineActionIndices[1]).toBeNull();
    // Two actions → two action lines, mapped to session indices 0 and 1
    // in the order they were recorded.
    const actionLineIdx = lineActionIndices.slice(2);
    expect(actionLineIdx).toEqual([0, 1]);
    // The mapped lines must actually reference the matching method names.
    expect(lines[2]).toMatch(/Alpha/);
    expect(lines[3]).toMatch(/Beta/);
  });

  it("keeps the mapping line-for-line after a delete-action: the removed index is gone, survivors keep their original session indices", async () => {
    emit(null, {
      type: "click",
      selector: '[data-testid="alpha"]',
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });
    emit(null, {
      type: "click",
      selector: '[data-testid="beta"]',
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });
    emit(null, {
      type: "click",
      selector: '[data-testid="gamma"]',
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });

    // Sanity baseline: three actions, three mapped lines.
    const before = await waitForBodyPreview(
      (l) => l.some((x) => x.includes("Gamma")),
    );
    expect(before.lineActionIndices.slice(2)).toEqual([0, 1, 2]);

    // Delete the middle action (Beta, session index 1).
    await wsHandler(
      JSON.stringify({ type: "delete-action", index: 1 }),
    );

    const after = await waitForBodyPreview(
      (l, idx) =>
        idx.length === l.length &&
        !l.some((x) => x.includes("Beta")) &&
        l.some((x) => x.includes("Gamma")),
    );
    // Length parity preserved.
    expect(after.lineActionIndices.length).toBe(after.lines.length);
    // Setup lines still null.
    expect(after.lineActionIndices[0]).toBeNull();
    expect(after.lineActionIndices[1]).toBeNull();
    // The deleted index must NOT appear anywhere in the mapping.
    expect(after.lineActionIndices).not.toContain(1);
    // Survivors keep their original session indices (0 and 2), not
    // re-indexed to a new compact range.
    expect(after.lineActionIndices.slice(2)).toEqual([0, 2]);
    // Lines line up with those indices.
    expect(after.lines[2]).toMatch(/Alpha/);
    expect(after.lines[3]).toMatch(/Gamma/);
  });

  it("undo-name-action restores the previous custom name and broadcasts actionNameUndone", async () => {
    emit(null, {
      type: "click",
      selector: '[data-testid="alpha"]',
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });
    // First name (initial naming) — no previousMethodName, not undoable.
    await wsHandler(
      JSON.stringify({
        type: "name-action",
        index: 0,
        methodName: "FirstName",
      }),
    );
    // Rename — server should remember "FirstName" as the previous name.
    await wsHandler(
      JSON.stringify({
        type: "name-action",
        index: 0,
        methodName: "SecondName",
      }),
    );

    const renameAck = sentToWs
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === "actionNamed");
    // The initial naming carries previousMethodName: null; the rename
    // carries the prior custom name so the client can offer Undo.
    expect(renameAck[0].previousMethodName).toBeNull();
    expect(renameAck[1]).toEqual(
      expect.objectContaining({
        type: "actionNamed",
        index: 0,
        methodName: "SecondName",
        previousMethodName: "FirstName",
      }),
    );

    // Undo the rename — methodName should revert to "FirstName".
    await wsHandler(
      JSON.stringify({ type: "undo-name-action", index: 0 }),
    );
    const undone = sentToWs
      .map((s) => JSON.parse(s))
      .find((m) => m.type === "actionNameUndone");
    expect(undone).toEqual({
      type: "actionNameUndone",
      index: 0,
      methodName: "FirstName",
      // C# project broadcasts also carry the fully-decorated method name
      // so the workbench can show `ClickFirstNameAsync` next to the
      // restored noun in the recorded-action feed.
      decoratedMethodName: "ClickFirstNameAsync",
    });

    // The body preview after the undo should reference the restored name.
    const after = await waitForBodyPreview((l) =>
      l.some((x) => x.includes("FirstName")),
    );
    expect(after.lines.some((l) => l.includes("SecondName"))).toBe(false);
  });

  it("undo-name-action is one-shot per rename and rejects when there is nothing to undo", async () => {
    emit(null, {
      type: "click",
      selector: '[data-testid="alpha"]',
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });
    await wsHandler(
      JSON.stringify({ type: "name-action", index: 0, methodName: "A" }),
    );
    await wsHandler(
      JSON.stringify({ type: "name-action", index: 0, methodName: "B" }),
    );

    // First undo restores "A".
    await wsHandler(
      JSON.stringify({ type: "undo-name-action", index: 0 }),
    );
    const undone1 = sentToWs
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === "actionNameUndone");
    expect(undone1.length).toBe(1);
    expect(undone1[0].methodName).toBe("A");

    // Second undo (without a fresh rename) is rejected, not silently
    // re-applied — there is nothing left to undo.
    sentToWs.length = 0;
    await wsHandler(
      JSON.stringify({ type: "undo-name-action", index: 0 }),
    );
    const errs = sentToWs
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === "undoNameActionError");
    expect(errs.length).toBe(1);
    expect(errs[0].index).toBe(0);
    // No second actionNameUndone broadcast: state stays at "A".
    const surplus = sentToWs
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === "actionNameUndone");
    expect(surplus.length).toBe(0);
  });

  it("initial naming is not undoable: actionNamed reports previousMethodName: null and undo-name-action is rejected", async () => {
    // The very first time an action is named (no prior methodName), the
    // server signals the absence of a previous custom name with
    // `previousMethodName: null` so the client knows NOT to surface an
    // Undo affordance. A pre-emptive undo for that action should be
    // rejected because there is no prior name to revert to.
    emit(null, {
      type: "click",
      selector: '[data-testid="alpha"]',
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });
    await wsHandler(
      JSON.stringify({ type: "name-action", index: 0, methodName: "Foo" }),
    );
    const initial = sentToWs
      .map((s) => JSON.parse(s))
      .find((m) => m.type === "actionNamed");
    expect(initial.previousMethodName).toBeNull();

    sentToWs.length = 0;
    await wsHandler(
      JSON.stringify({ type: "undo-name-action", index: 0 }),
    );
    expect(
      sentToWs.map((s) => JSON.parse(s)).find((m) => m.type === "undoNameActionError"),
    ).toBeTruthy();
  });

  it("deleting a renamed action drops the rename undo so undo-name-action no longer applies", async () => {
    emit(null, {
      type: "click",
      selector: '[data-testid="alpha"]',
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });
    await wsHandler(
      JSON.stringify({ type: "name-action", index: 0, methodName: "A" }),
    );
    await wsHandler(
      JSON.stringify({ type: "name-action", index: 0, methodName: "B" }),
    );
    // Delete the action — pending rename undo must be cleared so a
    // later undelete doesn't accidentally restore the prior name.
    await wsHandler(
      JSON.stringify({ type: "delete-action", index: 0 }),
    );
    sentToWs.length = 0;
    await wsHandler(
      JSON.stringify({ type: "undo-name-action", index: 0 }),
    );
    const errs = sentToWs
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === "undoNameActionError");
    expect(errs.length).toBe(1);
    // Now undelete and confirm the action came back with the LATEST
    // name ("B"), not the pre-rename "A".
    await wsHandler(
      JSON.stringify({ type: "undelete-action", index: 0 }),
    );
    const restored = sentToWs
      .map((s) => JSON.parse(s))
      .find((m) => m.type === "actionUndeleted");
    expect(restored.action.methodName).toBe("B");
  });

  it("keeps the mapping line-for-line after a name-action rename: the renamed line still maps to the same session index", async () => {
    emit(null, {
      type: "click",
      selector: '[data-testid="alpha"]',
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });
    emit(null, {
      type: "click",
      selector: '[data-testid="beta"]',
      selectorStrategy: "data-testid",
      url: "https://example.com/login",
    });

    // Baseline mapping before the rename.
    const before = await waitForBodyPreview(
      (l) => l.some((x) => x.includes("Beta")),
    );
    expect(before.lineActionIndices.slice(2)).toEqual([0, 1]);

    // Rename action at session index 1 (Beta).
    await wsHandler(
      JSON.stringify({
        type: "name-action",
        index: 1,
        methodName: "DoBetaThing",
      }),
    );

    const after = await waitForBodyPreview((l) =>
      l.some((x) => x.includes("DoBetaThing")),
    );
    expect(after.lineActionIndices.length).toBe(after.lines.length);
    expect(after.lineActionIndices[0]).toBeNull();
    expect(after.lineActionIndices[1]).toBeNull();
    // Indices are unchanged by the rename — mapping stays line-for-line.
    expect(after.lineActionIndices.slice(2)).toEqual([0, 1]);
    expect(after.lines[2]).toMatch(/Alpha/);
    expect(after.lines[3]).toMatch(/DoBetaThing/);
  });
});
  