import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addTestMethod,
  generateSuiteFiles,
  generateTestClass,
  renderAssertionLineJava,
} from "@/features/codegen/infrastructure/javaCodegen";
import { buildSuiteHeaderLines } from "@/features/codegen/infrastructure/codegenAdapter";
import type { Project } from "@/features/projects/infrastructure/projectService";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

let tmp: string;

function makeJavaProject(rootPath: string): Project {
  return {
    solutionName: "JavaSln",
    testProjectName: "JavaSln-tests",
    namespace: "javasln",
    rootPath,
    slnPath: path.join(rootPath, "pom.xml"),
    language: "java",
  };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "java-codegen-"));
  // Pre-create the directories the codegen writes into (mirrors what
  // scaffoldJavaFromArchitecture does for a real project).
  const testsRoot = path.join(
    tmp,
    "JavaSln-tests",
    "src",
    "test",
    "java",
    "javasln",
  );
  const sharedRoot = path.join(
    tmp,
    "JavaSln-shared",
    "src",
    "main",
    "java",
    "javasln",
  );
  await fs.mkdir(path.join(testsRoot, "tests"), { recursive: true });
  await fs.mkdir(path.join(testsRoot, "pages", "selectors"), {
    recursive: true,
  });
  await fs.mkdir(path.join(testsRoot, "pages", "actions"), {
    recursive: true,
  });
  await fs.mkdir(path.join(sharedRoot, "pages", "interfaces"), {
    recursive: true,
  });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("javaCodegen.generateSuiteFiles", () => {
  it("emits selectors + actions in tests module and an interface in shared module", async () => {
    const project = makeJavaProject(tmp);
    const actions: RecordedAction[] = [
      {
        type: "fill",
        selector: "#username",
        selectorStrategy: "id",
        value: "alice",
      },
      {
        type: "click",
        selector: "#submit",
        selectorStrategy: "id",
      },
    ];

    const result = await generateSuiteFiles(project, "Login", actions);

    expect(result.selectorsPath).toBe(
      "JavaSln-tests/src/test/java/javasln/pages/selectors/LoginSelectors.java",
    );
    expect(result.actionsPath).toBe(
      "JavaSln-tests/src/test/java/javasln/pages/actions/LoginActions.java",
    );
    // The interface lives in the shared module so other modules can
    // depend on it without pulling in the test runtime.
    expect(result.interfacePath).toBe(
      "JavaSln-shared/src/main/java/javasln/pages/interfaces/ILoginActions.java",
    );

    const interfaceContent = await fs.readFile(
      path.join(tmp, result.interfacePath),
      "utf8",
    );
    expect(interfaceContent).toContain("package javasln.pages.interfaces;");
    expect(interfaceContent).toContain("public interface ILoginActions");
    // Both recorded actions should appear as interface signatures.
    expect(interfaceContent).toMatch(/void fill\w*\(String value\);/);
    expect(interfaceContent).toMatch(/void click\w*\(\);/);

    const actionsContent = await fs.readFile(
      path.join(tmp, result.actionsPath),
      "utf8",
    );
    // The Actions class implements the interface and imports it from
    // the shared module's `pages.interfaces` package.
    expect(actionsContent).toContain(
      "import javasln.pages.interfaces.ILoginActions;",
    );
    expect(actionsContent).toContain(
      "public class LoginActions implements ILoginActions",
    );
    // Each implementing method should be marked @Override.
    expect(actionsContent).toMatch(/@Override\s+public void fill/);
    expect(actionsContent).toMatch(/@Override\s+public void click/);
  });
});

describe("buildSuiteHeaderLines (java)", () => {
  it("instantiates via the page-object interface and reads the start URL via AppConfiguration", () => {
    const project = makeJavaProject(tmp);
    const { header, actionsVar } = buildSuiteHeaderLines(
      project,
      "Login",
      "LoginUrl",
    );
    expect(actionsVar).toBe("actions");
    // Variable is typed as the interface, mirroring the C# `IXyzActions`
    // shape so swapping page-object implementations stays a one-line change.
    expect(header[0]).toBe(
      "ILoginActions actions = new LoginActions(page);",
    );
    // The URL must come from the scaffolded AppConfiguration helper —
    // raw System.getenv would bypass dotenv-driven config.
    expect(header[1]).toBe(
      "page.navigate(TestConfig.LOGINURL);",
    );
  });
});

describe("javaCodegen.addTestMethod (imports)", () => {
  it("imports AppConfiguration + the page-object interface when the body uses them", async () => {
    const project = makeJavaProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await addTestMethod(
      project,
      rel,
      "HappyPath",
      [
        "ILoginActions actions = new LoginActions(page);",
        "page.navigate(TestConfig.LOGIN);",
        "actions.clickSubmit();",
      ],
      ["LoginActions"],
    );

    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain("import javasln.TestConfig;");
    expect(text).toContain("import javasln.pages.actions.LoginActions;");
    expect(text).toContain(
      "import javasln.pages.interfaces.ILoginActions;",
    );
  });
});

describe("javaCodegen.renderAssertionLineJava", () => {
  it("emits Assertions.assertEquals(textContent) for element-has-text", () => {
    expect(
      renderAssertionLineJava({
        type: "assert",
        assertKind: "element-has-text",
        selector: "#title",
        assertText: "Hello",
      }),
    ).toBe(
      'Assertions.assertEquals("Hello", page.locator("#title").textContent());',
    );
  });

  it("emits substring contains() for url-contains and assertEquals for url-equals", () => {
    expect(
      renderAssertionLineJava({
        type: "assert",
        assertKind: "url-contains",
        assertUrl: "/checkout",
      }),
    ).toBe('Assertions.assertTrue(page.url().contains("/checkout"));');
    expect(
      renderAssertionLineJava({
        type: "assert",
        assertKind: "url-equals",
        assertUrl: "https://example.com/done",
      }),
    ).toBe('Assertions.assertEquals("https://example.com/done", page.url());');
  });

  describe("Tier-1 power assertions", () => {
    // Verify each new kind emits the expected JUnit + Playwright Java
    // line. Each kind is also probed with a missing-required-field
    // input to confirm the helper returns `null` (callers skip
    // silently instead of emitting malformed Java).

    it("emits .isVisible() for element-visible", () => {
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "element-visible",
          selector: "#cta",
        }),
      ).toBe(
        'Assertions.assertTrue(page.locator("#cta").first().isVisible());',
      );
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "element-visible",
          selector: "#hello",
        }),
      ).toBe(
        'Assertions.assertTrue(page.locator("#hello").first().isVisible());',
      );
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "element-visible",
        }),
      ).toBeNull();
    });

    it("emits .isHidden() for element-hidden", () => {
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "element-hidden",
          selector: "#spinner",
        }),
      ).toBe(
        'Assertions.assertTrue(page.locator("#spinner").first().isHidden());',
      );
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "element-hidden",
          selector: "#bye",
        }),
      ).toBe(
        'Assertions.assertTrue(page.locator("#bye").first().isHidden());',
      );
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "element-hidden",
        }),
      ).toBeNull();
    });

    it("emits assertEquals(count, locator.count()) for element-count-equals", () => {
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "element-count-equals",
          selector: ".row",
          assertCount: 3,
        }),
      ).toBe('Assertions.assertEquals(3, page.locator(".row").count());');
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "element-count-equals",
          selector: ".row",
        }),
      ).toBeNull();
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "element-count-equals",
          assertCount: 1,
        }),
      ).toBeNull();
    });

    it("emits assertEquals(value, locator.first().getAttribute(attr)) for attribute-equals", () => {
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "attribute-equals",
          selector: "#link",
          assertAttribute: "href",
          assertAttrValue: "/home",
        }),
      ).toBe(
        'Assertions.assertEquals("/home", page.locator("#link").first().getAttribute("href"));',
      );
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "attribute-equals",
          selector: "a.docs",
          assertAttribute: "href",
          assertAttrValue: "/docs",
        }),
      ).toBe(
        'Assertions.assertEquals("/docs", page.locator("a.docs").first().getAttribute("href"));',
      );
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "attribute-equals",
          selector: "#link",
          assertAttrValue: "/home",
        }),
      ).toBeNull();
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "attribute-equals",
          selector: "a.docs",
        }),
      ).toBeNull();
    });

    it("emits assertEquals(value, locator.first().inputValue()) for value-equals", () => {
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "value-equals",
          selector: "#email",
          assertValue: "user@example.com",
        }),
      ).toBe(
        'Assertions.assertEquals("user@example.com", page.locator("#email").first().inputValue());',
      );
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "value-equals",
          selector: "input[name=email]",
          assertValue: "a@b.c",
        }),
      ).toBe(
        'Assertions.assertEquals("a@b.c", page.locator("input[name=email]").first().inputValue());',
      );
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "value-equals",
          assertValue: "x",
        }),
      ).toBeNull();
    });

    it("emits assertEquals(code, page.navigate(...).status()) for response-status", () => {
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "response-status",
          assertStatusCode: 200,
        }),
      ).toBe(
        "Assertions.assertEquals(200, page.navigate(page.url()).status());",
      );
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "response-status",
          assertStatusCode: 201,
        }),
      ).toBe(
        "Assertions.assertEquals(201, page.navigate(page.url()).status());",
      );
      expect(
        renderAssertionLineJava({
          type: "assert",
          assertKind: "response-status",
        }),
      ).toBeNull();
    });
  });

  it("returns null for non-assertion actions", () => {
    expect(
      renderAssertionLineJava({
        type: "click",
        selector: "#x",
      } as RecordedAction),
    ).toBeNull();
  });
});

describe("javaCodegen — per-suite Constants (Java)", () => {
  it("writes <Suite>Constants.java under tests/<pkg>/constants/ and reads it back", async () => {
    const { writeRecordedConstants, readRecordedConstants } = await import(
      "@/features/codegen/infrastructure/javaCodegen"
    );
    const project = makeJavaProject(tmp);
    const map = new Map<string, string>([
      ["userName", "alice"],
      ["password", "p@ss"],
    ]);

    const rel = await writeRecordedConstants(project, map, "Login");
    expect(rel).toBe(
      "JavaSln-tests/src/test/java/javasln/constants/LoginConstants.java",
    );
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain("package javasln.constants;");
    expect(text).toContain("public final class LoginConstants {");
    expect(text).toContain('public static final String userName = "alice";');
    expect(text).toContain('public static final String password = "p@ss";');

    const round = await readRecordedConstants(project, "Login");
    expect(Object.fromEntries(round)).toEqual({
      userName: "alice",
      password: "p@ss",
    });
  });

  it("writeRecordedConstants throws when suiteName is omitted", async () => {
    const { writeRecordedConstants } = await import(
      "@/features/codegen/infrastructure/javaCodegen"
    );
    const project = makeJavaProject(tmp);
    await expect(
      writeRecordedConstants(project, new Map([["x", "y"]])),
    ).rejects.toThrow(/requires a suiteName/);
  });

  it("strips Tests/TestSuite suffix from suiteName when computing class names", async () => {
    const { suiteConstantsClassName, suiteTestCategoriesClassName } =
      await import("@/features/codegen/infrastructure/javaCodegen");
    expect(suiteConstantsClassName("Login")).toBe("LoginConstants");
    expect(suiteConstantsClassName("LoginTests")).toBe("LoginConstants");
    expect(suiteConstantsClassName("LoginTestSuite")).toBe("LoginConstants");
    expect(suiteTestCategoriesClassName("UsersTests")).toBe(
      "UsersTestCategories",
    );
  });
});

describe("javaCodegen.addTestMethod — Ignore + TestCategories", () => {
  it("emits @Disabled and @Tag annotations and upserts <Suite>TestCategories.java", async () => {
    const project = makeJavaProject(tmp);
    const rel = await generateTestClass(project, "Login");

    await addTestMethod(
      project,
      rel,
      "happyPath",
      ["actions.clickSubmit();"],
      ["LoginActions"],
      {
        suiteName: "Login",
        metadata: {
          ignoreReason: "flaky on CI",
          categoryConstantName: "SMOKE",
          categoryValue: "smoke-tests",
        },
      },
    );

    const testText = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(testText).toContain("import org.junit.jupiter.api.Disabled;");
    expect(testText).toContain("import org.junit.jupiter.api.Tag;");
    expect(testText).toContain(
      "import javasln.testcategories.LoginTestCategories;",
    );
    // Annotations precede @Test, in stable order: @Disabled, @Tag, @Test.
    expect(testText).toMatch(
      /@Disabled\("flaky on CI"\)\s+@Tag\(LoginTestCategories\.SMOKE\)\s+@Test\s+void happyPath\(\)/,
    );

    const catRel =
      "JavaSln-tests/src/test/java/javasln/testcategories/LoginTestCategories.java";
    const cat = await fs.readFile(path.join(tmp, catRel), "utf8");
    expect(cat).toContain("package javasln.testcategories;");
    expect(cat).toContain("public final class LoginTestCategories {");
    expect(cat).toContain(
      'public static final String SMOKE = "smoke-tests";',
    );
  });

  it("upsertTestCategoryConstantJava is idempotent and updates value in place", async () => {
    const { upsertTestCategoryConstantJava } = await import(
      "@/features/codegen/infrastructure/javaCodegen"
    );
    const project = makeJavaProject(tmp);
    const rel = await upsertTestCategoryConstantJava(
      project,
      "Login",
      "SMOKE",
      "smoke",
    );
    await upsertTestCategoryConstantJava(project, "Login", "REGRESSION", "reg");
    await upsertTestCategoryConstantJava(
      project,
      "Login",
      "SMOKE",
      "smoke-v2",
    );
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain('public static final String SMOKE = "smoke-v2";');
    expect(text).toContain(
      'public static final String REGRESSION = "reg";',
    );
    // Single declaration of SMOKE survives — no duplicates.
    const matches = text.match(/SMOKE\s*=/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("emits no annotations when metadata fields are absent", async () => {
    const project = makeJavaProject(tmp);
    const rel = await generateTestClass(project, "Login");
    await addTestMethod(
      project,
      rel,
      "happyPath",
      ["actions.clickSubmit();"],
      ["LoginActions"],
      { suiteName: "Login" },
    );
    const testText = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(testText).not.toContain("@Disabled");
    expect(testText).not.toContain("@Tag(");
    expect(testText).not.toContain("import org.junit.jupiter.api.Disabled");
    expect(testText).not.toContain("import org.junit.jupiter.api.Tag;");
  });
});
