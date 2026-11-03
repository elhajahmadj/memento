import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  upsertEndpointConstantJava,
  upsertHelperMethodJava,
  renderNewTestClassJava,
  renderNewAssistantFileJava,
  insertTestIntoExistingClassJava,
  planApiTestBuildJava,
  assistantClassNameForJava,
} from "@/features/codegen/infrastructure/apiJavaCodegen";
import { commitApiTestPlan, type BuildApiTestSpec } from "@/features/codegen/infrastructure/apiCsharpCodegen";
import { scaffoldApiJava } from "@/features/projects/infrastructure/apiJavaScaffolder";

function spec(over: Partial<BuildApiTestSpec> = {}): BuildApiTestSpec {
  return {
    baseUrl: "https://api.example.com",
    urlName: "Default",
    endpointName: "GetUsers",
    endpointSection: null,
    endpointPath: "/users",
    buildInto: "testMethod",
    testMethodName: "getUsers_Returns200",
    testClass: { mode: "new", className: "UsersTests" },
    helperMethodName: "getUsersAsync",
    parameters: [],
    httpMethod: "GET",
    useAccessToken: false,
    multipartFields: [],
    defaultHeaders: [],
    ...over,
  };
}

const SHELL_ENDPOINTS = `package com.sample.automation.api.constants;

public final class ApiEndpoints {
    private ApiEndpoints() {}
}
`;

describe("upsertEndpointConstantJava", () => {
  it("appends a new constant in the outer class", () => {
    const out = upsertEndpointConstantJava(SHELL_ENDPOINTS, "GetUsers", "/users");
    expect(out).toContain('public static final String GetUsers = "/users";');
  });

  it("replaces an existing constant of the same name (idempotent)", () => {
    const once = upsertEndpointConstantJava(SHELL_ENDPOINTS, "GetUsers", "/users");
    const twice = upsertEndpointConstantJava(once, "GetUsers", "/v2/users");
    const matches = twice.match(/public static final String GetUsers/g) ?? [];
    expect(matches.length).toBe(1);
    expect(twice).toContain('"/v2/users"');
  });

  it("creates a nested section class on demand", () => {
    const out = upsertEndpointConstantJava(
      SHELL_ENDPOINTS,
      "GetById",
      "/users/{0}",
      "Users",
    );
    expect(out).toContain("public static final class Users");
    expect(out).toContain('public static final String GetById = "/users/{0}";');
  });

  it("rejects non-identifier endpoint names", () => {
    expect(() =>
      upsertEndpointConstantJava(SHELL_ENDPOINTS, "1bad", "/x"),
    ).toThrow();
  });
});

describe("renderNewAssistantFileJava + upsertHelperMethodJava", () => {
  it("renders the assistant file with imports and helper", () => {
    const out = renderNewAssistantFileJava(
      spec(),
      "com.sample.automation.api",
      "UsersTests",
    );
    expect(out).toContain("package com.sample.automation.api.tests.apitestingassistants;");
    expect(out).toContain(
      "public class UsersTestsAPITestingAssistants",
    );
    expect(out).toContain(
      "public java.net.http.HttpResponse<String> getUsersAsync()",
    );
    expect(out).toContain(".GET()");
  });

  it("emits String.format when parameters are present", () => {
    const out = renderNewAssistantFileJava(
      spec({
        endpointPath: "/users/{0}",
        parameters: [{ name: "id", type: "int" }],
      }),
      "com.sample.automation.api",
      "UsersTests",
    );
    expect(out).toContain("String.format(ApiEndpoints.GetUsers, id)");
    expect(out).toContain("int id");
  });

  it("replaces an existing helper method of the same name", () => {
    const once = renderNewAssistantFileJava(
      spec(),
      "com.sample.automation.api",
      "UsersTests",
    );
    const twice = upsertHelperMethodJava(
      once,
      spec({ httpMethod: "DELETE" }),
      "com.sample.automation.api",
      assistantClassNameForJava("UsersTests"),
    );
    const matches =
      twice.match(/public java\.net\.http\.HttpResponse<String> getUsersAsync/g) ??
      [];
    expect(matches.length).toBe(1);
    expect(twice).toContain(".DELETE()");
  });

  it("rejects more than 10 parameters", () => {
    const params = Array.from({ length: 11 }, (_, i) => ({
      name: `p${i}`,
      type: "int",
    }));
    expect(() =>
      renderNewAssistantFileJava(
        spec({ parameters: params }),
        "com.sample.automation.api",
        "X",
      ),
    ).toThrow();
  });

  it("emits multipart body and Authorization header when requested", () => {
    const out = renderNewAssistantFileJava(
      spec({
        httpMethod: "POST",
        useAccessToken: true,
        multipartFields: [{ name: "file", valueExpression: '"hello"' }],
      }),
      "com.sample.automation.api",
      "UsersTests",
    );
    expect(out).toContain("multipart/form-data; boundary=");
    expect(out).toContain('Content-Disposition: form-data; name=\\"file\\"');
    expect(out).toContain("Authorization");
  });
});

describe("renderNewTestClassJava / insertTestIntoExistingClassJava", () => {
  it("emits AssertJ + JUnit 5 @Tag(API) and the assistant binding", () => {
    const out = renderNewTestClassJava(spec(), "com.sample.automation.api");
    expect(out).toContain("@Tag(TestCollections.API)");
    expect(out).toContain("import org.junit.jupiter.api.Test;");
    expect(out).toContain(
      "org.assertj.core.api.Assertions.assertThat(response.statusCode()).isEqualTo(200)",
    );
    expect(out).toContain(
      "import com.sample.automation.api.tests.apitestingassistants.UsersTestsAPITestingAssistants;",
    );
  });

  it("inserts a @Test method into an existing class", () => {
    const existing = `package com.sample.automation.api.tests.tests;

public class UsersTests {
    public UsersTests() {}
}
`;
    const out = insertTestIntoExistingClassJava(
      existing,
      spec({ testClass: { mode: "existing", path: "x.java" } }),
    );
    expect(out).toContain("@Test");
    expect(out).toContain("getUsers_Returns200");
  });

  it("rejects duplicate test method names in existing class", () => {
    const existing = `public class UsersTests {
    @Test void getUsers_Returns200() {}
}
`;
    expect(() =>
      insertTestIntoExistingClassJava(
        existing,
        spec({ testClass: { mode: "existing", path: "x.java" } }),
      ),
    ).toThrow();
  });
});

describe("planApiTestBuildJava + commitApiTestPlan", () => {
  let workspace: string;
  let project: { rootPath: string; solutionName: string; namespace: string };
  let prevWorkspace: string | undefined;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "api-java-codegen-"));
    prevWorkspace = process.env.WORKSPACE_DIR;
    process.env.WORKSPACE_DIR = workspace;
    const { recorderConfig } = await import(
      "@/features/projects/infrastructure/config"
    );
    (recorderConfig as { workspaceDir: string }).workspaceDir = workspace;
    const created = await scaffoldApiJava("Sample", "Sample");
    project = {
      rootPath: created.rootPath,
      solutionName: "Sample",
      namespace: "Sample",
    };
  });

  afterEach(async () => {
    if (prevWorkspace === undefined) delete process.env.WORKSPACE_DIR;
    else process.env.WORKSPACE_DIR = prevWorkspace;
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("plans 4 files and writes them atomically on commit", async () => {
    const plan = await planApiTestBuildJava(project, spec());
    expect(plan.files.map((f) => f.relPath).sort()).toEqual(
      [
        "Sample-automation-api/src/main/java/com/sample/automation/api/constants/ApiEndpoints.java",
        "Sample-automation-api-tests/src/test/java/com/sample/automation/api/tests/apitestingassistants/UsersTestsAPITestingAssistants.java",
        "Sample-automation-api-tests/src/test/java/com/sample/automation/api/tests/tests/UsersTests.java",
        "Sample-automation-api-tests/src/test/resources/appsettings.json",
      ].sort(),
    );
    await commitApiTestPlan(plan);
    const newClass = await fs.readFile(
      path.join(
        project.rootPath,
        "Sample-automation-api-tests/src/test/java/com/sample/automation/api/tests/tests/UsersTests.java",
      ),
      "utf8",
    );
    expect(newClass).toContain("@Tag(TestCollections.API)");
    const settings = JSON.parse(
      await fs.readFile(
        path.join(
          project.rootPath,
          "Sample-automation-api-tests/src/test/resources/appsettings.json",
        ),
        "utf8",
      ),
    );
    expect(settings.ApiTest.Urls.Default.BaseUrl).toBe(
      "https://api.example.com",
    );
  });

  it("refuses to create a test class file that already exists", async () => {
    const first = await planApiTestBuildJava(project, spec());
    await commitApiTestPlan(first);
    await expect(planApiTestBuildJava(project, spec())).rejects.toThrow(
      /already exists/,
    );
  });

  it("rolls back if a planned write would clobber a directory mid-commit", async () => {
    const plan = await planApiTestBuildJava(project, spec());
    const bad = plan.files[2];
    await fs.mkdir(bad.absPath, { recursive: true });
    await expect(commitApiTestPlan(plan)).rejects.toThrow();
    const endpoints = await fs.readFile(plan.files[0].absPath, "utf8");
    expect(endpoints).not.toContain("public static final String GetUsers");
  });

  it("scaffolds with a hyphenated solution name and resolves the lowercase package", async () => {
    // Re-scaffold with a hyphenated name to cover package normalization
    // through the entire planner pipeline.
    const created = await scaffoldApiJava("My-Cool", "ignored");
    const proj = {
      rootPath: created.rootPath,
      solutionName: "My-Cool",
      namespace: "ignored",
    };
    const plan = await planApiTestBuildJava(proj, spec());
    const rels = plan.files.map((f) => f.relPath);
    expect(rels).toContain(
      "My-Cool-automation-api/src/main/java/com/mycool/automation/api/constants/ApiEndpoints.java",
    );
    expect(rels).toContain(
      "My-Cool-automation-api-tests/src/test/java/com/mycool/automation/api/tests/tests/UsersTests.java",
    );
  });
});

describe("apiJavaCodegen — Ignore + TestCategories", () => {
  it("renderNewTestClassJava emits @Disabled, @Tag(<Suite>TestCategories.NAME), and the testcategories import", () => {
    const src = renderNewTestClassJava(
      spec({
        metadata: {
          ignoreReason: "wip",
          categoryConstantName: "SMOKE",
          categoryValue: "smoke-tests",
        },
      }),
      "com.example",
    );
    expect(src).toContain("import org.junit.jupiter.api.Disabled;");
    expect(src).toContain(
      "import com.example.tests.testcategories.UsersTestCategories;",
    );
    expect(src).toMatch(
      /@Disabled\("wip"\)\s+@Tag\(UsersTestCategories\.SMOKE\)\s+@Test\s+void getUsers_Returns200/,
    );
  });

  it("insertTestIntoExistingClassJava injects annotations + imports into an existing class", () => {
    const existing = `package com.example.tests.tests;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import com.example.constants.TestCollections;
import com.example.infrastructure.ApiTestFixture;
import com.example.tests.apitestingassistants.UsersTestsAPITestingAssistants;

@Tag(TestCollections.API)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
public class UsersTests {
    private final UsersTestsAPITestingAssistants assistant;

    public UsersTests() {
        this.assistant = new UsersTestsAPITestingAssistants(ApiTestFixture.getInstance());
    }
}
`;
    const out = insertTestIntoExistingClassJava(
      existing,
      spec({
        testMethodName: "deleteUser_Returns204",
        helperMethodName: "deleteUserAsync",
        metadata: {
          ignoreReason: "needs fixture",
          categoryConstantName: "REGRESSION",
          categoryValue: "regression",
        },
      }),
    );
    expect(out).toContain("import org.junit.jupiter.api.Disabled;");
    expect(out).toContain(
      "import com.example.tests.testcategories.UsersTestCategories;",
    );
    expect(out).toMatch(
      /@Disabled\("needs fixture"\)\s+@Tag\(UsersTestCategories\.REGRESSION\)\s+@Test\s+void deleteUser_Returns204/,
    );
  });

  let workspace: string;
  let project: { rootPath: string; solutionName: string; namespace: string };
  let prevWorkspace: string | undefined;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "api-java-catz-"));
    prevWorkspace = process.env.WORKSPACE_DIR;
    process.env.WORKSPACE_DIR = workspace;
    const { recorderConfig } = await import(
      "@/features/projects/infrastructure/config"
    );
    (recorderConfig as { workspaceDir: string }).workspaceDir = workspace;
    const created = await scaffoldApiJava("Sample", "Sample");
    project = {
      rootPath: created.rootPath,
      solutionName: "Sample",
      namespace: "Sample",
    };
  });

  afterEach(async () => {
    if (prevWorkspace === undefined) delete process.env.WORKSPACE_DIR;
    else process.env.WORKSPACE_DIR = prevWorkspace;
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("planApiTestBuildJava adds a per-suite <Suite>TestCategories.java when both fields are set", async () => {
    const planned = await planApiTestBuildJava(
      project,
      spec({
        metadata: {
          ignoreReason: "wip",
          categoryConstantName: "SMOKE",
          categoryValue: "smoke",
        },
      }),
    );
    const rels = planned.files.map((f) => f.relPath);
    expect(rels).toContain(
      "Sample-automation-api-tests/src/test/java/com/sample/automation/api/tests/testcategories/UsersTestCategories.java",
    );
    const cat = planned.files.find((f) =>
      f.relPath.endsWith("UsersTestCategories.java"),
    )!;
    expect(cat.created).toBe(true);
    expect(cat.content).toContain(
      "package com.sample.automation.api.tests.testcategories;",
    );
    expect(cat.content).toContain(
      'public static final String SMOKE = "smoke";',
    );

    // Idempotent re-plan: same constant name with new value updates in place.
    await commitApiTestPlan(planned);
    const replanned = await planApiTestBuildJava(
      project,
      spec({
        testClass: {
          mode: "existing",
          path: "src/test/java/com/sample/automation/api/tests/tests/UsersTests.java",
        },
        testMethodName: "getUsers_Other",
        helperMethodName: "getUsersOtherAsync",
        metadata: {
          categoryConstantName: "SMOKE",
          categoryValue: "smoke-v2",
        },
      }),
    );
    const cat2 = replanned.files.find((f) =>
      f.relPath.endsWith("UsersTestCategories.java"),
    )!;
    expect(cat2.created).toBe(false);
    expect(cat2.content).toContain(
      'public static final String SMOKE = "smoke-v2";',
    );
    // Constant appears exactly once after upsert.
    const matches = cat2.content.match(/SMOKE\s*=/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("planApiTestBuildJava skips the categories file when only one field is set", async () => {
    const planned = await planApiTestBuildJava(
      project,
      spec({
        metadata: { categoryConstantName: "SMOKE" /* no categoryValue */ },
      }),
    );
    expect(
      planned.files.some((f) => f.relPath.includes("testcategories/")),
    ).toBe(false);
  });

  it("apiJavaScaffolder pre-creates constants/ + testcategories/ directories", async () => {
    const base =
      "Sample-automation-api-tests/src/test/java/com/sample/automation/api/tests";
    expect(
      await fs
        .stat(path.join(project.rootPath, base, "constants"))
        .then((s) => s.isDirectory())
        .catch(() => false),
    ).toBe(true);
    expect(
      await fs
        .stat(path.join(project.rootPath, base, "testcategories"))
        .then((s) => s.isDirectory())
        .catch(() => false),
    ).toBe(true);
  });
});
