import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  upsertEndpointConstant,
  upsertHelperMethod,
  renderNewTestClass,
  insertFactIntoExistingClass,
  mergeAppSettings,
  planApiTestBuild,
  commitApiTestPlan,
  type BuildApiTestSpec,
} from "@/features/codegen/infrastructure/apiCsharpCodegen";
import { scaffoldApiCsharp } from "@/features/projects/infrastructure/apiCsharpScaffolder";

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

const SHELL_ENDPOINTS = `namespace Foo.Automation.API.Constants;

public static class ApiEndpoints
{
}
`;

const SHELL_ASSISTANT = `using System.Net.Http;
using Foo.Automation.API.Tests.Infrastructure;

namespace Foo.Automation.API.Tests;

public partial class APITestingAssistant
{
    private readonly ApiTestFixture _fixture;
    public APITestingAssistant(ApiTestFixture fixture) { _fixture = fixture; }
}
`;

describe("upsertEndpointConstant", () => {
  it("appends a new constant in the outer class", () => {
    const out = upsertEndpointConstant(SHELL_ENDPOINTS, "GetUsers", "/users");
    expect(out).toContain('public const string GetUsers = "/users";');
  });

  it("replaces an existing constant of the same name (idempotent)", () => {
    const once = upsertEndpointConstant(SHELL_ENDPOINTS, "GetUsers", "/users");
    const twice = upsertEndpointConstant(once, "GetUsers", "/v2/users");
    const matches = twice.match(/public const string GetUsers/g) ?? [];
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
    expect(out).toContain("public static class Users");
    expect(out).toContain('public const string GetById = "/users/{0}";');
  });

  it("rejects non-identifier endpoint names", () => {
    expect(() =>
      upsertEndpointConstant(SHELL_ENDPOINTS, "1bad", "/x"),
    ).toThrow();
  });
});

describe("upsertHelperMethod", () => {
  it("appends a new helper method", () => {
    const out = upsertHelperMethod(SHELL_ASSISTANT, spec(), "Foo");
    expect(out).toContain(
      "public async Task<HttpResponseMessage> GetUsersAsync()",
    );
    expect(out).toContain("HttpMethod.Get");
  });

  it("replaces an existing helper method of the same name", () => {
    const once = upsertHelperMethod(SHELL_ASSISTANT, spec(), "Foo");
    const twice = upsertHelperMethod(
      once,
      spec({ httpMethod: "POST" }),
      "Foo",
    );
    const matches =
      twice.match(/public async Task<HttpResponseMessage> GetUsersAsync/g) ??
      [];
    expect(matches.length).toBe(1);
    expect(twice).toContain("HttpMethod.Post");
  });

  it("emits string.Format when parameters are present", () => {
    const out = upsertHelperMethod(
      SHELL_ASSISTANT,
      spec({
        endpointPath: "/users/{0}",
        parameters: [{ name: "id", type: "int" }],
      }),
      "Foo",
    );
    expect(out).toContain("string.Format(Constants.ApiEndpoints.GetUsers, id)");
    expect(out).toContain("int id");
  });

  it("rejects more than 10 parameters", () => {
    const params = Array.from({ length: 11 }, (_, i) => ({
      name: `p${i}`,
      type: "int",
    }));
    expect(() =>
      upsertHelperMethod(SHELL_ASSISTANT, spec({ parameters: params }), "Foo"),
    ).toThrow();
  });
});

describe("renderNewTestClass / insertFactIntoExistingClass", () => {
  it("emits FluentAssertions and the xUnit collection attribute", () => {
    const out = renderNewTestClass(spec(), "Foo");
    expect(out).toContain("[Collection(TestCollections.Api)]");
    expect(out).toContain("using FluentAssertions");
    expect(out).toContain(".Should().BeTrue();");
  });

  it("inserts a fact into an existing class", () => {
    const existing = `using Xunit;
namespace Foo.Tests;
[Collection(TestCollections.Api)]
public class UsersTests
{
    public UsersTests(ApiTestFixture f) {}
}
`;
    const out = insertFactIntoExistingClass(
      existing,
      spec({ testClass: { mode: "existing", path: "Tests/UsersTests.cs" } }),
    );
    expect(out).toContain("[Fact]");
    expect(out).toContain("GetUsers_Returns200");
  });

  it("rejects duplicate test method names in existing class", () => {
    const existing = `public class UsersTests
{
    [Fact] public async Task GetUsers_Returns200() {}
}
`;
    expect(() =>
      insertFactIntoExistingClass(
        existing,
        spec({ testClass: { mode: "existing", path: "x.cs" } }),
      ),
    ).toThrow();
  });
});

describe("mergeAppSettings", () => {
  it("merges into an existing object without clobbering siblings", () => {
    const src = JSON.stringify({
      Other: { Keep: true },
      ApiTest: { Urls: { A: { BaseUrl: "x" } } },
    });
    const out = mergeAppSettings(src, "B", "https://b.example.com");
    const parsed = JSON.parse(out);
    expect(parsed.Other).toEqual({ Keep: true });
    expect(parsed.ApiTest.Urls.A).toEqual({ BaseUrl: "x" });
    expect(parsed.ApiTest.Urls.B).toEqual({ BaseUrl: "https://b.example.com" });
  });

  it("creates the ApiTest.Urls block when missing", () => {
    const out = mergeAppSettings("{}", "Default", "https://x");
    expect(JSON.parse(out)).toEqual({
      ApiTest: { Urls: { Default: { BaseUrl: "https://x" } } },
    });
  });

  it("rejects malformed JSON", () => {
    expect(() => mergeAppSettings("{not json", "x", "y")).toThrow();
  });
});

describe("planApiTestBuild + commitApiTestPlan", () => {
  let workspace: string;
  let project: { rootPath: string; solutionName: string; namespace: string };

  let prevWorkspace: string | undefined;
  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "api-codegen-"));
    prevWorkspace = process.env.WORKSPACE_DIR;
    process.env.WORKSPACE_DIR = workspace;
    // recorderConfig caches workspaceDir at import time; re-import so the
    // scaffolder uses the per-test temp dir.
    const { recorderConfig } = await import(
      "@/features/projects/infrastructure/config"
    );
    (recorderConfig as { workspaceDir: string }).workspaceDir = workspace;
    const created = await scaffoldApiCsharp("Sample", "Sample");
    project = {
      rootPath: created.rootPath,
      solutionName: "Sample",
      namespace: "Sample",
    };
  });

  afterEach(() => {
    if (prevWorkspace === undefined) delete process.env.WORKSPACE_DIR;
    else process.env.WORKSPACE_DIR = prevWorkspace;
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("plans 4 files and writes them atomically on commit", async () => {
    const plan = await planApiTestBuild(project, spec());
    expect(plan.files.map((f) => f.relPath).sort()).toEqual(
      [
        "Sample.Automation.API/Constants/ApiEndpoints.cs",
        "Sample.Automation.API.Tests/APITestingAssistants/UsersTestsAPITestingAssistants.cs",
        "Sample.Automation.API.Tests/Constants/UsersConstants.cs",
        "Sample.Automation.API.Tests/Tests/UsersTests.cs",
        "Sample.Automation.API.Tests/appsettings.json",
      ].sort(),
    );
    await commitApiTestPlan(plan);
    const newClass = await fs.readFile(
      path.join(
        project.rootPath,
        "Sample.Automation.API.Tests/Tests/UsersTests.cs",
      ),
      "utf8",
    );
    expect(newClass).toContain("[Collection(TestCollections.Api)]");
    const settings = JSON.parse(
      await fs.readFile(
        path.join(project.rootPath, "Sample.Automation.API.Tests/appsettings.json"),
        "utf8",
      ),
    );
    expect(settings.ApiTest.Urls.Default.BaseUrl).toBe("https://api.example.com");
  });

  it("refuses to create a test class file that already exists", async () => {
    const first = await planApiTestBuild(project, spec());
    await commitApiTestPlan(first);
    await expect(planApiTestBuild(project, spec())).rejects.toThrow(
      /already exists/,
    );
  });

  it("rolls back if the test class write would clobber a file mid-commit", async () => {
    const plan = await planApiTestBuild(project, spec());
    // Tamper with one of the planned absolute paths to force a rename
    // failure: point it at a directory that will EISDIR on the write.
    const bad = plan.files[2];
    const dirPath = bad.absPath;
    await fs.mkdir(dirPath, { recursive: true });
    await expect(commitApiTestPlan(plan)).rejects.toThrow();
    const endpoints = await fs.readFile(plan.files[0].absPath, "utf8");
    expect(endpoints).not.toContain("public const string GetUsers");
  });
});

describe("per-suite Constants + TestCategories (xUnit)", () => {
  it("derives a per-suite stem and Constants/TestCategories class names", async () => {
    const m = await import("@/features/codegen/infrastructure/apiCsharpCodegen");
    expect(m.deriveApiSuiteStem("UsersTests")).toBe("Users");
    expect(m.deriveApiSuiteStem("OrdersTestSuite")).toBe("Orders");
    expect(m.deriveApiSuiteStem("Plain")).toBe("Plain");
    expect(m.apiSuiteConstantsClassName("UsersTests")).toBe("UsersConstants");
    expect(m.apiSuiteTestCategoriesClassName("UsersTests")).toBe(
      "UsersTestCategories",
    );
  });

  it("renderNewTestClass emits [Fact(Skip=...)] + [Trait(...)] when metadata is set", () => {
    const text = renderNewTestClass(
      spec({
        metadata: {
          ignoreReason: "Flaky CI",
          categoryConstantName: "Smoke",
          categoryValue: "smoke-tests",
        },
      }),
      "Sample",
    );
    expect(text).toContain('[Trait("Category", UsersTestCategories.Smoke)]');
    expect(text).toContain('[Fact(Skip="Flaky CI")]');
    expect(text).toContain("using Sample.Automation.API.Tests.TestCategories;");
  });

  it("renderNewTestClass emits a plain [Fact] when metadata is blank", () => {
    const text = renderNewTestClass(spec({}), "Sample");
    expect(text).toContain("[Fact]");
    expect(text).not.toContain("[Trait(");
    expect(text).not.toContain("Skip=");
    expect(text).not.toContain(".Tests.TestCategories;");
  });

  it("planApiTestBuild adds per-suite Constants/{Suite}Constants.cs and TestCategories/{Suite}TestCategories.cs", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-api-suite-"));
    const prev = process.env.WORKSPACE_DIR;
    process.env.WORKSPACE_DIR = tmp;
    const { recorderConfig } = await import(
      "@/features/projects/infrastructure/config"
    );
    const prevWorkspaceDir = recorderConfig.workspaceDir;
    (recorderConfig as { workspaceDir: string }).workspaceDir = tmp;
    try {
      const created = await scaffoldApiCsharp("Sample", "Sample");
      const project = {
        rootPath: created.rootPath,
        solutionName: "Sample",
        namespace: "Sample",
      };
      const plan = await planApiTestBuild(
        project,
        spec({
          metadata: {
            ignoreReason: null,
            categoryConstantName: "Smoke",
            categoryValue: "smoke-tests",
          },
        }),
      );
      const rels = plan.files.map((f) => f.relPath).sort();
      expect(rels).toContain("Sample.Automation.API.Tests/Constants/UsersConstants.cs");
      expect(rels).toContain(
        "Sample.Automation.API.Tests/TestCategories/UsersTestCategories.cs",
      );
      const constantsFile = plan.files.find(
        (f) => f.relPath === "Sample.Automation.API.Tests/Constants/UsersConstants.cs",
      );
      expect(constantsFile?.content).toContain(
        "public static class UsersConstants",
      );
      const catFile = plan.files.find(
        (f) =>
          f.relPath ===
          "Sample.Automation.API.Tests/TestCategories/UsersTestCategories.cs",
      );
      expect(catFile?.content).toContain(
        'public const string Smoke = "smoke-tests";',
      );
      const testFile = plan.files.find(
        (f) => f.relPath === "Sample.Automation.API.Tests/Tests/UsersTests.cs",
      );
      expect(testFile?.content).toContain(
        '[Trait("Category", UsersTestCategories.Smoke)]',
      );
      await commitApiTestPlan(plan);

      // Re-run with the same Smoke value — TestCategories file must not gain
      // a duplicate, and Constants/UsersConstants.cs is preserved (not
      // recreated from the empty template overwriting user edits).
      const userEdited = (await fs.readFile(constantsFile!.absPath, "utf8"))
        .replace(
          "public static class UsersConstants\n    {\n    }",
          'public static class UsersConstants\n    {\n        public const string UserName = "alice";\n    }',
        );
      await fs.writeFile(constantsFile!.absPath, userEdited);

      const plan2 = await planApiTestBuild(
        project,
        spec({
          testMethodName: "GetUsers_Returns200_v2",
          testClass: { mode: "existing", path: "Tests/UsersTests.cs" },
          metadata: {
            ignoreReason: "tmp",
            categoryConstantName: "Smoke",
            categoryValue: "smoke-tests-v2",
          },
        }),
      );
      const constantsFile2 = plan2.files.find(
        (f) =>
          f.relPath === "Sample.Automation.API.Tests/Constants/UsersConstants.cs",
      );
      expect(constantsFile2?.created).toBe(false);
      expect(constantsFile2?.content).toContain(
        'public const string UserName = "alice";',
      );
      const catFile2 = plan2.files.find(
        (f) =>
          f.relPath ===
          "Sample.Automation.API.Tests/TestCategories/UsersTestCategories.cs",
      );
      const smokes = catFile2?.content.match(/public const string Smoke /g) ?? [];
      expect(smokes.length).toBe(1);
      expect(catFile2?.content).toContain(
        'public const string Smoke = "smoke-tests-v2";',
      );
      const testFile2 = plan2.files.find(
        (f) => f.relPath === "Sample.Automation.API.Tests/Tests/UsersTests.cs",
      );
      expect(testFile2?.content).toContain('[Fact(Skip="tmp")]');
      expect(testFile2?.content).toContain(
        "using Sample.Automation.API.Tests.TestCategories;",
      );
    } finally {
      if (prev === undefined) delete process.env.WORKSPACE_DIR;
      else process.env.WORKSPACE_DIR = prev;
      (recorderConfig as { workspaceDir: string }).workspaceDir =
        prevWorkspaceDir;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
