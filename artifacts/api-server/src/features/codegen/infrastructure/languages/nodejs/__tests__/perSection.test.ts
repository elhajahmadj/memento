import { describe, it, expect } from "vitest";
import {
  escapeTs,
  hookMethodNameNodejs,
  suiteKebab,
  toCamel,
  toPascal,
  tsQuotedArg,
} from "../naming";
import {
  actionsFileRelPath,
  selectorsFileRelPath,
  suiteCategoriesRelPath,
  suiteConstantsRelPath,
  testFileRelPath,
} from "../paths";
import { requiredSpecImports } from "../specImports";
import {
  nodejsMethodNameFromNoun,
  nodejsVerbForActionType,
  normalizeNounForNodejs,
  nounFromSelectorKeyNodejs,
} from "../nouns";
import { findHookSpan } from "../hooks";
import {
  renderApiAssertionLineNodejs,
  renderAssertionLineNodejs,
  renderRouteMockLineNodejs,
  renderWaitLineNodejs,
} from "../renderLines";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

describe("nodejs/naming", () => {
  it("toCamel handles separators and PascalCase", () => {
    expect(toCamel("user_name")).toBe("userName");
    expect(toCamel("UserName")).toBe("userName");
    expect(toCamel("login-button")).toBe("loginButton");
    expect(toCamel("123abc")).toBe("x123abc");
  });

  it("toPascal handles snake/kebab/empty inputs", () => {
    expect(toPascal("login_button")).toBe("LoginButton");
    expect(toPascal("")).toBe("X");
  });

  it("hookMethodNameNodejs maps to playwright names", () => {
    expect(hookMethodNameNodejs("beforeEach")).toBe("beforeEach");
    expect(hookMethodNameNodejs("oneTimeSetup")).toBe("beforeAll");
  });

  it("escapeTs and tsQuotedArg escape backslashes and quotes", () => {
    expect(escapeTs(`a"b\\c`)).toBe(`a\\"b\\\\c`);
    expect(tsQuotedArg(`a"b`)).toBe(`"a\\"b"`);
  });

  it("suiteKebab kebab-cases mixed input", () => {
    expect(suiteKebab("LoginFlow")).toBe("login-flow");
    expect(suiteKebab("MyHTTPCall")).toBe("my-http-call");
  });
});

describe("nodejs/paths", () => {
  it("emits the canonical paths", () => {
    expect(testFileRelPath("Login")).toBe("tests/Login.spec.ts");
    expect(selectorsFileRelPath("Login")).toBe("pages/selectors/LoginSelectors.ts");
    expect(actionsFileRelPath("Login")).toBe("pages/actions/LoginActions.ts");
    expect(suiteConstantsRelPath("LoginFlow")).toBe(
      "constants/login-flow.constants.ts",
    );
    expect(suiteCategoriesRelPath("LoginFlow")).toBe(
      "test-categories/login-flow.categories.ts",
    );
  });
});

describe("nodejs/specImports", () => {
  it("orders actions imports first, then constants, then config, then categories", () => {
    const lines = requiredSpecImports(
      ["LoginActions"],
      [
        "await actions.fillUserName(LoginConstants.userName);",
        "await page.goto(TestConfig.HOME);",
      ],
      "Login",
      true,
    );
    expect(lines).toEqual([
      `import { LoginActions } from "../pages/actions/LoginActions";`,
      `import { LoginConstants } from "../constants/login.constants";`,
      `import { TestConfig } from "../shared/testConfig";`,
      `import { LoginCategories } from "../test-categories/login.categories";`,
    ]);
  });

  it("falls back to shared/constants when no suite name is given", () => {
    const lines = requiredSpecImports(
      [],
      ["expect(Constants.foo).toBe(1);"],
    );
    expect(lines).toEqual([
      `import { Constants } from "../shared/constants";`,
    ]);
  });
});

describe("nodejs/nouns", () => {
  it("normalizes and decorates nouns symmetrically", () => {
    expect(normalizeNounForNodejs("LoginButton")).toBe("loginButton");
    expect(normalizeNounForNodejs("clickLoginButton")).toBe("loginButton");
    expect(normalizeNounForNodejs("click")).toBe("click");
    expect(nodejsMethodNameFromNoun("fill", "userName")).toBe("fillUserName");
    expect(nodejsMethodNameFromNoun("click", "")).toBe("click");
    expect(nodejsVerbForActionType("select")).toBe("select");
    expect(nounFromSelectorKeyNodejs("loginButtonSelector")).toBe(
      "loginButton",
    );
    expect(nounFromSelectorKeyNodejs("legacyKey")).toBe("legacyKey");
  });
});

describe("nodejs/hooks", () => {
  it("findHookSpan locates the matching `});` for the named hook", () => {
    const text = [
      `import { test } from "../shared/fixtures";`,
      `test.describe("X", () => {`,
      `  test.beforeAll(async () => {`,
      `    // body`,
      `  });`,
      ``,
      `  test.beforeEach(async ({ page }) => {`,
      `    await page.goto("/");`,
      `  });`,
      `});`,
      ``,
    ].join("\n");
    const beforeAll = findHookSpan(text, "oneTimeSetup");
    expect(beforeAll).not.toBeNull();
    expect(beforeAll!.defIndent).toBe("  ");
    const beforeEach = findHookSpan(text, "beforeEach");
    expect(beforeEach).not.toBeNull();
    expect(beforeEach!.endLine).toBeGreaterThan(beforeEach!.defLine);
  });
});

describe("nodejs/renderLines", () => {
  it("renders wait, route mock, assertion, and apiAssertion lines", () => {
    const wait: RecordedAction = {
      id: "w",
      type: "wait",
      waitKind: "selector",
      waitSelector: "#x",
    } as unknown as RecordedAction;
    expect(renderWaitLineNodejs(wait)).toBe(
      `await page.locator("#x").waitFor();`,
    );
    const mock: RecordedAction = {
      id: "m",
      type: "routeMock",
      apiUrl: "**/api/x",
      mockStatus: 201,
      mockBody: `{"ok":true}`,
    } as unknown as RecordedAction;
    expect(renderRouteMockLineNodejs(mock)).toContain(
      `await page.route("**/api/x"`,
    );
    const visible: RecordedAction = {
      id: "a",
      type: "assert",
      assertKind: "element-visible",
      selector: "#btn",
    } as unknown as RecordedAction;
    expect(renderAssertionLineNodejs(visible)).toBe(
      `await expect(page.locator("#btn")).toBeVisible();`,
    );
    const api: RecordedAction = {
      id: "p",
      type: "apiAssertion",
      apiUrl: "/api/v",
      apiMethod: "GET",
      apiExpectedStatus: 200,
    } as unknown as RecordedAction;
    const out = renderApiAssertionLineNodejs(api);
    expect(out).toContain(`page.request.get("/api/v")`);
    expect(out).toContain(`expect(apiResp.status()).toBe(200);`);
  });
});
