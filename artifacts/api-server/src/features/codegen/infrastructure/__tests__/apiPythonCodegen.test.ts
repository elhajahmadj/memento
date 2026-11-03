import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  upsertEndpointConstant,
  upsertHelperMethod,
  renderNewTestClass,
  renderNewAssistantFile,
  insertMethodIntoExistingClass,
  planApiTestBuild,
  commitApiTestPlan,
  assistantClassNameFor,
  snakeCase,
} from "@/features/codegen/infrastructure/apiPythonCodegen";
import type { BuildApiTestSpec } from "@/features/codegen/infrastructure/apiCsharpCodegen";
import { scaffoldApiPython } from "@/features/projects/infrastructure/apiPythonScaffolder";
import { recorderConfig } from "@/features/projects/infrastructure/config";

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

const SHELL_ENDPOINTS = `class ApiEndpoints:
    pass
`;

describe("snakeCase", () => {
  it.each([
    ["UsersTests", "users_tests"],
    ["GetUsersAsync", "get_users_async"],
    ["APITestingAssistants", "api_testing_assistants"],
    ["UsersTestsAPITestingAssistants", "users_tests_api_testing_assistants"],
  ])("converts %s -> %s", (input, expected) => {
    expect(snakeCase(input)).toBe(expected);
  });
});

describe("upsertEndpointConstant (python)", () => {
  it("appends a new attribute in the outer class", () => {
    const out = upsertEndpointConstant(SHELL_ENDPOINTS, "GetUsers", "/users");
    expect(out).toContain('GetUsers = "/users"');
    expect(out).toMatch(/class ApiEndpoints:/);
  });

  it("replaces an existing attribute of the same name (idempotent)", () => {
    const once = upsertEndpointConstant(SHELL_ENDPOINTS, "GetUsers", "/users");
    const twice = upsertEndpointConstant(once, "GetUsers", "/v2/users");
    const matches = twice.match(/^[ \t]{4}GetUsers\s*=/gm) ?? [];
    expect(matches.length).toBe(1);
    expect(twice).toContain('"/v2/users"');
  });

  it("creates a nested section class on demand", () => {
    const out = upsertEndpointConstant(
      SHELL_ENDPOINTS,
      "GetById",
      "/users/{0}",
      "Users",
    );
    expect(out).toMatch(/^[ \t]{4}class Users:/m);
    expect(out).toContain('GetById = "/users/{0}"');
  });

  it("appends to existing section class", () => {
    const once = upsertEndpointConstant(
      SHELL_ENDPOINTS,
      "GetById",
      "/users/{0}",
      "Users",
    );
    const twice = upsertEndpointConstant(once, "DeleteById", "/users/{0}", "Users");
    expect(twice).toContain('GetById = "/users/{0}"');
    expect(twice).toContain('DeleteById = "/users/{0}"');
    const sectionMatches = twice.match(/class Users:/g) ?? [];
    expect(sectionMatches.length).toBe(1);
  });

  it("rejects non-identifier endpoint names", () => {
    expect(() => upsertEndpointConstant(SHELL_ENDPOINTS, "1bad", "/x")).toThrow();
  });

  it("rejects when ApiEndpoints class is missing", () => {
    expect(() => upsertEndpointConstant("# empty", "GetUsers", "/users")).toThrow(
      /ApiEndpoints/,
    );
  });
});

describe("renderHelperMethod / renderNewAssistantFile", () => {
  it("renders an async def that calls the right verb on the client", () => {
    const out = renderNewAssistantFile(spec(), "UsersTests");
    expect(out).toContain("class UsersTestsAPITestingAssistants:");
    expect(out).toContain("async def get_users(self):");
    expect(out).toContain('client = self._fixture.get_client("Default")');
    expect(out).toContain("await client.get(ApiEndpoints.GetUsers");
  });

  it("emits .format(...) when parameters are present", () => {
    const out = renderNewAssistantFile(
      spec({
        endpointPath: "/users/{0}",
        parameters: [{ name: "id", type: "int" }],
      }),
      "UsersTests",
    );
    expect(out).toContain("async def get_users(self, id):");
    expect(out).toContain("ApiEndpoints.GetUsers.format(id)");
  });

  it("references nested endpoint section on the class attribute", () => {
    const out = renderNewAssistantFile(
      spec({ endpointSection: "Users" }),
      "UsersTests",
    );
    expect(out).toContain("ApiEndpoints.Users.GetUsers");
  });

  it("adds bearer token header when useAccessToken is true", () => {
    const out = renderNewAssistantFile(
      spec({ useAccessToken: true }),
      "UsersTests",
    );
    expect(out).toContain("get_access_token(self._fixture.configuration");
    expect(out).toContain('"Authorization": f"Bearer');
  });

  it("rejects unsupported HTTP verbs", () => {
    expect(() =>
      renderNewAssistantFile(
        spec({ httpMethod: "PURGE" as unknown as "GET" }),
        "UsersTests",
      ),
    ).toThrow();
  });
});

describe("upsertHelperMethod (python)", () => {
  function shell(): string {
    return renderNewAssistantFile(spec(), "UsersTests");
  }

  it("appends a new helper method", () => {
    const start = shell();
    const updated = upsertHelperMethod(
      start,
      spec({ helperMethodName: "GetOneAsync", endpointName: "GetOne", endpointPath: "/one" }),
      assistantClassNameFor("UsersTests"),
    );
    expect(updated).toContain("async def get_users(self):");
    expect(updated).toContain("async def get_one(self):");
  });

  it("replaces an existing helper of the same name", () => {
    const once = shell();
    const twice = upsertHelperMethod(
      once,
      spec({ httpMethod: "POST" }),
      assistantClassNameFor("UsersTests"),
    );
    const matches = twice.match(/async def get_users\(/g) ?? [];
    expect(matches.length).toBe(1);
    expect(twice).toContain("await client.post(");
  });

  it("throws when the target class is missing", () => {
    expect(() =>
      upsertHelperMethod("# empty", spec(), "UsersTestsAPITestingAssistants"),
    ).toThrow(/missing/);
  });
});

describe("renderNewTestClass / insertMethodIntoExistingClass", () => {
  it("renders a class with pytest fixture wiring", () => {
    const out = renderNewTestClass(spec());
    expect(out).toContain("import pytest");
    expect(out).toContain("class UsersTests:");
    expect(out).toContain("def _setup(self, api_fixture: ApiTestFixture)");
    expect(out).toContain("self._assistant = UsersTestsAPITestingAssistants");
    expect(out).toContain("async def test_get_users_returns200(self):");
    expect(out).toContain("response.status_code == 200");
  });

  it("inserts an additional test into an existing class file", () => {
    const start = renderNewTestClass(spec());
    const out = insertMethodIntoExistingClass(
      start,
      spec({ testMethodName: "GetUsers_AlsoOk" }),
    );
    expect(out).toContain("async def test_get_users_returns200(self):");
    expect(out).toContain("async def test_get_users_also_ok(self):");
  });

  it("refuses to add when method name already exists", () => {
    const start = renderNewTestClass(spec());
    expect(() => insertMethodIntoExistingClass(start, spec())).toThrow(
      /already exists/,
    );
  });

  it("emits @pytest.mark.skip(reason=...) above def when metadata.ignoreReason is set", () => {
    const out = renderNewTestClass(
      spec({
        metadata: {
          ignoreReason: "Flaky on CI",
          categoryConstantName: null,
          categoryValue: null,
        },
      }),
    );
    expect(out).toContain('@pytest.mark.skip(reason="Flaky on CI")');
    expect(out).toContain("async def test_get_users_returns200(self):");
  });

  it("emits @pytest.mark.<NAME> when metadata.categoryConstantName is set", () => {
    const out = renderNewTestClass(
      spec({
        metadata: {
          ignoreReason: null,
          categoryConstantName: "Smoke",
          categoryValue: "smoke-tests",
        },
      }),
    );
    expect(out).toContain("    @pytest.mark.smoke_tests");
    expect(out).toContain("async def test_get_users_returns200(self):");
  });

  it("inserts decorators above def when appending to an existing class", () => {
    const start = renderNewTestClass(spec());
    const out = insertMethodIntoExistingClass(
      start,
      spec({
        testMethodName: "GetUsers_AlsoOk",
        metadata: {
          ignoreReason: null,
          categoryConstantName: "Smoke",
          categoryValue: "smoke-tests",
        },
      }),
    );
    expect(out).toContain("    @pytest.mark.smoke_tests");
    expect(out).toContain("async def test_get_users_also_ok(self):");
  });

  it("refuses non-testMethod modes when adding to existing class", () => {
    const start = renderNewTestClass(spec());
    expect(() =>
      insertMethodIntoExistingClass(
        start,
        spec({ buildInto: "oneTimeSetup", testMethodName: "Other" }),
      ),
    ).toThrow();
  });

  it("emits @pytest.mark.skip + @pytest.mark.{slug} decorators when metadata is set", () => {
    // Both ignoreReason and category set — decorators render in fixed
    // order (skip first, then category) immediately above the method
    // header. The category import is woven in at the top of the new
    // file so the marker name has documented provenance.
    const out = renderNewTestClass(
      spec({
        metadata: {
          ignoreReason: "flaky on CI",
          categoryConstantName: "Smoke",
          categoryValue: "smoke-tests",
        },
      }),
    );
    expect(out).toContain('@pytest.mark.skip(reason="flaky on CI")');
    expect(out).toContain("@pytest.mark.smoke_tests");
    // The class name `UsersTests` is stripped of its trailing `Tests`
    // decoration before deriving the per-suite categories module/class.
    expect(out).toContain(
      "from tests.test_categories.users_categories import UsersCategories",
    );
    const skipIdx = out.indexOf("@pytest.mark.skip");
    const catIdx = out.indexOf("@pytest.mark.smoke_tests");
    const defIdx = out.indexOf("async def test_get_users_returns200");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(catIdx).toBeGreaterThan(skipIdx);
    expect(defIdx).toBeGreaterThan(catIdx);
  });

  it("renders no decorators when metadata fields are blank/null", () => {
    const out = renderNewTestClass(spec());
    expect(out).not.toContain("@pytest.mark.skip");
    expect(out).not.toMatch(/@pytest\.mark\.[a-z_]+\n/);
    expect(out).not.toContain("test_categories");
  });

  it("idempotently weaves the categories import on insert into existing class", () => {
    const start = renderNewTestClass(
      spec({
        metadata: {
          categoryConstantName: "Smoke",
          categoryValue: "smoke-tests",
        },
      }),
    );
    const out = insertMethodIntoExistingClass(
      start,
      spec({
        testMethodName: "GetUsers_AlsoOk",
        metadata: {
          categoryConstantName: "Smoke",
          categoryValue: "smoke-tests",
        },
      }),
    );
    // The categories import must appear exactly once even though both
    // the original render and the insert path want it present.
    expect(
      (
        out.match(
          /from tests\.test_categories\.users_categories import UsersCategories/g,
        ) ?? []
      ).length,
    ).toBe(1);
    expect(out).toContain("async def test_get_users_returns200(self):");
    expect(out).toContain("async def test_get_users_also_ok(self):");
    // Both methods carry the category decorator (one from the new file,
    // one from the insert).
    expect(
      (out.match(/@pytest\.mark\.smoke_tests/g) ?? []).length,
    ).toBe(2);
  });
});

describe("planApiTestBuild + commitApiTestPlan (python)", () => {
  let tmp: string;
  let originalWorkspace: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "py-codegen-"));
    originalWorkspace = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
  });

  afterEach(async () => {
    recorderConfig.workspaceDir = originalWorkspace;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("plans + commits a fresh build into the scaffolded layout", async () => {
    const scaff = await scaffoldApiPython("Demo", "demo");
    const plan = await planApiTestBuild(
      { rootPath: scaff.rootPath, solutionName: "Demo", namespace: "demo" },
      spec(),
    );
    expect(plan.files.map((f) => f.relPath).sort()).toEqual(
      [
        "automation_api/constants/api_endpoints.py",
        "tests/api_testing_assistants/users_tests_api_testing_assistants.py",
        "tests/appsettings.json",
        "tests/tests/test_UsersTests.py",
      ].sort(),
    );
    expect(plan.files.find((f) => f.relPath.endsWith("test_UsersTests.py"))?.created).toBe(true);
    expect(
      plan.files.find((f) => f.relPath === "automation_api/constants/api_endpoints.py")?.created,
    ).toBe(false);

    await commitApiTestPlan(plan);
    const endpoints = await fs.readFile(
      path.join(scaff.rootPath, "automation_api/constants/api_endpoints.py"),
      "utf8",
    );
    expect(endpoints).toContain('GetUsers = "/users"');
    const testFile = await fs.readFile(
      path.join(scaff.rootPath, "tests/tests/test_UsersTests.py"),
      "utf8",
    );
    expect(testFile).toContain("class UsersTests:");
  });

  it("appends a second helper to the same assistant on a re-run", async () => {
    const scaff = await scaffoldApiPython("Demo", "demo");
    const proj = { rootPath: scaff.rootPath, solutionName: "Demo", namespace: "demo" };
    const plan1 = await planApiTestBuild(proj, spec());
    await commitApiTestPlan(plan1);
    const plan2 = await planApiTestBuild(
      proj,
      spec({
        helperMethodName: "GetOneAsync",
        endpointName: "GetOne",
        endpointPath: "/one",
        testClass: { mode: "existing", path: "tests/tests/test_UsersTests.py" },
        testMethodName: "GetOne_Returns200",
      }),
    );
    expect(
      plan2.files.find((f) =>
        f.relPath.endsWith("users_tests_api_testing_assistants.py"),
      )?.created,
    ).toBe(false);
    expect(
      plan2.files.find((f) => f.relPath === "tests/tests/test_UsersTests.py")?.created,
    ).toBe(false);
    await commitApiTestPlan(plan2);
    const assistant = await fs.readFile(
      path.join(
        scaff.rootPath,
        "tests/api_testing_assistants/users_tests_api_testing_assistants.py",
      ),
      "utf8",
    );
    expect(assistant).toContain("async def get_users(");
    expect(assistant).toContain("async def get_one(");
  });

  it("emits + idempotently upserts the per-suite test_categories file when category metadata is present", async () => {
    const scaff = await scaffoldApiPython("Demo", "demo");
    const proj = {
      rootPath: scaff.rootPath,
      solutionName: "Demo",
      namespace: "demo",
    };

    // First build with a category — plan must include the
    // tests/test_categories/users_categories.py file marked as
    // newly created with `class UsersCategories` carrying the first
    // entry.
    const plan1 = await planApiTestBuild(
      proj,
      spec({
        metadata: {
          ignoreReason: "TODO: needs fixture",
          categoryConstantName: "Smoke",
          categoryValue: "smoke-tests",
        },
      }),
    );
    const cat1 = plan1.files.find((f) =>
      f.relPath.endsWith("test_categories/users_categories.py"),
    );
    expect(cat1).toBeDefined();
    expect(cat1!.created).toBe(true);
    expect(cat1!.content).toContain("class UsersCategories:");
    expect(cat1!.content).toContain('Smoke: str = "smoke-tests"');
    await commitApiTestPlan(plan1);

    // Generated test file carries both decorators in the right order.
    const testFile1 = await fs.readFile(
      path.join(scaff.rootPath, "tests/tests/test_UsersTests.py"),
      "utf8",
    );
    expect(testFile1).toContain('@pytest.mark.skip(reason="TODO: needs fixture")');
    expect(testFile1).toContain("@pytest.mark.smoke_tests");
    expect(testFile1).toContain(
      "from tests.test_categories.users_categories import UsersCategories",
    );

    // Second build into the same suite with a *new* category — the
    // categories file must be merged (existing Smoke kept, Regression
    // appended) and marked as already-existing.
    const plan2 = await planApiTestBuild(
      proj,
      spec({
        helperMethodName: "GetOneAsync",
        endpointName: "GetOne",
        endpointPath: "/one",
        testClass: { mode: "existing", path: "tests/tests/test_UsersTests.py" },
        testMethodName: "GetOne_Returns200",
        metadata: {
          categoryConstantName: "Regression",
          categoryValue: "regression",
        },
      }),
    );
    const cat2 = plan2.files.find((f) =>
      f.relPath.endsWith("test_categories/users_categories.py"),
    );
    expect(cat2).toBeDefined();
    expect(cat2!.created).toBe(false);
    expect(cat2!.content).toContain('Smoke: str = "smoke-tests"');
    expect(cat2!.content).toContain('Regression: str = "regression"');
    await commitApiTestPlan(plan2);

    // A third build with no category metadata must NOT include the
    // categories file in the plan at all.
    const plan3 = await planApiTestBuild(
      proj,
      spec({
        helperMethodName: "GetTwoAsync",
        endpointName: "GetTwo",
        endpointPath: "/two",
        testClass: { mode: "existing", path: "tests/tests/test_UsersTests.py" },
        testMethodName: "GetTwo_Returns200",
      }),
    );
    expect(
      plan3.files.find((f) =>
        f.relPath.endsWith("test_categories/users_categories.py"),
      ),
    ).toBeUndefined();
  });

  it("rolls back partial writes on commit failure", async () => {
    const scaff = await scaffoldApiPython("Demo", "demo");
    const plan = await planApiTestBuild(
      { rootPath: scaff.rootPath, solutionName: "Demo", namespace: "demo" },
      spec(),
    );
    // Force the third write to fail: replace the test class file's
    // dirname with a regular file so mkdir + rename both fail.
    const endpointsBefore = await fs.readFile(
      path.join(scaff.rootPath, "automation_api/constants/api_endpoints.py"),
      "utf8",
    );
    plan.files[2].absPath = path.join(scaff.rootPath, "definitely\u0000bad", "f.py");
    await expect(commitApiTestPlan(plan)).rejects.toBeTruthy();
    const endpointsAfter = await fs.readFile(
      path.join(scaff.rootPath, "automation_api/constants/api_endpoints.py"),
      "utf8",
    );
    expect(endpointsAfter).toBe(endpointsBefore);
  });
});
