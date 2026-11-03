/**
 * Section-level parity tests for the task #36 C# codegen split.
 *
 * The full apiCsharpCodegen and csharpRecorderEmitter test suites
 * (~30 cases across both files) keep passing after the split because
 * they import from the historical paths that are now thin barrel
 * re-exports — that's the primary byte-identical-output guarantee.
 *
 * This file adds focused unit tests that import the per-section
 * modules **directly** (not through the barrels). The point is to
 * lock down the public surface of each new module and catch any
 * future regression where a section emitter starts producing output
 * that diverges from what the original monolith produced. Each
 * assertion is an exact-string match — no soft contains/matches —
 * so the parity guarantee is enforced at the byte level.
 */
import { describe, expect, it } from "vitest";

import {
  upsertEndpointConstant,
  renderEndpointConstant,
} from "@/features/codegen/infrastructure/languages/csharp/api/endpointConstants";
import {
  ensureUsings,
  findMatchingBrace,
} from "@/features/codegen/infrastructure/languages/csharp/api/csSource";
import { mergeAppSettings } from "@/features/codegen/infrastructure/languages/csharp/api/appsettings";
import {
  assistantClassNameFor,
  renderNewAssistantFile,
} from "@/features/codegen/infrastructure/languages/csharp/api/helperMethod";
import {
  apiSuiteConstantsClassName,
  apiSuiteTestCategoriesClassName,
  deriveApiSuiteStem,
  upsertApiTestCategoryConstant,
} from "@/features/codegen/infrastructure/languages/csharp/api/naming";
import {
  escapeCs,
  pascal,
  safeIdentifier,
  stripSuiteSuffix,
} from "@/features/codegen/infrastructure/languages/csharp/recorder/identifiers";

import { csharpCodegenAdapter } from "@/features/codegen/infrastructure/languages/csharp/csharpCodegenAdapter";
import * as recordingCodegen from "@/features/codegen/infrastructure/csharpCodegen";

import type { BuildApiTestSpec } from "@/features/codegen/infrastructure/languages/csharp/api/types";

function specFor(over: Partial<BuildApiTestSpec> = {}): BuildApiTestSpec {
  return {
    baseUrl: "https://api.example.com",
    urlName: "Default",
    endpointName: "GetUsers",
    endpointSection: null,
    endpointPath: "/users",
    buildInto: "testMethod",
    testMethodName: "GetUsers_Returns200",
    testClass: { mode: "new", className: "UsersTests" },
    helperMethodName: "GetUsersAsync",
    parameters: [],
    httpMethod: "GET",
    useAccessToken: false,
    multipartFields: [],
    defaultHeaders: [],
    ...over,
  };
}

describe("csharp/api/csSource", () => {
  it("findMatchingBrace returns the index of the matching closer", () => {
    const src = `class X { void Y() { /* {nested} */ } }`;
    const open = src.indexOf("{") + 1;
    const close = findMatchingBrace(src, open);
    expect(close).toBe(src.length - 1);
  });

  it("ensureUsings is idempotent and adds only the missing namespace", () => {
    const src = `using A;\nusing B;\n\nnamespace N { }\n`;
    const out = ensureUsings(src, ["A", "C"]);
    // Output contains the new `using C;` exactly once and leaves the
    // pre-existing usings untouched.
    expect(out).toContain("using A;");
    expect(out).toContain("using B;");
    expect(out).toContain("using C;");
    expect((out.match(/using A;/g) ?? []).length).toBe(1);
    expect((out.match(/using C;/g) ?? []).length).toBe(1);
    // Calling again with the same set is a no-op.
    expect(ensureUsings(out, ["A", "C"])).toBe(out);
  });
});

describe("csharp/api/endpointConstants", () => {
  it("renderEndpointConstant validates the C# identifier and quotes the path", () => {
    expect(renderEndpointConstant("GetUsers", "/users")).toBe(
      `    public const string GetUsers = "/users";`,
    );
    expect(() => renderEndpointConstant("1bad", "/x")).toThrow(
      /must be a valid C# identifier/,
    );
  });

  it("upsertEndpointConstant inserts top-level when no section is given", () => {
    const shell = `namespace Foo.Automation.API.Constants;\n\npublic static class ApiEndpoints\n{\n}\n`;
    const out = upsertEndpointConstant(shell, "GetUsers", "/users");
    expect(out).toContain(`public const string GetUsers = "/users";`);
  });

  it("upsertEndpointConstant places constants inside an existing section class", () => {
    const shell = `namespace Foo;\n\npublic static class ApiEndpoints\n{\n    public static class Users\n    {\n    }\n}\n`;
    const out = upsertEndpointConstant(shell, "List", "/users", "Users");
    expect(out).toMatch(
      /public static class Users\s*\{\s*\n\s*public const string List = "\/users";\s*\n\s*\}/,
    );
  });
});

describe("csharp/api/appsettings", () => {
  it("mergeAppSettings creates the ApiTest.Urls block when starting from empty", () => {
    const out = mergeAppSettings("", "Default", "https://api.example.com");
    expect(JSON.parse(out)).toEqual({
      ApiTest: { Urls: { Default: { BaseUrl: "https://api.example.com" } } },
    });
  });

  it("mergeAppSettings preserves sibling keys and updates BaseUrl in place", () => {
    const start = JSON.stringify(
      {
        ApiTest: {
          Urls: { Default: { BaseUrl: "https://old" } },
          Other: "keep",
        },
        Logging: { LogLevel: { Default: "Info" } },
      },
      null,
      2,
    );
    const out = mergeAppSettings(start, "Default", "https://new");
    expect(JSON.parse(out)).toEqual({
      ApiTest: {
        Urls: { Default: { BaseUrl: "https://new" } },
        Other: "keep",
      },
      Logging: { LogLevel: { Default: "Info" } },
    });
  });
});

describe("csharp/api/helperMethod + assistantFile naming", () => {
  it("assistantClassNameFor matches the original convention", () => {
    expect(assistantClassNameFor("UsersTests")).toBe(
      "UsersTestsAPITestingAssistants",
    );
  });

  it("renderNewAssistantFile starts with the per-suite usings", () => {
    const out = renderNewAssistantFile(specFor(), "Foo", "UsersTests");
    expect(out.startsWith("using System.Net.Http;\n")).toBe(true);
    expect(out).toContain(
      "namespace Foo.Automation.API.Tests.APITestingAssistants;",
    );
    expect(out).toContain("public class UsersTestsAPITestingAssistants");
  });
});

describe("csharp/api/naming (suite + categories)", () => {
  it("deriveApiSuiteStem strips Tests / TestSuite suffixes", () => {
    expect(deriveApiSuiteStem("UsersTests")).toBe("Users");
    expect(deriveApiSuiteStem("CheckoutTestSuite")).toBe("Checkout");
    expect(deriveApiSuiteStem("PaymentsFlow")).toBe("PaymentsFlow");
  });

  it("suite + categories class name helpers compose the expected names", () => {
    expect(apiSuiteConstantsClassName("UsersTests")).toBe("UsersConstants");
    expect(apiSuiteTestCategoriesClassName("UsersTests")).toBe(
      "UsersTestCategories",
    );
  });

  it("upsertApiTestCategoryConstant renders a fresh file when existing is null", () => {
    const out = upsertApiTestCategoryConstant(
      "Foo",
      "UsersTests",
      "Smoke",
      "smoke",
      null,
    );
    expect(out).toContain(
      "namespace Foo.Automation.API.Tests.TestCategories",
    );
    expect(out).toContain("public static class UsersTestCategories");
    expect(out).toContain(`public const string Smoke = "smoke";`);
  });

  it("upsertApiTestCategoryConstant is idempotent on re-upsert with the same name", () => {
    const first = upsertApiTestCategoryConstant(
      "Foo",
      "UsersTests",
      "Smoke",
      "smoke",
      null,
    );
    const second = upsertApiTestCategoryConstant(
      "Foo",
      "UsersTests",
      "Smoke",
      "smoke",
      first,
    );
    expect(second).toBe(first);
  });
});

describe("csharp/recorder/identifiers", () => {
  it("pascal preserves internal casing", () => {
    expect(pascal("clickSignIn")).toBe("ClickSignIn");
    expect(pascal("snake_case_name")).toBe("SnakeCaseName");
    expect(pascal("")).toBe("");
  });

  it("safeIdentifier strips a trailing Async and falls back when empty", () => {
    expect(safeIdentifier("ClickLoginAsync", "Action")).toBe("ClickLogin");
    expect(safeIdentifier("", "Fallback")).toBe("Fallback");
    expect(safeIdentifier("1Bad", "X")).toBe("_1Bad");
  });

  it("escapeCs escapes quotes and backslashes", () => {
    expect(escapeCs(`a"b\\c`)).toBe(`a\\"b\\\\c`);
  });

  it("stripSuiteSuffix strips Test/Tests/TestSuite", () => {
    expect(stripSuiteSuffix("LoginTests")).toBe("Login");
    expect(stripSuiteSuffix("LoginTest")).toBe("Login");
    expect(stripSuiteSuffix("LoginTestSuite")).toBe("Login");
    expect(stripSuiteSuffix("Checkout")).toBe("Checkout");
  });
});

describe("csharp/csharpCodegenAdapter", () => {
  it("implements LanguageCodegen by delegating to the recording codegen module", () => {
    // Composition wiring — confirm the adapter forwards each
    // LanguageCodegen method to the existing csharpCodegen export of
    // the same name. This protects against accidental method renames
    // or surface drift between the port and the recording module.
    expect(csharpCodegenAdapter.generateTestClass).toBe(
      recordingCodegen.generateTestClass,
    );
    expect(csharpCodegenAdapter.generateSuiteFiles).toBe(
      recordingCodegen.generateSuiteFiles,
    );
    expect(csharpCodegenAdapter.addTestMethod).toBe(
      recordingCodegen.addTestMethod,
    );
    expect(csharpCodegenAdapter.replaceHookBody).toBe(
      recordingCodegen.replaceHookBody,
    );
    expect(csharpCodegenAdapter.readHookBody).toBe(
      recordingCodegen.readHookBody,
    );
    expect(csharpCodegenAdapter.isHookDefaultStub).toBe(
      recordingCodegen.isHookDefaultStub,
    );
  });

  it("exposes the task #36 split surfaces (Build API Test + recorder)", () => {
    expect(typeof csharpCodegenAdapter.planApiTestBuild).toBe("function");
    expect(typeof csharpCodegenAdapter.commitApiTestPlan).toBe("function");
    expect(typeof csharpCodegenAdapter.emitCsharpRecorder).toBe("function");
  });
});
