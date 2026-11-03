import { describe, it, expect } from "vitest";

import {
  parseCSharpFile,
  parseCSharpTestCategoriesFile,
} from "../infrastructure/parsers/csharp";
import { parsePythonFile } from "../infrastructure/parsers/python";
import { parseNodeJsFile } from "../infrastructure/parsers/nodejs";
import { parseJavaFile } from "../infrastructure/parsers/java";
import { classifyMethod } from "../domain/classifier";

describe("C# parser", () => {
  it("extracts namespace + class + [Test] methods with category overrides", () => {
    const src = `
namespace Memento.Tests.Login;

[Category("E2E")]
public class LoginSuite
{
  [Test]
  public void HappyPath() {}

  [Test]
  [Category("Api")]
  public void ProgrammaticLogin() {}

  // not a test
  public void Helper() {}

  [TestCase("a")]
  [TestCase("b")]
  public void Parameterized(string x) {}
}
`;
    const { namespace, methods } = parseCSharpFile(src);
    expect(namespace).toBe("Memento.Tests.Login");
    expect(methods.map((m) => m.id).sort()).toEqual([
      "Memento.Tests.Login.LoginSuite.HappyPath",
      "Memento.Tests.Login.LoginSuite.Parameterized",
      "Memento.Tests.Login.LoginSuite.ProgrammaticLogin",
    ]);
    const happy = methods.find((m) => m.name === "HappyPath")!;
    const prog = methods.find((m) => m.name === "ProgrammaticLogin")!;
    expect(happy.tags).toContain("E2E");
    expect(prog.tags).toContain("Api");
  });
});

describe("C# parser — xUnit", () => {
  it("recognizes [Fact], [Fact(Skip=…)], [Theory], and reads [Trait(\"Category\",…)] tags", () => {
    const src = `
using Xunit;

namespace Foo.Automation.API.Tests.Tests;

[Trait("Category", "api")]
public class HealthChecks
{
  [Fact]
  public async Task Ping() {}

  [Fact(Skip="needs fixture")]
  public async Task Skipped() {}

  [Theory]
  [InlineData(200)]
  public async Task Status(int s) {}

  [Trait("Category", HealthChecksTestCategories.Smoke)]
  [Fact]
  public async Task Smoked() {}
}
`;
    const { namespace, methods } = parseCSharpFile(src);
    expect(namespace).toBe("Foo.Automation.API.Tests.Tests");
    const ids = methods.map((m) => m.name).sort();
    expect(ids).toEqual(["Ping", "Skipped", "Smoked", "Status"]);
    const ping = methods.find((m) => m.name === "Ping")!;
    expect(ping.tags).toContain("api");
    const smoked = methods.find((m) => m.name === "Smoked")!;
    expect(smoked.tags).toContain("Smoke");
    expect(smoked.tags).toContain("api");
  });
});

describe("C# parser — TestCategories cross-file resolution", () => {
  it("resolves [Trait(\"Category\", FooTestCategories.Smoke)] to its declared string value", () => {
    const categoriesSrc = `
namespace Foo.Automation.API.Tests.Tests.TestCategories
{
    public static class HealthChecksTestCategories
    {
        public const string Smoke = "smoke-tests";
        public const string Regression = "regression";
    }
}
`;
    const parsed = parseCSharpTestCategoriesFile(categoriesSrc);
    expect(parsed.get("HealthChecksTestCategories")?.get("Smoke")).toBe(
      "smoke-tests",
    );
    expect(parsed.get("HealthChecksTestCategories")?.get("Regression")).toBe(
      "regression",
    );

    const testSrc = `
using Xunit;

namespace Foo.Automation.API.Tests.Tests;

public class HealthChecks
{
  [Trait("Category", HealthChecksTestCategories.Smoke)]
  [Fact]
  public async Task Smoked() {}

  [Trait("Category", HealthChecksTestCategories.Unknown)]
  [Fact]
  public async Task Unresolved() {}
}
`;
    const { methods } = parseCSharpFile(testSrc, {
      resolveCategoryConstant: (cls, member) =>
        parsed.get(cls)?.get(member),
    });
    const smoked = methods.find((m) => m.name === "Smoked")!;
    // Both the constant identifier and the resolved string value are
    // present, so the classifier can match either form as an override.
    expect(smoked.tags).toContain("Smoke");
    expect(smoked.tags).toContain("smoke-tests");

    // Unresolvable constants still surface the identifier so the
    // user at least sees a human-readable bucket name.
    const unresolved = methods.find((m) => m.name === "Unresolved")!;
    expect(unresolved.tags).toContain("Unknown");
    expect(unresolved.tags).not.toContain("smoke-tests");
  });
});

describe("C# parser — NUnit [Category] constant resolution", () => {
  it("resolves [Category(FooTestCategories.Smoke)] via the same cross-file resolver", () => {
    const categoriesSrc = `
namespace Foo.Automation.API.Tests.Tests.TestCategories
{
    public static class HealthChecksTestCategories
    {
        public const string Smoke = "smoke-tests";
    }
}
`;
    const parsed = parseCSharpTestCategoriesFile(categoriesSrc);

    const testSrc = `
using NUnit.Framework;

namespace Foo.Automation.API.Tests.Tests;

public class HealthChecks
{
  [Test]
  [Category(HealthChecksTestCategories.Smoke)]
  public void Smoked() {}

  [Test]
  [Category(HealthChecksTestCategories.Unknown)]
  public void Unresolved() {}
}
`;
    const { methods } = parseCSharpFile(testSrc, {
      resolveCategoryConstant: (cls, member) =>
        parsed.get(cls)?.get(member),
    });
    const smoked = methods.find((m) => m.name === "Smoked")!;
    expect(smoked.tags).toContain("Smoke");
    expect(smoked.tags).toContain("smoke-tests");

    const unresolved = methods.find((m) => m.name === "Unresolved")!;
    expect(unresolved.tags).toContain("Unknown");
    expect(unresolved.tags).not.toContain("smoke-tests");
  });
});

describe("C# parser — fully-qualified attributes (task #86)", () => {
  it("matches namespaced [NUnit.Framework.Test] / [NUnit.Framework.SetUp] / [Xunit.Fact]", () => {
    const src = `
namespace Foo.Tests;
[NUnit.Framework.TestFixture]
public class QualifiedSuite
{
  [NUnit.Framework.OneTimeSetUp]
  public void OneTimeSetUp() {}
  [NUnit.Framework.Test]
  public void Happy() {}
}
public class XunitSuite
{
  [Xunit.Fact]
  public void Smoked() {}
}
`;
    const { methods, isFixture } = parseCSharpFile(src);
    // Both [NUnit.Framework.Test] and [Xunit.Fact] surface; the
    // [NUnit.Framework.OneTimeSetUp] hook is excluded from methods.
    expect(methods.map((m) => m.name).sort()).toEqual(["Happy", "Smoked"]);
    expect(isFixture).toBe(true);
  });

  it("does NOT mark a plain `abstract class` helper as a fixture (no test signals)", () => {
    // Regression guard: an earlier version of the patch treated
    // `abstract class` on its own as a fixture signal, which would
    // leak abstract helper / POCO bases into the "existing suite"
    // dropdown. Without [TestFixture], setup/teardown, or [Test], an
    // abstract class must not be flagged as a fixture.
    const src = `
namespace Foo.Helpers;
public abstract class AbstractHelper
{
  public abstract string Format(string s);
}
`;
    const { methods, isFixture } = parseCSharpFile(src);
    expect(methods).toEqual([]);
    expect(isFixture).toBe(false);
  });
});

describe("Python parser", () => {
  it("finds module-level + class-level test_ functions and pytest marks", () => {
    const src = `
import pytest

pytestmark = pytest.mark.e2e

@pytest.mark.api
def test_module_level():
    pass

class TestSuite:
    @pytest.mark.unit
    def test_method(self):
        pass

    def test_default(self):
        pass

def helper():
    pass
`;
    const { methods } = parsePythonFile(src);
    const ids = methods.map((m) => m.id).sort();
    expect(ids).toEqual([
      "TestSuite::test_default",
      "TestSuite::test_method",
      "test_module_level",
    ]);
    const moduleLevel = methods.find((m) => m.id === "test_module_level")!;
    expect(moduleLevel.tags).toContain("e2e");
    expect(moduleLevel.tags).toContain("api");
    const classMethod = methods.find((m) => m.id === "TestSuite::test_method")!;
    expect(classMethod.tags).toContain("unit");
  });
});

describe("Node.js (Playwright) parser", () => {
  it("walks describe/test stack and scrapes @tags from titles", () => {
    const src = `
import { test, expect } from "@playwright/test";

test.describe("Login @e2e", () => {
  test("happy path", async ({ page }) => {});
  test.describe("nested", () => {
    test("api ping @api", async () => {});
  });
});

test("standalone", async () => {});
`;
    const { methods, isFixture } = parseNodeJsFile(src);
    const ids = methods.map((m) => m.id).sort();
    expect(ids).toContain("Login @e2e > happy path");
    expect(ids).toContain("Login @e2e > nested > api ping @api");
    expect(ids).toContain("standalone");
    const happy = methods.find((m) => m.id === "Login @e2e > happy path")!;
    expect(happy.tags).toContain("e2e");
    expect(isFixture).toBe(true);
  });

  it("flags describe-only suites as fixtures so they survive the empty-methods filter", () => {
    // A real-world shape: the user has a describe block with hooks
    // but hasn't authored a top-level `test(...)` yet. The AI Agent
    // dropdown MUST still be able to pick this file as a target.
    const src = `
import { test } from "@playwright/test";

test.describe("Smoke flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("https://x.test/");
  });
});
`;
    const { methods, isFixture } = parseNodeJsFile(src);
    expect(methods).toHaveLength(0);
    expect(isFixture).toBe(true);
  });

  it("does NOT flag plain helper files (no test/describe calls) as fixtures", () => {
    const src = `export const BASE_URL = "https://x.test";\n`;
    const { methods, isFixture } = parseNodeJsFile(src);
    expect(methods).toHaveLength(0);
    expect(isFixture).toBe(false);
  });
});

describe("Java parser", () => {
  it("extracts package + @Test methods with @Tag overrides", () => {
    const src = `
package com.memento.tests;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("e2e")
public class LoginIT {
  @Test
  public void happyPath() {}

  @Test
  @Tag("api")
  void programmaticLogin() {}

  void helper() {}
}
`;
    const { packageName, methods } = parseJavaFile(src);
    expect(packageName).toBe("com.memento.tests");
    expect(methods.map((m) => m.id).sort()).toEqual([
      "com.memento.tests.LoginIT#happyPath",
      "com.memento.tests.LoginIT#programmaticLogin",
    ]);
    const prog = methods.find((m) => m.name === "programmaticLogin")!;
    expect(prog.tags).toContain("e2e");
    expect(prog.tags).toContain("api");
  });

  it("skips `abstract` classes so base fixtures don't surface as suites", () => {
    const src = `
package com.memento.tests;

import org.junit.jupiter.api.Test;

public abstract class BaseTest {
  @Test
  public void inheritedSmoke() {}
}

public class RealTests extends BaseTest {
  @Test
  public void realOne() {}
}
`;
    const { methods } = parseJavaFile(src);
    expect(methods.map((m) => m.id)).toEqual([
      "com.memento.tests.RealTests#realOne",
    ]);
  });
});

describe("classifier", () => {
  it("uses tag override before folder convention", () => {
    expect(
      classifyMethod({ filePath: "tests/unit/foo.py", tags: ["e2e"] }),
    ).toBe("e2e");
  });
  it("falls back to folder convention", () => {
    expect(
      classifyMethod({ filePath: "Tests/e2e/Login.cs", tags: [] }),
    ).toBe("e2e");
    expect(
      classifyMethod({ filePath: "Tests/api/Foo.cs", tags: [] }),
    ).toBe("api");
    expect(
      classifyMethod({ filePath: "Tests/Login.cs", tags: [] }),
    ).toBe("unit");
  });
  it("buckets recorder API project paths (`*.api.tests`) as api", () => {
    expect(
      classifyMethod({
        filePath: "Foo.Automation.API.Tests/Tests/HealthChecks.cs",
        tags: [],
      }),
    ).toBe("api");
  });
  it("explicit api/ folder still wins over the *.api.tests fallback", () => {
    expect(
      classifyMethod({
        filePath: "Foo.Automation.API.Tests/api/Foo.cs",
        tags: [],
      }),
    ).toBe("api");
  });
  it("an explicit unit tag still beats the *.api.tests path fallback", () => {
    expect(
      classifyMethod({
        filePath: "Foo.Automation.API.Tests/Tests/HealthChecks.cs",
        tags: ["unit"],
      }),
    ).toBe("unit");
  });
});
