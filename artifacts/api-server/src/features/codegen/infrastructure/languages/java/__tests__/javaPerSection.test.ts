import { describe, expect, it } from "vitest";

import {
  hookMethodNameJava,
  javaQuotedArg,
  toCamel,
} from "../naming";
import {
  suiteConstantsClassName,
  suiteConstantsRelPath,
  suiteTestCategoriesClassName,
  suiteTestCategoriesRelPath,
} from "../paths";
import {
  renderApiAssertionLineJava,
  renderAssertionLineJava,
  renderRouteMockLineJava,
  renderWaitLineJava,
} from "../lineRendering";
import {
  apiSuiteBareName,
  apiSuiteTestCategoriesClassName,
  assistantClassNameForJava,
  ensureImports,
  findMatchingBrace,
  quoteJavaString,
} from "../apiShared";
import {
  renderEndpointConstant,
  upsertEndpointConstantJava,
} from "../apiEndpoints";

const project = {
  rootPath: "/tmp/proj",
  namespace: "Demo",
  solutionName: "Demo",
} as unknown as Parameters<typeof suiteConstantsRelPath>[0];

describe("languages/java/naming", () => {
  it("camelCases identifier-safe input", () => {
    expect(toCamel("Login With Email")).toBe("loginWithEmail");
    expect(toCamel("login-with-email")).toBe("loginWithEmail");
    expect(toCamel("")).toBe("x");
  });

  it("derives hook method names", () => {
    expect(hookMethodNameJava("beforeEach")).toBe("beforeEach");
    expect(hookMethodNameJava("oneTimeSetup")).toBe("beforeAll");
  });

  it("quotes Java string arguments", () => {
    expect(javaQuotedArg("hello")).toBe('"hello"');
    expect(javaQuotedArg('a"b')).toBe('"a\\"b"');
    expect(javaQuotedArg("a\\b")).toBe('"a\\\\b"');
  });
});

describe("languages/java/paths", () => {
  it("computes suite constants paths", () => {
    expect(suiteConstantsClassName("Login")).toBe("LoginConstants");
    expect(suiteTestCategoriesClassName("Login")).toBe("LoginTestCategories");
    expect(suiteConstantsRelPath(project, "Login")).toContain(
      "constants/LoginConstants.java",
    );
    expect(suiteTestCategoriesRelPath(project, "Login")).toContain(
      "testcategories/LoginTestCategories.java",
    );
  });
});

describe("languages/java/lineRendering", () => {
  it("renders wait lines", () => {
    const line = renderWaitLineJava({
      type: "wait",
      waitKind: "timeout",
      waitMs: 1500,
    } as never);
    expect(line).toContain("1500");
    expect(renderWaitLineJava({ type: "click" } as never)).toBeNull();
  });

  it("renders assertion lines", () => {
    const line = renderAssertionLineJava({
      type: "assert",
      assertKind: "element-visible",
      selector: "#btn",
    } as never);
    expect(line).toContain("isVisible");
    expect(line).toContain("#btn");
  });

  it("renders route mock + api assertion lines", () => {
    expect(
      renderRouteMockLineJava({
        type: "routeMock",
        apiUrl: "/api/x",
        mockStatus: 200,
        mockBody: "{}",
      } as never),
    ).toContain("/api/x");
    expect(
      renderApiAssertionLineJava({
        type: "apiAssertion",
        apiUrl: "/api/x",
        apiMethod: "GET",
        apiExpectedStatus: 200,
      } as never),
    ).toContain("200");
  });
});

describe("languages/java/apiShared", () => {
  it("derives suite naming helpers", () => {
    expect(apiSuiteBareName("UsersTests")).toBe("Users");
    expect(apiSuiteBareName("UsersTestSuite")).toBe("Users");
    expect(apiSuiteBareName("Standalone")).toBe("Standalone");
    expect(apiSuiteTestCategoriesClassName("UsersTests")).toBe(
      "UsersTestCategories",
    );
    expect(assistantClassNameForJava("UsersTests")).toBe(
      "UsersTestsAPITestingAssistants",
    );
  });

  it("quotes Java strings safely", () => {
    expect(quoteJavaString('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"');
  });

  it("finds matching braces with nesting", () => {
    const src = "x{a{b}c}y";
    expect(findMatchingBrace(src, 2)).toBe(7);
  });

  it("inserts missing imports after package", () => {
    const src = "package x;\n\npublic class Y {}\n";
    const next = ensureImports(src, ["java.util.List"]);
    expect(next).toContain("import java.util.List;");
    expect(next.indexOf("import")).toBeGreaterThan(next.indexOf("package"));
  });
});

describe("languages/java/apiEndpoints", () => {
  it("renders endpoint constant declarations", () => {
    expect(renderEndpointConstant("GetUsers", "/users")).toBe(
      '    public static final String GetUsers = "/users";',
    );
  });

  it("inserts and replaces top-level constants idempotently", () => {
    const base = "public final class ApiEndpoints {\n}\n";
    const once = upsertEndpointConstantJava(base, "GetUsers", "/users");
    expect(once).toContain('GetUsers = "/users"');
    const twice = upsertEndpointConstantJava(once, "GetUsers", "/people");
    expect(twice).toContain('GetUsers = "/people"');
    expect(twice).not.toContain('"/users"');
  });

  it("nests constants under a section class", () => {
    const base = "public final class ApiEndpoints {\n}\n";
    const out = upsertEndpointConstantJava(base, "Get", "/x", "Users");
    expect(out).toContain("public static final class Users");
    expect(out).toContain('Get = "/x"');
  });

  it("rejects invalid Java identifiers", () => {
    expect(() =>
      renderEndpointConstant("1invalid", "/x"),
    ).toThrow(/Endpoint name/);
  });
});
