import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addTestMethod,
  categoriesClassNameForSuite,
  categoriesRelPathForSuite,
  checkTestMethodExists,
  constantsClassNameForSuite,
  constantsRelPathForSuite,
  ensureCategoryFile,
  generateSuiteFiles,
  generateTestClass,
  isHookDefaultStub,
  readHookBody,
  readRecordedConstants,
  readSuiteActionsMethodNames,
  renderAssertionLinePython,
  replaceHookBody,
  writeRecordedConstants,
  pyQuotedArg,
} from "@/features/codegen/infrastructure/pythonCodegen";
import { getPythonDefaultArchitecture } from "@/features/architectures/infrastructure/architectureService";
import type { Project } from "@/features/projects/infrastructure/projectService";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

let tmp: string;

function makePythonProject(rootPath: string): Project {
  return {
    solutionName: "PySln",
    testProjectName: "pysln_tests",
    namespace: "PySln",
    rootPath,
    slnPath: path.join(rootPath, "pyproject.toml"),
    language: "python",
  };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "py-codegen-"));
  // Pre-create the directories the codegen writes into (mirrors what
  // scaffoldPythonFromArchitecture does for a real project).
  await fs.mkdir(path.join(tmp, "tests"), { recursive: true });
  await fs.mkdir(path.join(tmp, "pages", "selectors"), { recursive: true });
  await fs.mkdir(path.join(tmp, "pages", "actions"), { recursive: true });
  await fs.mkdir(path.join(tmp, "shared"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("pythonCodegen.generateTestClass", () => {
  it("emits a pytest TestFixture class with two empty hook fixtures", async () => {
    const project = makePythonProject(tmp);
    const rel = await generateTestClass(project, "Login");

    expect(rel).toBe("tests/test_login.py");
    const text = await fs.readFile(path.join(tmp, rel), "utf8");

    // Class declaration uses the user's name verbatim and inherits the
    // shared TestFixtureBase — that's what gives generated tests
    // `self.config` and `self._logger` automatically (asserted below).
    expect(text).toContain("class TestLogin(TestFixtureBase):");
    expect(text).toContain(
      "from infrastructure.test_fixture_base import TestFixtureBase",
    );
    // Both hooks are emitted as autouse pytest fixtures with a yield
    // marker — that's what `replaceHookBody` keys on later.
    expect(text).toContain("def one_time_setup(self):");
    expect(text).toContain("def before_each(self, page):");
    // Two yield lines (one per hook).
    expect(text.match(/yield/g)?.length).toBe(2);
  });

  it("inherits a TestFixtureBase that wires self.config and self._logger", () => {
    // Recorded test classes don't write the base themselves — they
    // inherit it from the architecture's `infrastructure/test_fixture_base.py`.
    // Assert here that the architecture template actually exposes the
    // helpers the task promises (`self.config` from TestConfig +
    // `self._logger` as a TestOutputLogger instance), so the
    // `TestFixtureBase` extension in the generated test isn't just a
    // naming marker but real inherited behavior.
    const arch = getPythonDefaultArchitecture();
    const infra = arch.projects.find((p) => p.id === "python-default-infra");
    expect(infra).toBeDefined();
    const baseFile = infra!.folders
      .find((f) => f.name === "infrastructure")
      ?.files.find((f) => f.name === "test_fixture_base.py");
    expect(baseFile).toBeDefined();
    const content = baseFile!.content;
    // TestConfig is bound on the class so `self.config` resolves to the
    // hydrated singleton (no per-test re-parse of os.environ / .env).
    expect(content).toContain("from shared.test_config import TestConfig");
    expect(content).toContain("config = TestConfig");
    // TestOutputLogger is bound on the class so `self._logger` works
    // out of the box from any recorded test method.
    expect(content).toContain(
      "from shared.test_output_logger import TestOutputLogger",
    );
    expect(content).toContain("_logger: TestOutputLogger = TestOutputLogger()");
  });
});

describe("pythonCodegen.isHookDefaultStub / readHookBody", () => {
  it("treats the freshly generated class as a default stub for both hooks", async () => {
    const project = makePythonProject(tmp);
    const rel = await generateTestClass(project, "Login");

    expect(await isHookDefaultStub(project, rel, "beforeEach")).toBe(true);
    expect(await isHookDefaultStub(project, rel, "oneTimeSetup")).toBe(true);

    // readHookBody returns the raw body even for a stub — the check above
    // is what callers use to decide whether to overwrite.
    const body = await readHookBody(project, rel, "beforeEach");
    expect(body).not.toBeNull();
    expect(body!.trim()).toBe("# before_each body");
  });

  it("flags a customised hook as non-default after replaceHookBody", async () => {
    const project = makePythonProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await replaceHookBody(project, rel, "beforeEach", [
      "page.goto(\"https://example.com\")",
    ]);

    expect(await isHookDefaultStub(project, rel, "beforeEach")).toBe(false);
    const body = await readHookBody(project, rel, "beforeEach");
    expect(body!.trim()).toBe('page.goto("https://example.com")');
  });
});

describe("pythonCodegen.addTestMethod", () => {
  it("appends a new snake_cased method onto the class body", async () => {
    const project = makePythonProject(tmp);
    const rel = await generateTestClass(project, "Login");

    const result = await addTestMethod(project, rel, "HappyPath", [
      "actions = LoginActions(page)",
      "actions.click_submit_1()",
    ]);

    expect(result.renamed).toBe(false);
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain("def test_happy_path(self, page):");
    expect(text).toContain("        actions.click_submit_1()");
  });

  it("emits @pytest.mark.skip and category decorators + idempotent categories import on overwrite", async () => {
    const project = makePythonProject(tmp);
    const rel = await generateTestClass(project, "Login");

    // First pass: write with both ignoreReason and a category. The
    // codegen should emit a `@pytest.mark.skip(reason="…")` line, then
    // a `@pytest.mark.{snake-slug}` line, and weave a single
    // `from test_categories.login_categories import LoginCategories`
    // import below `import pytest`.
    await addTestMethod(project, rel, "HappyPath", ["pass"], [], {
      suiteName: "Login",
      metadata: {
        ignoreReason: "flaky on CI",
        categoryConstantName: "Smoke",
        categoryValue: "smoke-tests",
      },
    });
    let text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain('@pytest.mark.skip(reason="flaky on CI")');
    expect(text).toContain("@pytest.mark.smoke_tests");
    expect(text).toContain(
      "from test_categories.login_categories import LoginCategories",
    );
    // Decorator order: skip first, then category, immediately above the
    // method header — assert the relative order.
    const skipIdx = text.indexOf("@pytest.mark.skip");
    const catIdx = text.indexOf("@pytest.mark.smoke_tests");
    const defIdx = text.indexOf("def test_happy_path");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(catIdx).toBeGreaterThan(skipIdx);
    expect(defIdx).toBeGreaterThan(catIdx);

    // Overwrite the same method — decorators must be replaced (not
    // duplicated) and the categories import must remain a single line.
    await addTestMethod(project, rel, "HappyPath", ["pass"], [], {
      overwrite: true,
      suiteName: "Login",
      metadata: {
        categoryConstantName: "Smoke",
        categoryValue: "smoke-tests",
      },
    });
    text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).not.toContain("@pytest.mark.skip"); // dropped on overwrite
    expect(
      (text.match(/@pytest\.mark\.smoke_tests/g) ?? []).length,
    ).toBe(1);
    expect(
      (
        text.match(
          /from test_categories\.login_categories import LoginCategories/g,
        ) ?? []
      ).length,
    ).toBe(1);
  });

  it("renames on collision rather than overwriting (no overwrite flag)", async () => {
    const project = makePythonProject(tmp);
    const rel = await generateTestClass(project, "Login");
    await addTestMethod(project, rel, "HappyPath", ["pass"]);
    const result = await addTestMethod(project, rel, "HappyPath", [
      "actions.click_submit_1()",
    ]);
    expect(result.renamed).toBe(true);
    expect(result.methodName).toBe("HappyPath2");

    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain("def test_happy_path(self, page):");
    expect(text).toContain("def test_happy_path2(self, page):");

    const collide = await checkTestMethodExists(project, rel, "HappyPath");
    expect(collide.exists).toBe(true);
    expect(collide.suggestedName).toBe("HappyPath3");
  });
});

describe("pythonCodegen suite-name normalization", () => {
  it.each([
    ["Login", "Login", "login"],
    ["LoginTests", "Login", "login"],
    ["LoginTest", "Login", "login"],
    ["CheckoutTestSuite", "Checkout", "checkout"],
    ["UsersTests", "Users", "users"],
    // Already-normalized name is left alone.
    ["Dashboard", "Dashboard", "dashboard"],
  ])(
    "strips trailing TestSuite/Tests/Test for %s -> %s/%s",
    (input, bare, snake) => {
      expect(constantsClassNameForSuite(input)).toBe(`${bare}Constants`);
      expect(categoriesClassNameForSuite(input)).toBe(`${bare}Categories`);
      expect(constantsRelPathForSuite(input)).toBe(
        `constants/${snake}_constants.py`,
      );
      expect(categoriesRelPathForSuite(input)).toBe(
        `test_categories/${snake}_categories.py`,
      );
    },
  );
});

describe("pythonCodegen.writeRecordedConstants (per-suite)", () => {
  it("writes constants/{snake}_constants.py with class {Suite}Constants and merges across suites", async () => {
    const project = makePythonProject(tmp);
    await fs.mkdir(path.join(tmp, "constants"), { recursive: true });

    const loginRel = await writeRecordedConstants(
      project,
      new Map([["user_name", "alice"]]),
      "Login",
    );
    expect(loginRel).toBe("constants/login_constants.py");
    let loginSrc = await fs.readFile(path.join(tmp, loginRel!), "utf8");
    expect(loginSrc).toContain("class LoginConstants:");
    expect(loginSrc).toContain('user_name = "alice"');

    // A second suite gets its own file — no cross-suite leakage.
    const checkoutRel = await writeRecordedConstants(
      project,
      new Map([["promo_code", "FREE"]]),
      "Checkout",
    );
    expect(checkoutRel).toBe("constants/checkout_constants.py");

    // Append a new key into the existing Login file — read + write
    // round-trips and the existing entry must be preserved.
    const existing = await readRecordedConstants(project, "Login");
    expect(existing.get("user_name")).toBe("alice");
    existing.set("password", "secret");
    await writeRecordedConstants(project, existing, "Login");
    loginSrc = await fs.readFile(path.join(tmp, loginRel!), "utf8");
    expect(loginSrc).toContain('user_name = "alice"');
    expect(loginSrc).toContain('password = "secret"');
  });
});

describe("pythonCodegen.ensureCategoryFile", () => {
  it("creates test_categories/{snake}_categories.py and idempotently upserts entries", async () => {
    const project = makePythonProject(tmp);
    await fs.mkdir(path.join(tmp, "test_categories"), { recursive: true });

    const rel = await ensureCategoryFile(
      project,
      "Login",
      "Smoke",
      "smoke-tests",
    );
    expect(rel).toBe("test_categories/login_categories.py");
    let src = await fs.readFile(path.join(tmp, rel!), "utf8");
    expect(src).toContain("class LoginCategories:");
    expect(src).toContain('Smoke: str = "smoke-tests"');

    // Calling again with the same pair is a no-op (no duplicate line).
    await ensureCategoryFile(project, "Login", "Smoke", "smoke-tests");
    src = await fs.readFile(path.join(tmp, rel!), "utf8");
    expect((src.match(/Smoke: str = "smoke-tests"/g) ?? []).length).toBe(1);

    // A second category for the same suite is appended into the same
    // class body, not into a sibling file.
    await ensureCategoryFile(project, "Login", "Regression", "regression");
    src = await fs.readFile(path.join(tmp, rel!), "utf8");
    expect(src).toContain('Smoke: str = "smoke-tests"');
    expect(src).toContain('Regression: str = "regression"');
  });
});

describe("pythonCodegen.addTestMethod metadata (Ignore + Categories)", () => {
  it("emits @pytest.mark.skip(reason=...) when metadata.ignoreReason is set", async () => {
    const project = makePythonProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await addTestMethod(
      project,
      rel,
      "HappyPath",
      ["actions = LoginActions(page)"],
      ["LoginActions"],
      {
        suiteName: "Login",
        metadata: {
          ignoreReason: "Flaky on CI",
          categoryConstantName: null,
          categoryValue: null,
        },
      },
    );

    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain('    @pytest.mark.skip(reason="Flaky on CI")');
    expect(text).toContain("    def test_happy_path(self, page):");
  });

  it("emits @pytest.mark.<slug> + the per-suite categories import when category metadata is set", async () => {
    const project = makePythonProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await addTestMethod(
      project,
      rel,
      "HappyPath",
      ["actions = LoginActions(page)"],
      ["LoginActions"],
      {
        suiteName: "Login",
        metadata: {
          ignoreReason: null,
          categoryConstantName: "Smoke",
          categoryValue: "smoke-tests",
        },
      },
    );

    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    // pytestMarkerName slugifies "smoke-tests" -> "smoke_tests".
    expect(text).toContain("    @pytest.mark.smoke_tests");
    expect(text).toContain("    def test_happy_path(self, page):");
    // The categoriesClassNameForSuite import is added at module top.
    expect(text).toContain(
      "from test_categories.login_categories import LoginCategories",
    );
  });

  it("toggling Ignore off across re-runs cleans up the previous decorator", async () => {
    const project = makePythonProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await addTestMethod(
      project,
      rel,
      "HappyPath",
      ["actions = LoginActions(page)"],
      ["LoginActions"],
      {
        suiteName: "Login",
        metadata: {
          ignoreReason: "Flaky on CI",
          categoryConstantName: null,
          categoryValue: null,
        },
      },
    );
    await addTestMethod(
      project,
      rel,
      "HappyPath",
      ["actions = LoginActions(page)"],
      ["LoginActions"],
      {
        overwrite: true,
        suiteName: "Login",
        metadata: {
          ignoreReason: null,
          categoryConstantName: null,
          categoryValue: null,
        },
      },
    );

    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).not.toContain("@pytest.mark.skip");
    expect(text).toContain("    def test_happy_path(self, page):");
  });
});

describe("pythonCodegen.generateSuiteFiles", () => {
  it("renders Selectors + Actions Python modules and tracks methodName/takesValue", async () => {
    const project = makePythonProject(tmp);
    const actions: RecordedAction[] = [
      {
        type: "click",
        selector: "[data-testid=\"submit\"]",
        url: "https://example.com",
      },
      {
        type: "fill",
        selector: "[data-testid=\"email\"]",
        value: "alice@example.com",
        url: "https://example.com",
      },
    ];

    const suite = await generateSuiteFiles(project, "Login", actions);
    expect(suite.selectorsPath).toBe("pages/selectors/login_selectors.py");
    expect(suite.actionsPath).toBe("pages/actions/login_actions.py");
    // Python has no separate interface — it must alias to the actions file
    // so callers that log it (recordingService's `generated[]`) get a real path.
    expect(suite.interfacePath).toBe(suite.actionsPath);

    const sel = await fs.readFile(path.join(tmp, suite.selectorsPath), "utf8");
    expect(sel).toContain("class LoginSelectors:");
    // Task #52 — selector keys carry the `_SELECTOR` suffix so a
    // page-object's noun-derived `${noun}_element` field name (e.g.
    // `submit_element`) can never collide with its selector constant.
    expect(sel).toContain('SUBMIT_SELECTOR = "[data-testid=\\"submit\\"]"');
    expect(sel).toContain('EMAIL_SELECTOR = "[data-testid=\\"email\\"]"');

    const act = await fs.readFile(path.join(tmp, suite.actionsPath), "utf8");
    expect(act).toContain("class LoginActions:");
    expect(act).toContain("from playwright.sync_api import Page");
    // New noun-flow: clicks render via the constructor-bound
    // `${noun}_element` Locator field instead of inlining
    // `self._page.click(LoginSelectors.SUBMIT)`.
    expect(act).toContain("self.submit_element.click()");
    expect(act).toContain(
      "def fill_email(self, value: str) -> None:\n        self.email_element.fill(value)",
    );

    const fillName = suite.methodNames.get(actions[1]!);
    expect(fillName).toBeDefined();
    expect(suite.takesValueByMethod.get(fillName!)).toBe(true);

    // Now that the suite is on disk, readSuiteActionsMethodNames should
    // surface those method names back so collision detection works for
    // a follow-up recording.
    const onDisk = await readSuiteActionsMethodNames(project, "Login");
    expect(onDisk.has(fillName!)).toBe(true);
  });
});

describe("pythonCodegen.renderAssertionLinePython", () => {
  it("emits expect(...) lines for element-has-text assertions", () => {
    const a: RecordedAction = {
      type: "assert",
      assertKind: "element-has-text",
      selector: "#title",
      assertText: 'Hello "World"',
    };
    expect(renderAssertionLinePython(a)).toBe(
      'expect(page.locator("#title")).to_have_text("Hello \\"World\\"")',
    );
  });

  it("uses substring `in` for url-contains and to_have_url for url-equals", () => {
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "url-contains",
        assertUrl: "/checkout",
      }),
    ).toBe('assert "/checkout" in page.url');

    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "url-equals",
        assertUrl: "https://example.com/done",
      }),
    ).toBe('expect(page).to_have_url("https://example.com/done")');
  });

  it("returns null for non-assertion actions and incomplete assertions", () => {
    expect(renderAssertionLinePython({ type: "click", selector: "#x" })).toBeNull();
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "element-has-text",
        // no selector
        assertText: "hi",
      }),
    ).toBeNull();
  });

  // Tier-1 power assertions (task 26): verify each new kind emits the
  // expected `playwright.sync_api.expect` line and skips silently when
  // the required fields are missing.
  it("emits to_be_visible() / to_be_hidden() for element-visible / element-hidden", () => {
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "element-visible",
        selector: "#cta",
      }),
    ).toBe('expect(page.locator("#cta")).to_be_visible()');
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "element-visible",
        selector: "#hello",
      }),
    ).toBe('expect(page.locator("#hello")).to_be_visible()');

    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "element-hidden",
        selector: "#spinner",
      }),
    ).toBe('expect(page.locator("#spinner")).to_be_hidden()');
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "element-hidden",
        selector: "#bye",
      }),
    ).toBe('expect(page.locator("#bye")).to_be_hidden()');

    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "element-visible",
      }),
    ).toBeNull();
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "element-hidden",
      }),
    ).toBeNull();
  });

  it("emits to_have_count(n) for element-count-equals", () => {
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "element-count-equals",
        selector: ".row",
        assertCount: 3,
      }),
    ).toBe('expect(page.locator(".row")).to_have_count(3)');
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "element-count-equals",
        selector: ".row",
      }),
    ).toBeNull();
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "element-count-equals",
        assertCount: 1,
      }),
    ).toBeNull();
  });

  it("emits to_have_attribute(name, value) for attribute-equals", () => {
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "attribute-equals",
        selector: "#link",
        assertAttribute: "href",
        assertAttrValue: "/home",
      }),
    ).toBe('expect(page.locator("#link")).to_have_attribute("href", "/home")');
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "attribute-equals",
        selector: "a.docs",
        assertAttribute: "href",
        assertAttrValue: "/docs",
      }),
    ).toBe('expect(page.locator("a.docs")).to_have_attribute("href", "/docs")');

    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "attribute-equals",
        selector: "#link",
        assertAttrValue: "/home",
      }),
    ).toBeNull();
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "attribute-equals",
        selector: "a.docs",
      }),
    ).toBeNull();
  });

  it("emits to_have_value(v) for value-equals", () => {
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "value-equals",
        selector: "#email",
        assertValue: "user@example.com",
      }),
    ).toBe('expect(page.locator("#email")).to_have_value("user@example.com")');
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "value-equals",
        selector: "input[name=email]",
        assertValue: "a@b.c",
      }),
    ).toBe('expect(page.locator("input[name=email]")).to_have_value("a@b.c")');

    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "value-equals",
        assertValue: "x",
      }),
    ).toBeNull();
  });

  it("emits a goto + status assert for response-status and rejects non-finite codes", () => {
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "response-status",
        assertStatusCode: 200,
      }),
    ).toBe("assert page.goto(page.url).status == 200");
    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "response-status",
        assertStatusCode: 404,
      }),
    ).toBe("assert page.goto(page.url).status == 404");

    expect(
      renderAssertionLinePython({
        type: "assert",
        assertKind: "response-status",
      }),
    ).toBeNull();
  });
});

describe("pythonCodegen.pyQuotedArg", () => {
  it("escapes backslashes and quotes", () => {
    expect(pyQuotedArg('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
