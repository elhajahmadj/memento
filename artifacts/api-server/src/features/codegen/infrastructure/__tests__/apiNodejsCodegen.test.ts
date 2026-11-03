import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { scaffoldApiNodejs } from "@/features/projects/infrastructure/apiNodejsScaffolder";
import {
  upsertEndpointConstant,
  upsertHelperMethod,
  renderNewAssistantFile,
  renderNewTestClass,
  insertItIntoExistingClass,
  planApiTestBuild,
  kebabCase,
  testFileNameFor,
  assistantFileNameFor,
} from "@/features/codegen/infrastructure/apiNodejsCodegen";
import {
  commitApiTestPlan,
  type BuildApiTestSpec,
} from "@/features/codegen/infrastructure/apiCsharpCodegen";

function spec(over: Partial<BuildApiTestSpec> = {}): BuildApiTestSpec {
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

const SHELL_ENDPOINTS = `export const ApiEndpoints = {
} as const;
`;

const SHELL_ASSISTANT = `import { ApiEndpoints } from "../../src/automation-api/constants/api-endpoints";
import { ApiTestFixture } from "../../src/automation-api/infrastructure/api-test-fixture";

export class UsersTestsApiTestingAssistants {
  constructor(private readonly fixture: ApiTestFixture) {}
}
`;

let tmp: string;
let originalWorkspace: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "api-nodejs-codegen-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("kebabCase / file naming", () => {
  it("converts PascalCase / camelCase to kebab-case", () => {
    expect(kebabCase("UsersTests")).toBe("users-tests");
    expect(kebabCase("HTTPRequestPath")).toBe("http-request-path");
    expect(kebabCase("getUsersAsync")).toBe("get-users-async");
  });

  it("derives test/assistant filenames from class name", () => {
    expect(testFileNameFor("UsersTests")).toBe("users-tests.spec.ts");
    expect(assistantFileNameFor("UsersTests")).toBe(
      "users-tests-api-testing-assistants.ts",
    );
  });
});

describe("upsertEndpointConstant", () => {
  it("appends a new constant in the outer object", () => {
    const out = upsertEndpointConstant(SHELL_ENDPOINTS, "GetUsers", "/users");
    expect(out).toContain('GetUsers: "/users",');
  });

  it("replaces an existing constant of the same name (idempotent)", () => {
    const once = upsertEndpointConstant(SHELL_ENDPOINTS, "GetUsers", "/users");
    const twice = upsertEndpointConstant(once, "GetUsers", "/v2/users");
    const matches = twice.match(/GetUsers:/g) ?? [];
    expect(matches.length).toBe(1);
    expect(twice).toContain('"/v2/users"');
  });

  it("creates a nested section object on demand and reuses it", () => {
    const once = upsertEndpointConstant(
      SHELL_ENDPOINTS,
      "GetById",
      "/users/{0}",
      "Users",
    );
    expect(once).toContain("Users: {");
    expect(once).toContain('GetById: "/users/{0}",');
    const twice = upsertEndpointConstant(once, "Delete", "/users/{0}", "Users");
    // Only one Users: block.
    expect((twice.match(/Users:\s*\{/g) ?? []).length).toBe(1);
    expect(twice).toContain('Delete: "/users/{0}",');
  });

  it("rejects non-identifier endpoint names", () => {
    expect(() =>
      upsertEndpointConstant(SHELL_ENDPOINTS, "1bad", "/x"),
    ).toThrow();
  });

  it("handles braces inside path strings without confusion", () => {
    // Path contains `{` which would over-increment a naive brace counter.
    const out = upsertEndpointConstant(SHELL_ENDPOINTS, "GetById", "/x/{0}");
    expect(out).toContain('GetById: "/x/{0}",');
    // Append another after — should not throw on unbalanced braces.
    const out2 = upsertEndpointConstant(out, "DeleteById", "/x/{0}");
    expect(out2).toContain('DeleteById: "/x/{0}",');
  });
});

describe("upsertHelperMethod", () => {
  it("appends a new helper method using fetch + fixture.send", () => {
    const out = upsertHelperMethod(SHELL_ASSISTANT, spec(), "UsersTestsApiTestingAssistants");
    expect(out).toContain("async GetUsersAsync()");
    expect(out).toContain('method: "GET"');
    expect(out).toContain("this.fixture.send(");
  });

  it("replaces an existing helper method of the same name", () => {
    const once = upsertHelperMethod(SHELL_ASSISTANT, spec(), "UsersTestsApiTestingAssistants");
    const twice = upsertHelperMethod(
      once,
      spec({ httpMethod: "POST" }),
      "UsersTestsApiTestingAssistants",
    );
    const matches = twice.match(/async GetUsersAsync\(/g) ?? [];
    expect(matches.length).toBe(1);
    expect(twice).toContain('method: "POST"');
  });

  it("emits formatPath when parameters are present and adds the import", () => {
    const out = upsertHelperMethod(
      SHELL_ASSISTANT,
      spec({
        endpointPath: "/users/{0}",
        parameters: [{ name: "id", type: "int" }],
      }),
      "UsersTestsApiTestingAssistants",
    );
    expect(out).toContain("formatPath(ApiEndpoints.GetUsers, id)");
    expect(out).toContain("id: number");
    expect(out).toMatch(/import \{[^}]*formatPath[^}]*\} from/);
  });

  it("emits a Bearer header and getAccessToken import when useAccessToken=true", () => {
    const out = upsertHelperMethod(
      SHELL_ASSISTANT,
      spec({ useAccessToken: true }),
      "UsersTestsApiTestingAssistants",
    );
    expect(out).toContain('"Authorization":');
    expect(out).toContain("getAccessToken(this.fixture.settings,");
    expect(out).toContain(
      'from "../../src/automation-api/extensions/configuration-extensions"',
    );
  });

  it("emits FormData appends when multipartFields are present", () => {
    const out = upsertHelperMethod(
      SHELL_ASSISTANT,
      spec({
        httpMethod: "POST",
        multipartFields: [{ name: "file", valueExpression: "filePath" }],
      }),
      "UsersTestsApiTestingAssistants",
    );
    expect(out).toContain("new FormData()");
    expect(out).toContain('form.append("file", String(filePath));');
    expect(out).toContain("body: form,");
  });
});

describe("renderNewAssistantFile / renderNewTestClass", () => {
  it("renders a self-contained assistant file", () => {
    const out = renderNewAssistantFile(spec(), "UsersTests");
    expect(out).toContain("export class UsersTestsApiTestingAssistants");
    expect(out).toContain('from "../../src/automation-api/constants/api-endpoints"');
    expect(out).toContain("async GetUsersAsync()");
  });

  it("renders a test file with describe/it/expect for buildInto=testMethod", () => {
    const out = renderNewTestClass(spec(), "UsersTests");
    expect(out).toContain('describe("UsersTests"');
    expect(out).toContain('it("GetUsers_Returns200"');
    expect(out).toContain("expect(response.status).toBe(200)");
    expect(out).toContain(
      'from "../api-testing-assistants/users-tests-api-testing-assistants"',
    );
  });

  it("uses beforeAll for buildInto=oneTimeSetup", () => {
    const out = renderNewTestClass(
      spec({ buildInto: "oneTimeSetup" }),
      "UsersTests",
    );
    expect(out).toContain("beforeAll(async () =>");
    expect(out).toContain("response = await");
  });
});

describe("insertItIntoExistingClass", () => {
  it("appends a new it() block and re-uses the assistant variable", () => {
    const initial = renderNewTestClass(spec(), "UsersTests");
    const withSecond = insertItIntoExistingClass(
      initial,
      spec({
        helperMethodName: "GetUserAsync",
        testMethodName: "GetUser_Returns200",
        endpointPath: "/users/{0}",
        parameters: [{ name: "id", type: "int" }],
      }),
      "UsersTests",
    );
    expect(
      (withSecond.match(/it\("GetUser_Returns200"/g) ?? []).length,
    ).toBe(1);
    expect(withSecond).toContain("usersTestsApiTestingAssistants.GetUserAsync(0)");
  });

  it("rejects duplicate test method names", () => {
    const initial = renderNewTestClass(spec(), "UsersTests");
    expect(() =>
      insertItIntoExistingClass(initial, spec(), "UsersTests"),
    ).toThrow(/already exists/);
  });

  it("rejects a duplicate even when the existing test was emitted as it.skip", () => {
    const initial = renderNewTestClass(
      spec({
        metadata: {
          ignoreReason: "Flaky on CI",
          categoryConstantName: null,
          categoryValue: null,
        },
      }),
      "UsersTests",
    );
    expect(initial).toContain('it.skip("GetUsers_Returns200"');
    expect(() =>
      insertItIntoExistingClass(initial, spec(), "UsersTests"),
    ).toThrow(/already exists/);
  });

  it("emits it.skip + // Ignored: comment when metadata.ignoreReason is set", () => {
    const out = renderNewTestClass(
      spec({
        metadata: {
          ignoreReason: "Flaky on CI",
          categoryConstantName: null,
          categoryValue: null,
        },
      }),
      "UsersTests",
    );
    expect(out).toContain("  // Ignored: Flaky on CI");
    expect(out).toContain('it.skip("GetUsers_Returns200"');
  });

  it("emits the per-suite Categories import + meta option when metadata.categoryConstantName is set", () => {
    const out = renderNewTestClass(
      spec({
        metadata: {
          ignoreReason: null,
          categoryConstantName: "Smoke",
          categoryValue: "smoke-tests",
        },
      }),
      "UsersTests",
    );
    expect(out).toContain(
      'import { UsersTestsCategories } from "../test-categories/users-tests.categories";',
    );
    expect(out).toContain(
      'it("GetUsers_Returns200", { meta: { category: UsersTestsCategories.Smoke } }, async ()',
    );
  });

  it("inserts the categories import into an existing class when appending an it() with a category", () => {
    const initial = renderNewTestClass(spec(), "UsersTests");
    const updated = insertItIntoExistingClass(
      initial,
      spec({
        helperMethodName: "GetUserAsync",
        testMethodName: "GetUser_Returns200",
        endpointPath: "/users/{0}",
        parameters: [{ name: "id", type: "int" }],
        metadata: {
          ignoreReason: null,
          categoryConstantName: "Smoke",
          categoryValue: "smoke-tests",
        },
      }),
      "UsersTests",
    );
    expect(updated).toContain(
      'import { UsersTestsCategories } from "../test-categories/users-tests.categories";',
    );
    expect(updated).toContain(
      'it("GetUser_Returns200", { meta: { category: UsersTestsCategories.Smoke } }, async ()',
    );
  });
});

describe("planApiTestBuild", () => {
  it("plans the four files for a fresh suite", async () => {
    const result = await scaffoldApiNodejs("Sample", "Sample");
    const plan = await planApiTestBuild(
      { rootPath: result.rootPath, solutionName: "Sample", namespace: "Sample" },
      spec(),
    );
    const rels = plan.files.map((f) => f.relPath).sort();
    expect(rels).toEqual([
      "src/automation-api/constants/api-endpoints.ts",
      "tests/api-testing-assistants/users-tests-api-testing-assistants.ts",
      "tests/appsettings.json",
      "tests/tests/users-tests.spec.ts",
    ]);
    const created = plan.files.filter((f) => f.created).map((f) => f.relPath);
    expect(created).toContain(
      "tests/tests/users-tests.spec.ts",
    );
    expect(created).toContain(
      "tests/api-testing-assistants/users-tests-api-testing-assistants.ts",
    );
    expect(created).not.toContain(
      "src/automation-api/constants/api-endpoints.ts",
    );
    expect(created).not.toContain("tests/appsettings.json");
  });

  it("merges baseUrl into appsettings.json under ApiTest.Urls", async () => {
    const result = await scaffoldApiNodejs("Sample", "Sample");
    const plan = await planApiTestBuild(
      { rootPath: result.rootPath, solutionName: "Sample", namespace: "Sample" },
      spec(),
    );
    await commitApiTestPlan(plan);
    const settings = JSON.parse(
      await fs.readFile(
        path.join(result.rootPath, "tests", "appsettings.json"),
        "utf8",
      ),
    ) as {
      ApiTest: { Urls: Record<string, { BaseUrl: string }> };
    };
    expect(settings.ApiTest.Urls.Default.BaseUrl).toBe(
      "https://api.example.com",
    );
  });

  it("appends a second helper to the same assistant on a follow-up build", async () => {
    const result = await scaffoldApiNodejs("Sample", "Sample");
    await commitApiTestPlan(
      await planApiTestBuild(
        { rootPath: result.rootPath, solutionName: "Sample", namespace: "Sample" },
        spec(),
      ),
    );
    await commitApiTestPlan(
      await planApiTestBuild(
        { rootPath: result.rootPath, solutionName: "Sample", namespace: "Sample" },
        spec({
          testClass: { mode: "existing", path: "tests/users-tests.spec.ts" },
          endpointName: "GetUserById",
          endpointPath: "/users/{0}",
          helperMethodName: "GetUserByIdAsync",
          testMethodName: "GetUserById_Returns200",
          parameters: [{ name: "id", type: "int" }],
        }),
      ),
    );
    const assistant = await fs.readFile(
      path.join(
        result.rootPath,
        "tests",
        "api-testing-assistants",
        "users-tests-api-testing-assistants.ts",
      ),
      "utf8",
    );
    expect(assistant).toContain("async GetUsersAsync()");
    expect(assistant).toContain("async GetUserByIdAsync(id: number)");
    const test = await fs.readFile(
      path.join(result.rootPath, "tests", "tests", "users-tests.spec.ts"),
      "utf8",
    );
    expect((test.match(/it\(/g) ?? []).length).toBe(2);
  });

  it("rejects creating a test file that already exists", async () => {
    const result = await scaffoldApiNodejs("Sample", "Sample");
    await commitApiTestPlan(
      await planApiTestBuild(
        { rootPath: result.rootPath, solutionName: "Sample", namespace: "Sample" },
        spec(),
      ),
    );
    await expect(
      planApiTestBuild(
        { rootPath: result.rootPath, solutionName: "Sample", namespace: "Sample" },
        spec(),
      ),
    ).rejects.toThrow(/already exists/);
  });
});
