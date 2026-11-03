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
import { generateTestClass as generatePythonTestClass } from "@/features/codegen/infrastructure/pythonCodegen";
import { generateTestClass as generateNodejsTestClass } from "@/features/codegen/infrastructure/nodejsCodegen";
import { generateTestClass as generateJavaTestClass } from "@/features/codegen/infrastructure/javaCodegen";

const USER_ID = "00000000-0000-0000-0000-000000000000";

type Emit = (src: unknown, action: Record<string, unknown>) => void;

function pythonProject(rootPath: string): Project {
  return {
    solutionName: "AcmePy",
    testProjectName: "acme_py_tests",
    namespace: "AcmePy",
    rootPath,
    slnPath: path.join(rootPath, "pyproject.toml"),
    language: "python",
  };
}

function nodejsProject(rootPath: string): Project {
  return {
    solutionName: "AcmeJs",
    testProjectName: "acme-js",
    namespace: "AcmeJs",
    rootPath,
    slnPath: path.join(rootPath, "package.json"),
    language: "nodejs",
  };
}

async function scaffoldPython(): Promise<{ tmp: string; project: Project; testFileRel: string }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-stop-py-"));
  const project = pythonProject(tmp);
  // Mirrors what scaffoldPythonFromArchitecture would lay down.
  await fs.mkdir(path.join(tmp, "tests"), { recursive: true });
  await fs.mkdir(path.join(tmp, "pages", "selectors"), { recursive: true });
  await fs.mkdir(path.join(tmp, "pages", "actions"), { recursive: true });
  await fs.mkdir(path.join(tmp, "shared"), { recursive: true });
  // Generate the same `test_login.py` skeleton that real recordings target.
  const testFileRel = await generatePythonTestClass(project, "Login");
  return { tmp, project, testFileRel };
}

function javaProject(rootPath: string): Project {
  return {
    solutionName: "AcmeJv",
    testProjectName: "AcmeJv-tests",
    namespace: "acmejv",
    rootPath,
    slnPath: path.join(rootPath, "pom.xml"),
    language: "java",
  };
}

async function scaffoldJava(): Promise<{ tmp: string; project: Project; testFileRel: string }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-stop-java-"));
  const project = javaProject(tmp);
  // Mirrors what scaffoldJavaFromArchitecture would lay down: the
  // tests-module Java tree (where tests, selectors, and actions live)
  // plus the shared-module Java tree (where the page-object interface
  // lives). Pre-creating these dirs keeps the codegen focused on the
  // emit/finalize path under test.
  const testsRoot = path.join(
    tmp,
    "AcmeJv-tests",
    "src",
    "test",
    "java",
    "acmejv",
  );
  const sharedRoot = path.join(
    tmp,
    "AcmeJv-shared",
    "src",
    "main",
    "java",
    "acmejv",
  );
  await fs.mkdir(path.join(testsRoot, "tests"), { recursive: true });
  await fs.mkdir(path.join(testsRoot, "pages", "selectors"), { recursive: true });
  await fs.mkdir(path.join(testsRoot, "pages", "actions"), { recursive: true });
  await fs.mkdir(path.join(sharedRoot, "pages", "interfaces"), { recursive: true });
  // Pre-generate the same `TestLogin.java` skeleton that real recordings
  // target so the test exercises the "continue an existing test file"
  // path — that's the path where `targetClassName`'s C#-only `.cs`
  // strip used to mangle the suite name into `TestLogin.java` and
  // produce uncompilable code (task #83).
  const testFileRel = await generateJavaTestClass(project, "Login");
  return { tmp, project, testFileRel };
}

async function scaffoldNodejs(): Promise<{ tmp: string; project: Project; testFileRel: string }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-stop-node-"));
  const project = nodejsProject(tmp);
  await fs.mkdir(path.join(tmp, "tests"), { recursive: true });
  await fs.mkdir(path.join(tmp, "pages", "selectors"), { recursive: true });
  await fs.mkdir(path.join(tmp, "pages", "actions"), { recursive: true });
  await fs.mkdir(path.join(tmp, "shared"), { recursive: true });
  const testFileRel = await generateNodejsTestClass(project, "Login");
  return { tmp, project, testFileRel };
}

async function startRecordingAndCaptureEmit(
  testFileRel: string,
  methodName: string,
): Promise<Emit> {
  mocks.context.exposeBinding.mockClear();
  await recording.start(
    {
      startUrl: "https://example.com/login",
      urlName: "Login",
      target: "testMethod",
      methodName,
      existingTestClassPath: testFileRel,
      newTestClassName: null,
    },
    USER_ID,
  );
  const call = mocks.context.exposeBinding.mock.calls.find(
    (c) => c[0] === "__recorderEmit",
  );
  if (!call) throw new Error("__recorderEmit binding never registered");
  return call[1] as Emit;
}

function feedSyntheticActions(emit: Emit): void {
  // Two synthetic clicks. We avoid `editable` clicks (which require a
  // websocket-driven fill round-trip) so the tests stay focused on the
  // language-aware emit/finalize path.
  emit(null, {
    type: "click",
    selector: '[data-testid="submit"]',
    selectorStrategy: "data-testid",
    url: "https://example.com/login",
  });
  emit(null, {
    type: "click",
    selector: '[data-testid="logout"]',
    selectorStrategy: "data-testid",
    url: "https://example.com/login",
  });
}

describe("recordingService.stop() — Python project full flow", () => {
  let tmp: string;
  let project: Project;
  let testFileRel: string;

  beforeEach(async () => {
    ({ tmp, project, testFileRel } = await scaffoldPython());
    setCurrentProject(project);
  });

  afterEach(async () => {
    await recording.shutdown();
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writes the recorded clicks into the generated python test file", async () => {
    const emit = await startRecordingAndCaptureEmit(testFileRel, "HappyPath");
    feedSyntheticActions(emit);

    const result = await recording.stop({ mode: "overwrite" }, recording.getCurrentSessionOwner()!.userId);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    // Stop summary should reference the python test method.
    expect(result.summary).toMatch(/HappyPath/);

    const text = await fs.readFile(path.join(tmp, testFileRel), "utf8");

    // Python files use `.py` extension and snake_cased test functions.
    expect(testFileRel.endsWith(".py")).toBe(true);
    expect(text).toContain("def test_happy_path(self, page):");
    // Recorded body: header line, env-driven goto, two click calls.
    expect(text).toContain(
      'page.goto(TestConfig.LOGIN)',
    );
    // Task #52 — Python noun-flow renders `actions.${verb}_${noun}()`
    // and only adds an index suffix on collision. Two distinct
    // selectors → two distinct nouns → no suffix.
    const submitCalls = text.match(/actions\.click_submit\(\)/g) ?? [];
    expect(submitCalls.length).toBeGreaterThanOrEqual(1);
    const logoutCalls = text.match(/actions\.click_logout\(\)/g) ?? [];
    expect(logoutCalls.length).toBeGreaterThanOrEqual(1);

    // Selectors file: the recorded selector strings end up here verbatim
    // — that's the "expected selector" half of the recorded-step →
    // generated-code contract.
    const selectorsDir = path.join(tmp, "pages", "selectors");
    const selectorFiles = await fs.readdir(selectorsDir);
    expect(selectorFiles.length).toBeGreaterThanOrEqual(1);
    const selectors = await fs.readFile(
      path.join(selectorsDir, selectorFiles[0]!),
      "utf8",
    );
    // The selector strings are emitted as quoted Python literals with
    // backslash-escaped inner quotes (`"[data-testid=\"submit\"]"`).
    expect(selectors).toContain('[data-testid=\\"submit\\"]');
    expect(selectors).toContain('[data-testid=\\"logout\\"]');
  });

  it("returns a collision payload when the python test method already exists", async () => {
    // Pre-seed a colliding `test_happy_path` method so the python collision
    // branch in `stop()` mirrors the C# contract.
    const existing = await fs.readFile(path.join(tmp, testFileRel), "utf8");
    const collidingClass =
      existing.replace(/\n+$/, "") +
      "\n\n    def test_happy_path(self, page):\n        pass\n";
    await fs.writeFile(path.join(tmp, testFileRel), collidingClass);

    const emit = await startRecordingAndCaptureEmit(testFileRel, "HappyPath");
    feedSyntheticActions(emit);

    const collision = await recording.stop(undefined, recording.getCurrentSessionOwner()!.userId);
    expect(collision.status).toBe("collision");
    if (collision.status !== "collision") return;
    expect(collision.methodName).toBe("HappyPath");
    // python `suggestedName` increments the user-facing PascalCase name
    // (matching the C# contract); the on-disk snake_case is computed from it.
    expect(collision.suggestedName).toBe("HappyPath2");
    // Mirrors the C# collision payload contract: targetClass surfaces the
    // file's basename (stripped of the C# `.cs` suffix only — for python
    // the basename keeps its `.py` for now).
    expect(collision.targetClass).toBe("test_login.py");

    // Session is still alive so the user can choose a decision.
    expect(recording.getStatus().active).toBe(true);

    // The python test file is unchanged on collision.
    const after = await fs.readFile(path.join(tmp, testFileRel), "utf8");
    expect(after).toBe(collidingClass);

    // Following up with `rename` writes the renamed method without
    // touching the original.
    const renamed = await recording.stop({
      mode: "rename",
      methodName: "HappyPath2",
    }, recording.getCurrentSessionOwner()!.userId);
    expect(renamed.status).toBe("completed");
    if (renamed.status !== "completed") return;
    expect(renamed.summary).toMatch(/HappyPath2/);

    const final = await fs.readFile(path.join(tmp, testFileRel), "utf8");
    // Original method preserved.
    expect(final).toMatch(/def test_happy_path\(self, page\):\s*\n\s*pass/);
    // Renamed method appended.
    expect(final).toContain("def test_happy_path2(self, page):");
    expect(final).toContain(
      'page.goto(TestConfig.LOGIN)',
    );
    expect(recording.getStatus().active).toBe(false);
  });
});

describe("recordingService.stop() — Node.js project full flow", () => {
  let tmp: string;
  let project: Project;
  let testFileRel: string;

  beforeEach(async () => {
    ({ tmp, project, testFileRel } = await scaffoldNodejs());
    setCurrentProject(project);
  });

  afterEach(async () => {
    await recording.shutdown();
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writes the recorded clicks into the generated node.js spec file", async () => {
    const emit = await startRecordingAndCaptureEmit(testFileRel, "HappyPath");
    feedSyntheticActions(emit);

    const result = await recording.stop({ mode: "overwrite" }, recording.getCurrentSessionOwner()!.userId);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.summary).toMatch(/HappyPath/);

    const text = await fs.readFile(path.join(tmp, testFileRel), "utf8");

    // Node.js spec files use `.spec.ts`.
    expect(testFileRel.endsWith(".spec.ts")).toBe(true);
    // Playwright's test() wrapper for the new method.
    expect(text).toContain('test("HappyPath", async ({ page }) => {');
    // Header line: env-driven goto.
    expect(text).toContain(
      'await page.goto(TestConfig.LOGIN);',
    );
    // Task #52 — Node.js noun-flow renders `await actions.${verb}${Noun}()`
    // and only adds an index suffix on collision. Two distinct
    // selectors → two distinct nouns → no suffix.
    const submitCalls = text.match(/await actions\.clickSubmit\(\);/g) ?? [];
    expect(submitCalls.length).toBeGreaterThanOrEqual(1);
    const logoutCalls = text.match(/await actions\.clickLogout\(\);/g) ?? [];
    expect(logoutCalls.length).toBeGreaterThanOrEqual(1);

    // Selectors file: recorded selector strings land here verbatim —
    // that's the "expected selector" half of the recorded-step →
    // generated-code contract.
    const selectorsDir = path.join(tmp, "pages", "selectors");
    const selectorFiles = await fs.readdir(selectorsDir);
    expect(selectorFiles.length).toBeGreaterThanOrEqual(1);
    const selectors = await fs.readFile(
      path.join(selectorsDir, selectorFiles[0]!),
      "utf8",
    );
    // Selector strings are emitted as quoted TypeScript literals with
    // backslash-escaped inner quotes.
    expect(selectors).toContain('[data-testid=\\"submit\\"]');
    expect(selectors).toContain('[data-testid=\\"logout\\"]');
  });
});

describe("recordingService.stop() — Java project full flow", () => {
  let tmp: string;
  let project: Project;
  let testFileRel: string;

  beforeEach(async () => {
    ({ tmp, project, testFileRel } = await scaffoldJava());
    setCurrentProject(project);
  });

  afterEach(async () => {
    await recording.shutdown();
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writes the recorded clicks into the generated java test file", async () => {
    const emit = await startRecordingAndCaptureEmit(testFileRel, "HappyPath");
    feedSyntheticActions(emit);

    const result = await recording.stop({ mode: "overwrite" }, recording.getCurrentSessionOwner()!.userId);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.summary).toMatch(/HappyPath/);

    // Java test classes live under `<sln>-tests/src/test/java/<pkg>/tests/`
    // and are named `Test<Suite>.java` (NOT `<Suite>Test.java`).
    expect(testFileRel).toBe(
      "AcmeJv-tests/src/test/java/acmejv/tests/TestLogin.java",
    );

    const text = await fs.readFile(path.join(tmp, testFileRel), "utf8");

    // JUnit 5 @Test wrapper for the new method.
    expect(text).toMatch(/@Test\s*\n\s*void HappyPath\(\)\s*\{/);
    // Header line: page-object instantiated via the interface and
    // navigation read through the scaffolded AppConfiguration helper.
    expect(text).toContain(
      "ILoginActions actions = new LoginActions(page);",
    );
    expect(text).toContain(
      "page.navigate(TestConfig.LOGIN);",
    );
    // Imports for the page-object types and config helper must be
    // emitted by addTestMethod's import-stitching pass.
    expect(text).toContain("import acmejv.TestConfig;");
    expect(text).toContain("import acmejv.pages.actions.LoginActions;");
    expect(text).toContain("import acmejv.pages.interfaces.ILoginActions;");
    // Java is on the legacy noun-flow: each action gets a unique
    // `${verb}${Noun}${index}` suffix. Two distinct selectors → two
    // distinct method calls.
    expect(text).toMatch(/actions\.clickSubmit\d+\(\);/);
    expect(text).toMatch(/actions\.clickLogout\d+\(\);/);

    // The selectors file must capture the recorded selector strings
    // verbatim — that's the "expected selector" half of the
    // recorded-step → generated-code contract.
    const selectorsRel =
      "AcmeJv-tests/src/test/java/acmejv/pages/selectors/LoginSelectors.java";
    const selectors = await fs.readFile(path.join(tmp, selectorsRel), "utf8");
    expect(selectors).toContain("public final class LoginSelectors");
    expect(selectors).toContain('"[data-testid=\\"submit\\"]"');
    expect(selectors).toContain('"[data-testid=\\"logout\\"]"');

    // The shared-module page-object interface must declare a void
    // signature for each recorded action so consumers can mock it.
    const interfaceRel =
      "AcmeJv-shared/src/main/java/acmejv/pages/interfaces/ILoginActions.java";
    const iface = await fs.readFile(path.join(tmp, interfaceRel), "utf8");
    expect(iface).toContain("public interface ILoginActions");
    expect(iface).toMatch(/void clickSubmit\d+\(\);/);
    expect(iface).toMatch(/void clickLogout\d+\(\);/);
  });
});
