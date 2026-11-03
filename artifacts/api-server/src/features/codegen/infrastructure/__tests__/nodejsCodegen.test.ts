import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addTestMethod,
  checkTestMethodExists,
  generateSuiteFiles,
  generateTestClass,
  isHookDefaultStub,
  readHookBody,
  readSuiteActionsMethodNames,
  renderAssertionLineNodejs,
  replaceHookBody,
  tsQuotedArg,
} from "@/features/codegen/infrastructure/nodejsCodegen";
import type { Project } from "@/features/projects/infrastructure/projectService";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

let tmp: string;

function makeNodejsProject(rootPath: string): Project {
  return {
    solutionName: "JsSln",
    testProjectName: "js-sln",
    namespace: "JsSln",
    rootPath,
    slnPath: path.join(rootPath, "package.json"),
    language: "nodejs",
  };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "node-codegen-"));
  // Pre-create the directories the codegen writes into (mirrors what
  // scaffoldNodejsFromArchitecture does for a real project).
  await fs.mkdir(path.join(tmp, "tests"), { recursive: true });
  await fs.mkdir(path.join(tmp, "pages", "selectors"), { recursive: true });
  await fs.mkdir(path.join(tmp, "pages", "actions"), { recursive: true });
  await fs.mkdir(path.join(tmp, "shared"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("nodejsCodegen.generateTestClass", () => {
  it("emits a Playwright test.describe with two empty hook fixtures", async () => {
    const project = makeNodejsProject(tmp);
    const rel = await generateTestClass(project, "Login");

    expect(rel).toBe("tests/Login.spec.ts");
    const text = await fs.readFile(path.join(tmp, rel), "utf8");

    // Imports the wrapped Playwright Test runner from `shared/fixtures.ts`
    // — that's what gives the recorded suite the `_tracingAuto` and
    // `_trackerAuto` auto-fixtures (the `@start-tracer` tag wiring +
    // TestTracker counters) without the user hand-editing the import.
    expect(text).toContain('import { test, expect } from "../shared/fixtures"');
    // The raw `@playwright/test` import is intentionally *not* used
    // anymore — that would bypass the wrapped fixtures.
    expect(text).not.toContain('from "@playwright/test"');
    // Both hooks emitted as `test.beforeAll` / `test.beforeEach` blocks
    // wrapping a placeholder body that `replaceHookBody` will overwrite.
    expect(text).toContain('test.describe("Login", () => {');
    expect(text).toContain("test.beforeAll(async () => {");
    expect(text).toContain("test.beforeEach(async ({ page }) => {");
  });
});

describe("nodejsCodegen.isHookDefaultStub / readHookBody", () => {
  it("treats the freshly generated class as a default stub for both hooks", async () => {
    const project = makeNodejsProject(tmp);
    const rel = await generateTestClass(project, "Login");

    expect(await isHookDefaultStub(project, rel, "beforeEach")).toBe(true);
    expect(await isHookDefaultStub(project, rel, "oneTimeSetup")).toBe(true);

    // readHookBody returns the raw body even for a stub — the check above
    // is what callers use to decide whether to overwrite. The stub body is
    // a single comment line, which `isHookDefaultStub` filters out.
    const body = await readHookBody(project, rel, "beforeEach");
    expect(body).not.toBeNull();
    expect(body!.trim()).toBe("// beforeEach body");
  });

  it("flags a customised hook as non-default after replaceHookBody", async () => {
    const project = makeNodejsProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await replaceHookBody(project, rel, "beforeEach", [
      'await page.goto("https://example.com");',
    ]);

    expect(await isHookDefaultStub(project, rel, "beforeEach")).toBe(false);
    const body = await readHookBody(project, rel, "beforeEach");
    expect(body!.trim()).toBe('await page.goto("https://example.com");');
  });
});

describe("nodejsCodegen.addTestMethod", () => {
  it("appends a new test() block onto the describe body", async () => {
    const project = makeNodejsProject(tmp);
    const rel = await generateTestClass(project, "Login");

    const result = await addTestMethod(project, rel, "HappyPath", [
      "const actions = new LoginActions(page);",
      "await actions.clickSubmit1();",
    ]);

    expect(result.renamed).toBe(false);
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain('test("HappyPath", async ({ page }) => {');
    expect(text).toContain("    await actions.clickSubmit1();");
  });

  it("renames on collision rather than overwriting (no overwrite flag)", async () => {
    const project = makeNodejsProject(tmp);
    const rel = await generateTestClass(project, "Login");
    await addTestMethod(project, rel, "HappyPath", ["// noop"]);
    const result = await addTestMethod(project, rel, "HappyPath", [
      "await actions.clickSubmit1();",
    ]);
    expect(result.renamed).toBe(true);
    expect(result.methodName).toBe("HappyPath2");

    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain('test("HappyPath", async ({ page }) => {');
    expect(text).toContain('test("HappyPath2", async ({ page }) => {');

    const collide = await checkTestMethodExists(project, rel, "HappyPath");
    expect(collide.exists).toBe(true);
    expect(collide.suggestedName).toBe("HappyPath3");
  });

  it("inserts an import for the suite Actions class so the spec is runnable", async () => {
    // Regression: without this insertion the spec body references
    // `LoginActions` which is undefined at runtime, and
    // `npx playwright test` would fail with ReferenceError.
    const project = makeNodejsProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await addTestMethod(
      project,
      rel,
      "HappyPath",
      [
        "const actions = new LoginActions(page);",
        "await actions.clickSubmit1();",
      ],
      ["LoginActions"],
    );

    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain(
      'import { LoginActions } from "../pages/actions/LoginActions";',
    );
    // The wrapped Playwright runner import the scaffold emitted is
    // preserved — `addTestMethod` only inserts new imports it needs,
    // never replaces the existing import header.
    expect(text).toContain(
      'import { test, expect } from "../shared/fixtures"',
    );
  });

  it("does not duplicate imports when called repeatedly with the same suite", async () => {
    const project = makeNodejsProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await addTestMethod(project, rel, "Test1", ["// noop"], ["LoginActions"]);
    await addTestMethod(project, rel, "Test2", ["// noop"], ["LoginActions"]);

    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    const matches = text.match(
      /import \{ LoginActions \} from "\.\.\/pages\/actions\/LoginActions";/g,
    );
    expect(matches?.length).toBe(1);
  });

  it("emits test.skip + // Ignored: comment when metadata.ignoreReason is set", async () => {
    const project = makeNodejsProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await addTestMethod(
      project,
      rel,
      "HappyPath",
      ["await actions.clickSubmit1();"],
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
    expect(text).toContain("  // Ignored: Flaky on CI");
    expect(text).toContain('test.skip("HappyPath", async ({ page }) => {');
  });

  it("emits the per-suite Categories import + tag option when metadata.categoryConstantName is set", async () => {
    const project = makeNodejsProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await addTestMethod(
      project,
      rel,
      "HappyPath",
      ["await actions.clickSubmit1();"],
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
    expect(text).toContain(
      'import { LoginCategories } from "../test-categories/login.categories";',
    );
    expect(text).toContain(
      'test("HappyPath", { tag: [LoginCategories.Smoke] }, async ({ page }) => {',
    );
    // Categories file is upserted alongside the test.
    const categoriesSrc = await fs.readFile(
      path.join(tmp, "test-categories/login.categories.ts"),
      "utf8",
    );
    expect(categoriesSrc).toContain("export const LoginCategories = {");
    expect(categoriesSrc).toContain('Smoke: "smoke-tests"');
  });

  it("toggling Ignore off across re-runs cleans up the previous // Ignored comment", async () => {
    const project = makeNodejsProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await addTestMethod(
      project,
      rel,
      "HappyPath",
      ["await actions.clickSubmit1();"],
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
      ["await actions.clickSubmit1();"],
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
    expect(text).not.toContain("// Ignored:");
    expect(text).not.toContain("test.skip(");
    expect(text).toContain('test("HappyPath", async ({ page }) => {');
  });

  it("inserts the Constants import only when the body references Constants.*", async () => {
    const project = makeNodejsProject(tmp);
    const rel = await generateTestClass(project, "Login");

    // First call — no Constants reference, no Constants import.
    await addTestMethod(project, rel, "NoConsts", [
      "await page.goto('https://example.com');",
    ]);
    let text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).not.toContain('from "../shared/constants"');

    // Second call — body references `Constants.userName`, import gets added.
    await addTestMethod(project, rel, "WithConsts", [
      "await actions.fillEmail1(Constants.userName);",
    ]);
    text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain(
      'import { Constants } from "../shared/constants";',
    );
  });
});

describe("nodejsCodegen.generateSuiteFiles", () => {
  it("renders Selectors + Actions TypeScript modules and tracks methodName/takesValue", async () => {
    const project = makeNodejsProject(tmp);
    const actions: RecordedAction[] = [
      {
        type: "click",
        selector: '[data-testid="submit"]',
        url: "https://example.com",
      },
      {
        type: "fill",
        selector: '[data-testid="email"]',
        value: "alice@example.com",
        url: "https://example.com",
      },
    ];

    const suite = await generateSuiteFiles(project, "Login", actions);
    expect(suite.selectorsPath).toBe("pages/selectors/LoginSelectors.ts");
    expect(suite.actionsPath).toBe("pages/actions/LoginActions.ts");
    // Node.js / TypeScript has no separate interface file — the actions
    // class serves both roles, so `interfacePath` aliases to the actions
    // path for callers that log it (recordingService's `generated[]`).
    expect(suite.interfacePath).toBe(suite.actionsPath);

    const sel = await fs.readFile(path.join(tmp, suite.selectorsPath), "utf8");
    expect(sel).toContain("export const LoginSelectors = {");
    // Task #52 — selector keys carry the `Selector` suffix so a
    // page-object's noun-derived `${noun}Element` Locator field name
    // (e.g. `submitElement`) never collides with its selector key.
    expect(sel).toContain('submitSelector: "[data-testid=\\"submit\\"]",');
    expect(sel).toContain('emailSelector: "[data-testid=\\"email\\"]",');

    const act = await fs.readFile(path.join(tmp, suite.actionsPath), "utf8");
    expect(act).toContain("export class LoginActions {");
    // New noun-flow imports `Locator` alongside `Page` for the
    // constructor-bound `${noun}Element` fields.
    expect(act).toContain(
      'import type { Locator, Page } from "@playwright/test"',
    );
    // Clicks render via the field-style `this.${noun}Element.click()`
    // instead of inlining `await this.page.click(LoginSelectors.submit)`.
    expect(act).toContain("await this.submitElement.click();");
    expect(act).toContain(
      "async fillEmail(value: string): Promise<void> {\n    await this.emailElement.fill(value);\n  }",
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

  it("preserves the constructor on a follow-up recording (no field-init duplication)", async () => {
    // Regression guard for task #52 — the actions class constructor is
    // now multi-line (one initializer per `${noun}Element` field), so
    // the merge path's `extractActionsClassMethods` must brace-count
    // past the full constructor instead of skipping a single line. The
    // bug it guards against would re-emit the field-init lines and the
    // constructor's closing `}` into the class body on every follow-up
    // recording, producing invalid TypeScript and silently growing
    // the file.
    const project = makeNodejsProject(tmp);
    const first: RecordedAction[] = [
      {
        type: "click",
        selector: '[data-testid="submit"]',
        url: "https://example.com",
      },
    ];
    await generateSuiteFiles(project, "Login", first);

    // Follow-up recording adds a second action — exercises the merge
    // path that reads the previous file off disk.
    const second: RecordedAction[] = [
      ...first,
      {
        type: "fill",
        selector: '[data-testid="email"]',
        value: "alice@example.com",
        url: "https://example.com",
      },
    ];
    const suite2 = await generateSuiteFiles(project, "Login", second);
    const merged = await fs.readFile(
      path.join(tmp, suite2.actionsPath),
      "utf8",
    );

    // The constructor body itself appears exactly once.
    expect(merged.match(/this\.page = page;/g)?.length).toBe(1);
    expect(merged.match(/this\.submitElement = page\.locator/g)?.length).toBe(
      1,
    );
    // The new field is initialized once too.
    expect(merged.match(/this\.emailElement = page\.locator/g)?.length).toBe(
      1,
    );
    // The class still has exactly one closing brace at column zero
    // (the class itself) plus the constructor's brace at indent 2.
    const classClosingBraces = (merged.match(/^\}\s*$/gm) ?? []).length;
    expect(classClosingBraces).toBe(1);
    // Both methods are present and well-formed.
    expect(merged).toContain("async clickSubmit(): Promise<void> {");
    expect(merged).toContain(
      "async fillEmail(value: string): Promise<void> {",
    );
  });
});

describe("nodejsCodegen.renderAssertionLineNodejs", () => {
  it("emits expect(...).toHaveText lines for element-has-text assertions", () => {
    const a: RecordedAction = {
      type: "assert",
      assertKind: "element-has-text",
      selector: "#title",
      assertText: 'Hello "World"',
    };
    expect(renderAssertionLineNodejs(a)).toBe(
      'await expect(page.locator("#title")).toHaveText("Hello \\"World\\"");',
    );
  });

  it("uses .toContain for url-contains and .toHaveURL for url-equals", () => {
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "url-contains",
        assertUrl: "/checkout",
      }),
    ).toBe('expect(page.url()).toContain("/checkout");');

    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "url-equals",
        assertUrl: "https://example.com/done",
      }),
    ).toBe('await expect(page).toHaveURL("https://example.com/done");');
  });

  it("returns null for non-assertion actions and incomplete assertions", () => {
    expect(renderAssertionLineNodejs({ type: "click", selector: "#x" })).toBeNull();
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "element-has-text",
        // no selector
        assertText: "hi",
      }),
    ).toBeNull();
  });

  // Tier-1 power assertions (task 26): verify each new kind emits the
  // expected `@playwright/test` Expect() line and skips silently when the
  // required fields are missing.
  it("emits .toBeVisible() / .toBeHidden() for element-visible / element-hidden", () => {
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "element-visible",
        selector: "#hello",
      }),
    ).toBe('await expect(page.locator("#hello")).toBeVisible();');
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "element-hidden",
        selector: "#bye",
      }),
    ).toBe('await expect(page.locator("#bye")).toBeHidden();');

    // Missing selector → null
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "element-visible",
      }),
    ).toBeNull();
  });

  it("emits .toHaveCount(n) for element-count-equals and rejects non-finite counts", () => {
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "element-count-equals",
        selector: ".row",
        assertCount: 3,
      }),
    ).toBe('await expect(page.locator(".row")).toHaveCount(3);');

    // Missing count → skipped.
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "element-count-equals",
        selector: ".row",
      }),
    ).toBeNull();

    // Missing selector → skipped.
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "element-count-equals",
        assertCount: 1,
      }),
    ).toBeNull();
  });

  it("emits .toHaveAttribute(name, value) for attribute-equals and requires both selector + attribute", () => {
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "attribute-equals",
        selector: "a.docs",
        assertAttribute: "href",
        assertAttrValue: "/docs",
      }),
    ).toBe('await expect(page.locator("a.docs")).toHaveAttribute("href", "/docs");');

    // Missing attribute name → skipped.
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "attribute-equals",
        selector: "a.docs",
        // missing assertAttribute
        assertAttrValue: "/home",
      }),
    ).toBeNull();
  });

  it("emits .toHaveValue(v) for value-equals", () => {
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "value-equals",
        selector: "input[name=email]",
        assertValue: "a@b.c",
      }),
    ).toBe('await expect(page.locator("input[name=email]")).toHaveValue("a@b.c");');

    // Missing selector -> null
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "value-equals",
        // missing selector
        assertValue: "x",
      }),
    ).toBeNull();
  });

  it("emits a goto-then-status check for response-status and rejects non-finite status codes", () => {
    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "response-status",
        assertStatusCode: 200,
      }),
    ).toBe('expect((await page.goto(page.url()))?.status()).toBe(200);');

    expect(
      renderAssertionLineNodejs({
        type: "assert",
        assertKind: "response-status",
        // no assertStatusCode
      }),
    ).toBeNull();
  });
});

describe("nodejsCodegen.tsQuotedArg", () => {
  it("escapes backslashes and double quotes", () => {
    expect(tsQuotedArg('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
