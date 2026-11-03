import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addTestMethod,
  buildTestConfigContent,
  checkTestMethodExists,
  clearHookBackups,
  computeTestBodyPreview,
  generateSuiteFiles,
  generateTestClass,
  HOOK_BACKUP_RETENTION,
  isHookDefaultStub,
  migrateUrlReferencesToTestConfig,
  regenerateTestConfig,
  renderAssertionLine,
  replaceHookBody,
  suggestedMethodNameForLastAction,
  type RecordedAction,
} from "@/features/codegen/infrastructure/codegen";
import type { Project } from "@/features/projects/infrastructure/projectService";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { setHookBackupRetention } from "@/features/settings/infrastructure/settings";

function makeProject(rootPath: string): Project {
  return {
    solutionName: "Sln",
    testProjectName: "Tests.Project",
    namespace: "Acme",
    rootPath,
    slnPath: path.join(rootPath, "Sln.sln"),
    language: "csharp",
  };
}

const FIXTURE_WITH_FOO = `using System.Threading.Tasks;
using NUnit.Framework;
using Acme.Infrastructure.Fixtures;

namespace Acme.Tests
{
    [TestFixture]
    public class SampleTests : TestFixture
    {
        [Test]
        public async Task FooAsync()
        {
            await Task.CompletedTask;
        }

        [Test]
        public async Task BarAsync()
        {
            await Task.CompletedTask;
        }
    }
}
`;

const FIXTURE_EMPTY = `using System.Threading.Tasks;
using NUnit.Framework;
using Acme.Infrastructure.Fixtures;

namespace Acme.Tests
{
    [TestFixture]
    public class SampleTests : TestFixture
    {
    }
}
`;

const FIXTURE_WITH_NOISE = `using System.Threading.Tasks;
using NUnit.Framework;
using Acme.Infrastructure.Fixtures;

namespace Acme.Tests
{
    [TestFixture]
    public class SampleTests : TestFixture
    {
        // public async Task FooAsync() — commented out, should be ignored
        private const string Sample = "public async Task FooAsync() {}";

        [Test]
        public async Task BarAsync()
        {
            await Task.CompletedTask;
        }
    }
}
`;


describe("generateTestClass (csharp) writes TestSuite-suffixed file and class (task #104)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tcgen-"));
    await fs.mkdir(path.join(tmp, "Tests.Project/Tests"), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("appends TestSuite to filename and class for a raw user-typed name", async () => {
    const project = makeProject(tmp);
    const rel = await generateTestClass(project, "LoginPage");
    expect(rel).toBe("Tests.Project/Tests/LoginPageTestSuite.cs");
    const txt = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(txt).toContain("public class LoginPageTestSuite : TestFixture");
  });

  it("does not double-suffix when the user already typed TestSuite", async () => {
    const project = makeProject(tmp);
    const rel = await generateTestClass(project, "LoginPageTestSuite");
    expect(rel).toBe("Tests.Project/Tests/LoginPageTestSuite.cs");
    const txt = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(txt).toContain("public class LoginPageTestSuite : TestFixture");
    expect(txt).not.toContain("LoginPageTestSuiteTestSuite");
  });
});

describe("checkTestMethodExists", () => {
  let tmp: string;
  let project: Project;
  const rel = "Tests.Project/Tests/SampleTests.cs";

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-codegen-"));
    project = makeProject(tmp);
    await fs.mkdir(path.join(tmp, "Tests.Project", "Tests"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("reports no collision for a missing file (suffixes the suggested name)", async () => {
    const result = await checkTestMethodExists(project, rel, "Foo");
    expect(result.exists).toBe(false);
    // Even with no on-disk file the suggested name must already carry
    // the C# `Async` convention so the dialog can preview it.
    expect(result.suggestedName).toBe("FooAsync");
  });

  it("detects an existing FooAsync method and suggests FooAsync2", async () => {
    await fs.writeFile(path.join(tmp, rel), FIXTURE_WITH_FOO);
    const result = await checkTestMethodExists(project, rel, "Foo");
    expect(result.exists).toBe(true);
    // Collision-suffix operates on the FINAL `…Async` name, not the
    // bare typed name — `FooAsync2`, never `Foo2Async`.
    expect(result.suggestedName).toBe("FooAsync2");
  });

  it("is idempotent when the user already typed the Async suffix", async () => {
    await fs.writeFile(path.join(tmp, rel), FIXTURE_WITH_FOO);
    const result = await checkTestMethodExists(project, rel, "FooAsync");
    expect(result.exists).toBe(true);
    expect(result.suggestedName).toBe("FooAsync2");
  });

  it("returns the suffixed name when there is no collision in the file", async () => {
    await fs.writeFile(path.join(tmp, rel), FIXTURE_WITH_FOO);
    const result = await checkTestMethodExists(project, rel, "Brand_New");
    expect(result.exists).toBe(false);
    expect(result.suggestedName).toBe("Brand_NewAsync");
  });

  it("ignores method-shaped text inside comments and string literals", async () => {
    await fs.writeFile(path.join(tmp, rel), FIXTURE_WITH_NOISE);
    const result = await checkTestMethodExists(project, rel, "Foo");
    expect(result.exists).toBe(false);
    expect(result.suggestedName).toBe("FooAsync");
  });

  it("walks past further collisions when picking a suffix", async () => {
    const fixture = FIXTURE_WITH_FOO.replace(
      "        public async Task BarAsync()",
      "        public async Task FooAsync2()",
    );
    await fs.writeFile(path.join(tmp, rel), fixture);
    const result = await checkTestMethodExists(project, rel, "Foo");
    expect(result.exists).toBe(true);
    expect(result.suggestedName).toBe("FooAsync3");
  });
});

describe("addTestMethod with overwrite", () => {
  let tmp: string;
  let project: Project;
  const rel = "Tests.Project/Tests/SampleTests.cs";

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-codegen-"));
    project = makeProject(tmp);
    await fs.mkdir(path.join(tmp, "Tests.Project", "Tests"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("replaces an existing method body when overwrite is true (Async-suffixed input)", async () => {
    await fs.writeFile(path.join(tmp, rel), FIXTURE_WITH_FOO);
    const result = await addTestMethod(
      project,
      rel,
      "FooAsync",
      ['await Page.GotoAsync("https://example.com");'],
      [],
      { overwrite: true },
    );
    expect(result).toEqual({
      methodName: "FooAsync",
      renamed: false,
      requestedName: "FooAsync",
    });
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    // The original body is replaced.
    expect(text).not.toMatch(/FooAsync\(\)\s*\{\s*await Task\.CompletedTask;/s);
    expect(text).toContain('await Page.GotoAsync("https://example.com");');
    // BarAsync remains untouched.
    expect(text).toMatch(/public async Task BarAsync\(\)/);
    // Only one FooAsync declaration exists after the overwrite.
    const fooMatches = text.match(/public async Task FooAsync\(\)/g) ?? [];
    expect(fooMatches.length).toBe(1);
  });

  it("appends `Async` when the typed name omits it, and overwrites the matching FooAsync", async () => {
    await fs.writeFile(path.join(tmp, rel), FIXTURE_WITH_FOO);
    const result = await addTestMethod(
      project,
      rel,
      "Foo",
      ['await Page.GotoAsync("https://example.com");'],
      [],
      { overwrite: true },
    );
    // The server is the single source of truth for the C# `Async`
    // convention: a typed `Foo` becomes `FooAsync` BEFORE collision
    // detection, so it overwrites the existing `FooAsync` rather than
    // appending a duplicate `Foo` method.
    expect(result.methodName).toBe("FooAsync");
    expect(result.renamed).toBe(false);
    expect(result.requestedName).toBe("Foo");
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain('await Page.GotoAsync("https://example.com");');
    const fooMatches = text.match(/public async Task FooAsync\(\)/g) ?? [];
    expect(fooMatches.length).toBe(1);
  });

  it("falls back to FooAsync2 (NOT Foo2Async) when overwrite is false", async () => {
    await fs.writeFile(path.join(tmp, rel), FIXTURE_WITH_FOO);
    const result = await addTestMethod(
      project,
      rel,
      "Foo",
      ['await Page.GotoAsync("https://example.com");'],
      [],
    );
    // Collision suffixing must operate on the FINAL `…Async` name so
    // every method on disk reads as a valid async method name.
    expect(result.renamed).toBe(true);
    expect(result.methodName).toBe("FooAsync2");
    expect(result.requestedName).toBe("Foo");
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toMatch(/public async Task FooAsync\(\)/);
    expect(text).toMatch(/public async Task FooAsync2\(\)/);
    // Sanity: the bad shape `Foo2Async` must never appear.
    expect(text).not.toMatch(/public async Task Foo2Async\(\)/);
  });

  it("is idempotent — typing FooAsync produces FooAsync (not FooAsyncAsync)", async () => {
    await fs.writeFile(path.join(tmp, rel), FIXTURE_EMPTY);
    const result = await addTestMethod(
      project,
      rel,
      "FooAsync",
      ['await Page.GotoAsync("https://example.com");'],
      [],
    );
    expect(result.methodName).toBe("FooAsync");
    expect(result.renamed).toBe(false);
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toMatch(/public async Task FooAsync\(\)/);
    expect(text).not.toMatch(/FooAsyncAsync/);
  });

  it("appends a new method when there is no existing collision (overwrite is a no-op)", async () => {
    await fs.writeFile(path.join(tmp, rel), FIXTURE_EMPTY);
    const result = await addTestMethod(
      project,
      rel,
      "Brand_New",
      ['await Page.GotoAsync("https://example.com");'],
      [],
      { overwrite: true },
    );
    expect(result).toEqual({
      methodName: "Brand_NewAsync",
      renamed: false,
      requestedName: "Brand_New",
    });
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toMatch(/public async Task Brand_NewAsync\(\)/);
  });

  it("preserves the existing class member indentation when overwriting", async () => {
    await fs.writeFile(path.join(tmp, rel), FIXTURE_WITH_FOO);
    await addTestMethod(
      project,
      rel,
      "FooAsync",
      ['await Page.GotoAsync("https://example.com");'],
      [],
      { overwrite: true },
    );
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    // 8-space member indent, 12-space body indent are preserved.
    expect(text).toContain("        [Test]\n        public async Task FooAsync()");
    expect(text).toContain(
      '            await Page.GotoAsync("https://example.com");',
    );
  });
});

const HOOK_FIXTURE_DEFAULT = `using System.Threading.Tasks;
using NUnit.Framework;
using Acme.Infrastructure.Fixtures;

namespace Acme.Tests
{
    [TestFixture]
    public class SampleTests : TestFixture
    {
        [OneTimeSetUp]
        public Task OneTimeSetUpAsync()
        {
            return Task.CompletedTask;
        }

        [SetUp]
        public Task BeforeEachAsync()
        {
            return Task.CompletedTask;
        }
    }
}
`;

const HOOK_FIXTURE_POPULATED = `using System.Threading.Tasks;
using NUnit.Framework;
using Acme.Infrastructure.Fixtures;

namespace Acme.Tests
{
    [TestFixture]
    public class SampleTests : TestFixture
    {
        [SetUp]
        public async Task BeforeEachAsync()
        {
            await Page.GotoAsync("https://example.com");
        }
    }
}
`;

const HOOK_FIXTURE_MISSING = `using System.Threading.Tasks;
using NUnit.Framework;
using Acme.Infrastructure.Fixtures;

namespace Acme.Tests
{
    [TestFixture]
    public class SampleTests : TestFixture
    {
        [Test]
        public async Task Foo()
        {
            await Task.CompletedTask;
        }
    }
}
`;

const HOOK_FIXTURE_TAB_INDENT = `using System.Threading.Tasks;
using NUnit.Framework;
using Acme.Infrastructure.Fixtures;

namespace Acme.Tests
{
\t[TestFixture]
\tpublic class SampleTests : TestFixture
\t{
\t\t[SetUp]
\t\tpublic Task BeforeEachAsync()
\t\t{
\t\t\treturn Task.CompletedTask;
\t\t}
\t}
}
`;

describe("isHookDefaultStub", () => {
  let tmp: string;
  let project: Project;
  const rel = "Tests.Project/Tests/SampleTests.cs";

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-hook-stub-"));
    project = makeProject(tmp);
    await fs.mkdir(path.join(tmp, "Tests.Project", "Tests"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns true for the default Task.CompletedTask stub body", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_DEFAULT);
    expect(await isHookDefaultStub(project, rel, "beforeEach")).toBe(true);
    expect(await isHookDefaultStub(project, rel, "oneTimeSetup")).toBe(true);
  });

  it("returns false when the hook has user code in it", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_POPULATED);
    expect(await isHookDefaultStub(project, rel, "beforeEach")).toBe(false);
  });

  it("returns true when the hook does not exist in the file", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_MISSING);
    expect(await isHookDefaultStub(project, rel, "beforeEach")).toBe(true);
    expect(await isHookDefaultStub(project, rel, "oneTimeSetup")).toBe(true);
  });

  it("returns true when the file is missing entirely", async () => {
    expect(await isHookDefaultStub(project, rel, "beforeEach")).toBe(true);
  });

  it("recognises the default stub even with tab indentation", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_TAB_INDENT);
    expect(await isHookDefaultStub(project, rel, "beforeEach")).toBe(true);
  });
});

describe("replaceHookBody", () => {
  let tmp: string;
  let project: Project;
  let originalWorkspace: string;
  const rel = "Tests.Project/Tests/SampleTests.cs";

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-hook-replace-"));
    project = makeProject(tmp);
    // Point the recorder workspace at the per-test tmp dir so the hook
    // backup retention setting reads (and any future writes) stay isolated
    // from the developer's real workspace dir.
    originalWorkspace = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
    await fs.mkdir(path.join(tmp, "Tests.Project", "Tests"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    recorderConfig.workspaceDir = originalWorkspace;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("replaces the default stub body with the supplied lines", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_DEFAULT);
    await replaceHookBody(project, rel, "beforeEach", [
      'await Page.GotoAsync("https://example.com");',
      "ILoginPage loginPage = new LoginPage(Page);",
    ]);
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain(
      "        [SetUp]\n        public async Task BeforeEachAsync()\n        {\n",
    );
    expect(text).toContain(
      '            await Page.GotoAsync("https://example.com");',
    );
    expect(text).toContain(
      "            ILoginPage loginPage = new LoginPage(Page);",
    );
    // Old stub body is gone.
    expect(text).not.toMatch(
      /BeforeEachAsync\(\)\s*\{\s*return Task\.CompletedTask;/s,
    );
    // Only one hook declaration exists.
    expect(text.match(/BeforeEachAsync\(\)/g)?.length).toBe(1);
    // The other hook is left alone.
    expect(text).toMatch(
      /OneTimeSetUpAsync\(\)\s*\{\s*return Task\.CompletedTask;/s,
    );
  });

  it("ensures the page-object using directives are added", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_DEFAULT);
    await replaceHookBody(project, rel, "beforeEach", [
      'await Page.GotoAsync("https://example.com");',
    ]);
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain("using Acme.Tests.PageObjects;");
    expect(text).toContain("using Acme.Tests.PageObjects.Interfaces;");
    expect(text).toContain("using Acme.Tests.PageObjects.Selectors;");
  });

  it("overwrites a populated hook body in place", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_POPULATED);
    await replaceHookBody(project, rel, "beforeEach", [
      'await Page.GotoAsync("https://other.example.com");',
    ]);
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain(
      '            await Page.GotoAsync("https://other.example.com");',
    );
    expect(text).not.toContain(
      'await Page.GotoAsync("https://example.com");',
    );
    expect(text.match(/BeforeEachAsync\(\)/g)?.length).toBe(1);
  });

  it("backs up a non-default hook body alongside the test class", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_POPULATED);
    const result = await replaceHookBody(project, rel, "beforeEach", [
      'await Page.GotoAsync("https://other.example.com");',
    ]);
    expect(result.backupPath).toBeTruthy();
    expect(result.backupPath!).toMatch(
      /^Tests\.Project\/Tests\/SampleTests\.BeforeEachAsync\..+\.bak$/,
    );
    const backupAbs = path.join(tmp, result.backupPath!);
    const backupContent = await fs.readFile(backupAbs, "utf8");
    expect(backupContent).toContain(
      'await Page.GotoAsync("https://example.com");',
    );
    expect(backupContent).not.toContain("BeforeEachAsync");
  });

  it("does not write a backup when the previous body was the default stub", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_DEFAULT);
    const result = await replaceHookBody(project, rel, "beforeEach", [
      'await Page.GotoAsync("https://example.com");',
    ]);
    expect(result.backupPath).toBeNull();
    const dirEntries = await fs.readdir(
      path.join(tmp, "Tests.Project", "Tests"),
    );
    expect(dirEntries.some((e) => e.endsWith(".bak"))).toBe(false);
  });

  it("does not write a backup when the hook is being created fresh", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_MISSING);
    const result = await replaceHookBody(project, rel, "oneTimeSetup", [
      'await Page.GotoAsync("https://example.com");',
    ]);
    expect(result.backupPath).toBeNull();
  });

  it("prunes hook backups beyond the retention cap", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_POPULATED);
    // Drop the file back to a populated body before each rewrite so every
    // call produces a fresh `.bak` (the new body becomes the next "previous"
    // body to be backed up).
    for (let i = 0; i < HOOK_BACKUP_RETENTION + 3; i++) {
      await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_POPULATED);
      const result = await replaceHookBody(project, rel, "beforeEach", [
        `await Page.GotoAsync("https://example.com/${i}");`,
      ]);
      expect(result.backupPath).toBeTruthy();
    }
    const dirEntries = await fs.readdir(
      path.join(tmp, "Tests.Project", "Tests"),
    );
    const backups = dirEntries
      .filter(
        (e) => e.startsWith("SampleTests.BeforeEachAsync.") && e.endsWith(".bak"),
      )
      .sort();
    expect(backups.length).toBe(HOOK_BACKUP_RETENTION);
  });

  it("honors a user-configured retention value when pruning", async () => {
    // Pick a deliberately tighter cap than the default (5) so we can prove
    // the pruner read the live setting instead of the hardcoded constant.
    const customCap = 2;
    await setHookBackupRetention(customCap);
    for (let i = 0; i < customCap + 3; i++) {
      await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_POPULATED);
      const result = await replaceHookBody(project, rel, "beforeEach", [
        `await Page.GotoAsync("https://example.com/${i}");`,
      ]);
      expect(result.backupPath).toBeTruthy();
    }
    const dirEntries = await fs.readdir(
      path.join(tmp, "Tests.Project", "Tests"),
    );
    const backups = dirEntries
      .filter(
        (e) =>
          e.startsWith("SampleTests.BeforeEachAsync.") && e.endsWith(".bak"),
      )
      .sort();
    expect(backups.length).toBe(customCap);
  });

  it("scopes pruning per (test class, hook) pair", async () => {
    const otherRel = "Tests.Project/Tests/OtherTests.cs";
    const dirAbs = path.join(tmp, "Tests.Project", "Tests");
    // Seed a sibling test class's hook backups that should never be touched
    // when the unrelated SampleTests hook is overwritten repeatedly.
    const sentinelNames: string[] = [];
    for (let i = 0; i < 3; i++) {
      const name = `OtherTests.BeforeEachAsync.sentinel-${i}.bak`;
      sentinelNames.push(name);
      await fs.writeFile(path.join(dirAbs, name), `body ${i}`);
    }
    // Also seed a different hook on the same class — also untouched.
    const otherHookName =
      "SampleTests.OneTimeSetUpAsync.sentinel-0.bak";
    await fs.writeFile(path.join(dirAbs, otherHookName), "other hook");

    void otherRel;
    for (let i = 0; i < HOOK_BACKUP_RETENTION + 2; i++) {
      await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_POPULATED);
      await replaceHookBody(project, rel, "beforeEach", [
        `await Page.GotoAsync("https://example.com/${i}");`,
      ]);
    }
    const dirEntries = await fs.readdir(dirAbs);
    for (const name of sentinelNames) {
      expect(dirEntries).toContain(name);
    }
    expect(dirEntries).toContain(otherHookName);
    const ownBackups = dirEntries.filter(
      (e) =>
        e.startsWith("SampleTests.BeforeEachAsync.") && e.endsWith(".bak"),
    );
    expect(ownBackups.length).toBe(HOOK_BACKUP_RETENTION);
  });

  it("appends a new hook when the method does not yet exist", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_MISSING);
    await replaceHookBody(project, rel, "oneTimeSetup", [
      'await Page.GotoAsync("https://example.com");',
    ]);
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toMatch(/\[OneTimeSetUp\]/);
    expect(text).toMatch(/public async Task OneTimeSetUpAsync\(\)/);
    expect(text).toContain(
      '            await Page.GotoAsync("https://example.com");',
    );
    // The pre-existing Foo test is still intact.
    expect(text).toMatch(/public async Task Foo\(\)/);
  });

  it("preserves the surrounding tab-based indentation", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_TAB_INDENT);
    await replaceHookBody(project, rel, "beforeEach", [
      'await Page.GotoAsync("https://example.com");',
    ]);
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain(
      '\t\t[SetUp]\n\t\tpublic async Task BeforeEachAsync()\n\t\t{\n',
    );
    expect(text).toContain(
      '\t\t\tawait Page.GotoAsync("https://example.com");',
    );
  });

  it("falls back to an awaited Task.CompletedTask when no body lines are supplied", async () => {
    await fs.writeFile(path.join(tmp, rel), HOOK_FIXTURE_DEFAULT);
    await replaceHookBody(project, rel, "beforeEach", []);
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toMatch(
      /public async Task BeforeEachAsync\(\)\s*\{\s*await Task\.CompletedTask;/s,
    );
  });
});

describe("suggestedMethodNameForLastAction", () => {
  it("derives ${Verb}${Noun}Async from selector and action type (C# convention)", () => {
    const a1: RecordedAction = {
      type: "click",
      selector: '[data-testid="submit"]',
    };
    expect(suggestedMethodNameForLastAction([a1])).toBe("ClickSubmitAsync");
    const a2: RecordedAction = {
      type: "fill",
      selector: "#email",
      value: "x",
    };
    expect(suggestedMethodNameForLastAction([a1, a2])).toBe("FillEmailAsync");
  });

  it("appends a numeric suffix on the noun when the same verb+noun would repeat", () => {
    // Two clicks on the same selector — second one collides with the
    // first's auto-decorated name; the suffix lands on the noun, not
    // after the trailing `Async`, so the C# reads naturally.
    const a1: RecordedAction = {
      type: "click",
      selector: '[data-testid="submit"]',
    };
    const a2: RecordedAction = {
      type: "click",
      selector: '[data-testid="submit"]',
    };
    expect(suggestedMethodNameForLastAction([a1, a2])).toBe(
      "ClickSubmit2Async",
    );
  });

  it("keeps the legacy `${Verb}${Key}${i}` shape when language is not C#", () => {
    const a1: RecordedAction = {
      type: "click",
      selector: '[data-testid="submit"]',
    };
    const a2: RecordedAction = {
      type: "fill",
      selector: "#email",
      value: "x",
    };
    // Python and Node.js keep the pre-task-40 naming so their codegen
    // and snake_case-ification stays byte-for-byte identical.
    expect(suggestedMethodNameForLastAction([a1, a2], "python")).toBe(
      "FillEmail2",
    );
    expect(suggestedMethodNameForLastAction([a1, a2], "node")).toBe(
      "FillEmail2",
    );
  });

  it("returns null for actions without a selector (e.g. navigate)", () => {
    expect(
      suggestedMethodNameForLastAction([
        { type: "navigate", url: "https://x" },
      ]),
    ).toBeNull();
  });
});

describe("normalizeNounForCsharp / csharpMethodNameFromNoun", () => {
  it("strips a leading recognized verb when followed by an uppercase letter", async () => {
    const { normalizeNounForCsharp } = await import("@/features/codegen/infrastructure/codegen");
    expect(normalizeNounForCsharp("ClickLoginButton")).toBe("LoginButton");
    expect(normalizeNounForCsharp("FillUserName")).toBe("UserName");
    expect(normalizeNounForCsharp("CheckRememberMe")).toBe("RememberMe");
    expect(normalizeNounForCsharp("SelectCountry")).toBe("Country");
  });

  it("strips a trailing Async suffix", async () => {
    const { normalizeNounForCsharp } = await import("@/features/codegen/infrastructure/codegen");
    expect(normalizeNounForCsharp("LoginButtonAsync")).toBe("LoginButton");
    expect(normalizeNounForCsharp("ClickLoginButtonAsync")).toBe(
      "LoginButton",
    );
  });

  it("leaves a bare noun (no verb, no Async) unchanged", async () => {
    const { normalizeNounForCsharp } = await import("@/features/codegen/infrastructure/codegen");
    expect(normalizeNounForCsharp("LoginButton")).toBe("LoginButton");
    // Verb-only inputs are NOT stripped (would yield empty noun) — the
    // verb is preserved so the user sees an explicit collision /
    // validation error instead of a silently-emptied name.
    expect(normalizeNounForCsharp("Click")).toBe("Click");
    expect(normalizeNounForCsharp("Async")).toBe("Async");
  });

  it("trims surrounding whitespace before normalizing", async () => {
    const { normalizeNounForCsharp } = await import("@/features/codegen/infrastructure/codegen");
    expect(normalizeNounForCsharp("  ClickFooAsync  ")).toBe("Foo");
  });

  it("does NOT strip a verb prefix that runs into a lowercase letter", async () => {
    // `Clickable` happens to start with `Click` but is itself the noun —
    // the next char is lowercase, so the verb-stripper leaves it alone.
    const { normalizeNounForCsharp } = await import("@/features/codegen/infrastructure/codegen");
    expect(normalizeNounForCsharp("Clickable")).toBe("Clickable");
  });

  it("decorates a noun into ${Verb}${Noun}Async per action type", async () => {
    const { csharpMethodNameFromNoun } = await import("@/features/codegen/infrastructure/codegen");
    expect(csharpMethodNameFromNoun("click", "LoginButton")).toBe(
      "ClickLoginButtonAsync",
    );
    expect(csharpMethodNameFromNoun("fill", "UserName")).toBe(
      "FillUserNameAsync",
    );
    expect(csharpMethodNameFromNoun("check", "RememberMe")).toBe(
      "CheckRememberMeAsync",
    );
    expect(csharpMethodNameFromNoun("select", "Country")).toBe(
      "SelectCountryAsync",
    );
  });
});

describe("generateSuiteFiles honors a.methodName", () => {
  let tmp: string;
  let project: Project;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-codegen-suite-"));
    project = makeProject(tmp);
    await fs.mkdir(
      path.join(tmp, "Tests.Project", "PageObjects", "Selectors"),
      { recursive: true },
    );
    await fs.mkdir(
      path.join(tmp, "Tests.Project", "PageObjects", "Interfaces"),
      { recursive: true },
    );
    await fs.mkdir(
      path.join(tmp, "Tests.Project", "PageObjects", "Actions"),
      { recursive: true },
    );
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("uses custom method names when provided (decorating noun-only input as ${Verb}${Noun}Async)", async () => {
    const actions: RecordedAction[] = [
      {
        type: "click",
        selector: '[data-testid="submit"]',
        // Stored noun (the recordingService normalizes user input to
        // the bare noun before persisting). Codegen decorates it.
        methodName: "SubmitForm",
      },
      {
        type: "fill",
        selector: "#email",
        value: "a@b",
        methodName: "EnterEmail",
      },
    ];
    const result = await generateSuiteFiles(project, "Login", actions);
    const text = await fs.readFile(
      path.join(tmp, result.actionsPath),
      "utf8",
    );
    expect(text).toContain("public async Task ClickSubmitFormAsync()");
    expect(text).toContain(
      "public async Task FillEnterEmailAsync(string value)",
    );
    expect(result.methodNames.get(actions[0]!)).toBe("ClickSubmitFormAsync");
    expect(result.methodNames.get(actions[1]!)).toBe("FillEnterEmailAsync");
  });

  it("strips a leading verb / trailing Async from a stored methodName before decorating", async () => {
    // Either of these stored forms should produce the same decorated
    // method name — the recorder accepts the user's input regardless of
    // whether they typed `LoginButton`, `ClickLoginButton`, or
    // `ClickLoginButtonAsync`.
    const actions: RecordedAction[] = [
      {
        type: "click",
        selector: '[data-testid="login"]',
        methodName: "ClickLoginButtonAsync",
      },
    ];
    const result = await generateSuiteFiles(project, "Login", actions);
    expect(result.methodNames.get(actions[0]!)).toBe("ClickLoginButtonAsync");
    const text = await fs.readFile(
      path.join(tmp, result.actionsPath),
      "utf8",
    );
    expect(text).toContain("public async Task ClickLoginButtonAsync()");
    // Selector key is `${Noun}Selector` — derived from the normalized
    // noun, NOT the raw user input.
    const selectorsText = await fs.readFile(
      path.join(tmp, result.selectorsPath),
      "utf8",
    );
    expect(selectorsText).toContain(
      'string LoginButtonSelector = "[data-testid=\\"login\\"]";',
    );
  });

  it("falls back to auto-generated name for invalid identifiers", async () => {
    const actions: RecordedAction[] = [
      {
        type: "click",
        selector: '[data-testid="submit"]',
        methodName: "1bad name",
      },
    ];
    const result = await generateSuiteFiles(project, "Login", actions);
    expect(result.methodNames.get(actions[0]!)).toBe("ClickSubmitAsync");
  });

  it("uses custom names verbatim (no silent suffixing); uniqueness is enforced at naming-time", async () => {
    // Code generation deliberately emits the user-chosen name as-is
    // (decorated to the C# convention); the recordingService's
    // `name-action` handler is responsible for rejecting duplicates
    // with a suggested alternative before they reach codegen.
    const actions: RecordedAction[] = [
      {
        type: "click",
        selector: '[data-testid="submit"]',
        methodName: "Go",
      },
    ];
    const result = await generateSuiteFiles(project, "Login", actions);
    expect(result.methodNames.get(actions[0]!)).toBe("ClickGoAsync");
  });

  it("appends a noun-suffix when two in-flight actions decorate to the same name", async () => {
    // Two clicks on different selectors but the user names both
    // `Submit`. The second collides on the decorated form and gets a
    // `2` after the noun (`ClickSubmit2Async`), preserving the trailing
    // `Async` so the C# reads naturally.
    const actions: RecordedAction[] = [
      {
        type: "click",
        selector: '[data-testid="login"]',
        methodName: "Submit",
      },
      {
        type: "click",
        selector: '[data-testid="signup"]',
        methodName: "Submit",
      },
    ];
    const result = await generateSuiteFiles(project, "Login", actions);
    expect(result.methodNames.get(actions[0]!)).toBe("ClickSubmitAsync");
    expect(result.methodNames.get(actions[1]!)).toBe("ClickSubmit2Async");
    const text = await fs.readFile(
      path.join(tmp, result.actionsPath),
      "utf8",
    );
    expect(text).toContain("public async Task ClickSubmitAsync()");
    expect(text).toContain("public async Task ClickSubmit2Async()");
  });

  it("prefixes a bare XPath selector with 'xpath=' in the generated Selectors file", async () => {
    // Action stored without the engine prefix — common for hand-built or
    // older recordings. Codegen must normalize it so the generated C#
    // constant is a Playwright-ready locator value.
    const actions: RecordedAction[] = [
      {
        type: "click",
        selector: "/html/body/main/section[2]/button",
        selectorStrategy: "xpath",
      },
    ];
    const result = await generateSuiteFiles(project, "Login", actions);
    const selectorsText = await fs.readFile(
      path.join(tmp, result.selectorsPath),
      "utf8",
    );
    // New-style key has the `Selector` suffix.
    expect(selectorsText).toContain(
      'string Element1Selector = "xpath=/html/body/main/section[2]/button";',
    );
    // Sanity: the un-prefixed form is NOT what got written.
    expect(selectorsText).not.toContain(
      'string Element1Selector = "/html/body/main/section[2]/button";',
    );
  });

  it("reuses an existing 'xpath=' selector key when a new bare-XPath action targets the same element", async () => {
    // Seed a prior recording that wrote the prefixed form to disk.
    await generateSuiteFiles(project, "Login", [
      {
        type: "click",
        selector: "xpath=/html/body/main/section[2]/button",
        selectorStrategy: "xpath",
      },
    ]);
    // Now record a new action against the same DOM target but stored as
    // a bare XPath. The reuse-by-value lookup must match.
    const second: RecordedAction[] = [
      {
        type: "click",
        selector: "/html/body/main/section[2]/button",
        selectorStrategy: "xpath",
      },
    ];
    const result = await generateSuiteFiles(project, "Login", second);
    // Same element key, same decorated method name — not a new Element2.
    expect(result.methodNames.get(second[0]!)).toBe("ClickElement1Async");
    const selectorsText = await fs.readFile(
      path.join(tmp, result.selectorsPath),
      "utf8",
    );
    expect(
      selectorsText.match(
        /public static readonly string Element\d+Selector\s*=/g,
      )?.length ?? 0,
    ).toBe(1);
  });

  it("uses ElementN naming for xpath and js-path strategies (no human-readable label)", async () => {
    const actions: RecordedAction[] = [
      {
        type: "click",
        selector: "xpath=/html/body/main/section[2]/button",
        selectorStrategy: "xpath",
      },
      {
        type: "click",
        selector: "html > body > main > section:nth-of-type(3) > a",
        selectorStrategy: "js-path",
      },
    ];
    const result = await generateSuiteFiles(project, "Login", actions);
    expect(result.methodNames.get(actions[0]!)).toBe("ClickElement1Async");
    expect(result.methodNames.get(actions[1]!)).toBe("ClickElement2Async");
    const selectorsText = await fs.readFile(
      path.join(tmp, result.selectorsPath),
      "utf8",
    );
    // The xpath= prefix is preserved verbatim so Playwright accepts it.
    expect(selectorsText).toContain(
      'string Element1Selector = "xpath=/html/body/main/section[2]/button";',
    );
    expect(selectorsText).toContain(
      'string Element2Selector = "html > body > main > section:nth-of-type(3) > a";',
    );
  });

  it("does not change merge behavior across recordings (auto names not rewritten by pre-existing class signatures)", async () => {
    const first: RecordedAction[] = [
      { type: "click", selector: '[data-testid="submit"]' },
    ];
    const r1 = await generateSuiteFiles(project, "Login", first);
    expect(r1.methodNames.get(first[0]!)).toBe("ClickSubmitAsync");
    // Re-record an interaction targeting the same selector. The existing
    // signature on disk should be reused with the same auto-generated
    // name — not suffixed to ClickSubmit2Async or similar.
    const second: RecordedAction[] = [
      { type: "click", selector: '[data-testid="submit"]' },
    ];
    const r2 = await generateSuiteFiles(project, "Login", second);
    expect(r2.methodNames.get(second[0]!)).toBe("ClickSubmitAsync");
  });

  it("emits a private ILocator ${Noun}Element field + constructor initializer for every new-style selector key", async () => {
    const actions: RecordedAction[] = [
      { type: "click", selector: '[data-testid="submit"]' },
      { type: "fill", selector: "#email", value: "a@b" },
    ];
    const result = await generateSuiteFiles(project, "Login", actions);
    const text = await fs.readFile(
      path.join(tmp, result.actionsPath),
      "utf8",
    );
    // One field per noun, declared above the constructor.
    expect(text).toContain(
      "        private readonly ILocator SubmitElement;",
    );
    expect(text).toContain("        private readonly ILocator EmailElement;");
    // Constructor initializes each ILocator from the matching selector
    // constant so method bodies can call `${Noun}Element.{Verb}Async(...)`.
    expect(text).toContain(
      "            SubmitElement = _page.Locator(LoginSelectors.SubmitSelector);",
    );
    expect(text).toContain(
      "            EmailElement = _page.Locator(LoginSelectors.EmailSelector);",
    );
    // Method bodies route through the field instead of inlining the
    // selector — this is the call-site shape the page-object pattern
    // promises.
    expect(text).toContain("=> await SubmitElement.ClickAsync();");
    expect(text).toContain("=> await EmailElement.FillAsync(value);");
  });

  it("preserves legacy `${Noun}` selector keys (no Selector suffix) loaded from disk and keeps their methods on the inline _page.X form", async () => {
    // Simulate an Actions class generated under the pre-task-40
    // convention: the Selectors file uses the bare-noun key `Submit`,
    // and the Actions class calls `_page.ClickAsync(LoginSelectors.Submit)`.
    const selectorsDir = path.join(
      tmp,
      "Tests.Project",
      "PageObjects",
      "Selectors",
    );
    const ifaceDir = path.join(
      tmp,
      "Tests.Project",
      "PageObjects",
      "Interfaces",
    );
    const actionsDir = path.join(
      tmp,
      "Tests.Project",
      "PageObjects",
      "Actions",
    );
    await fs.writeFile(
      path.join(selectorsDir, "LoginSelectors.cs"),
      `namespace Acme.Tests.PageObjects.Selectors
{
    public static class LoginSelectors
    {
        public static readonly string Submit = "[data-testid=\\"submit\\"]";
    }
}
`,
    );
    await fs.writeFile(
      path.join(ifaceDir, "ILoginActions.cs"),
      `using System.Threading.Tasks;

namespace Acme.Tests.PageObjects.Interfaces
{
    public interface ILoginActions
    {
        Task ClickSubmit1();
    }
}
`,
    );
    await fs.writeFile(
      path.join(actionsDir, "LoginActions.cs"),
      `using Microsoft.Playwright;
using Acme.Tests.PageObjects.Interfaces;
using Acme.Tests.PageObjects.Selectors;

namespace Acme.Tests.PageObjects.Actions
{
    public class LoginActions : ILoginActions
    {
        private readonly IPage _page;
        public LoginActions(IPage page)
        {
            _page = page;
        }

        public async Task ClickSubmit1()
            => await _page.ClickAsync(LoginSelectors.Submit);
    }
}
`,
    );
    // Re-record against the same selector. The on-disk `Submit` key
    // (no `Selector` suffix) is reused — the recorded action attaches
    // to it via reuse-by-value — so no second selector entry is
    // emitted. The action receives the new-style method name
    // `ClickSubmitAsync` (the suite has migrated to the new convention),
    // but its body keeps the legacy inline `_page.ClickAsync(...)` form
    // because the legacy key has no matching `${Noun}Element` field.
    const result = await generateSuiteFiles(project, "Login", [
      { type: "click", selector: '[data-testid="submit"]' },
    ]);
    expect(result.methodNames.size).toBe(1);
    expect(Array.from(result.methodNames.values())[0]).toBe(
      "ClickSubmitAsync",
    );
    const selectorsText = await fs.readFile(
      path.join(tmp, result.selectorsPath),
      "utf8",
    );
    // The legacy bare key survives.
    expect(selectorsText).toContain(
      'string Submit = "[data-testid=\\"submit\\"]";',
    );
    // No NEW `${Noun}Selector` constant for the same value.
    expect(selectorsText).not.toMatch(/string\s+SubmitSelector\s*=/);
    const actionsText = await fs.readFile(
      path.join(tmp, result.actionsPath),
      "utf8",
    );
    // Legacy method preserved (signature + body).
    expect(actionsText).toMatch(/public\s+async\s+Task\s+ClickSubmit1\(\)/);
    expect(actionsText).toContain(
      "=> await _page.ClickAsync(LoginSelectors.Submit);",
    );
    // The newly appended method also uses the legacy inline form —
    // not the field-style — because the legacy key has no field.
    expect(actionsText).toContain("public async Task ClickSubmitAsync()");
    // No `${Noun}Element` field is emitted for the legacy key — the
    // field-style emission is only for new-style `${Noun}Selector`
    // keys.
    expect(actionsText).not.toContain(
      "private readonly ILocator SubmitElement;",
    );
    // And the new method definitely does NOT call into a non-existent
    // `SubmitElement` field.
    expect(actionsText).not.toMatch(/SubmitElement\.ClickAsync\(\)/);
  });
});

describe("computeTestBodyPreview lineActionIndices", () => {
  it("maps each action-derived line back to the source action's session index", () => {
    // Mix navigates, deleted entries, and live actions to exercise the
    // filter logic that drives the workbench's hover-to-highlight pairing.
    const actions: RecordedAction[] = [
      { type: "navigate", url: "https://example.com/login" }, // 0: skipped
      {
        type: "click",
        selector: '[data-testid="submit"]',
        selectorStrategy: "data-testid",
      }, // 1: -> line 2
      {
        type: "click",
        selector: '[data-testid="logout"]',
        selectorStrategy: "data-testid",
        deleted: true,
      }, // 2: deleted, skipped
      {
        type: "fill",
        selector: "#comment",
        selectorStrategy: "id",
        value: "hi",
      }, // 3: -> line 3
    ];
    const { lines, lineActionIndices } = computeTestBodyPreview(
      "Login",
      "Login",
      actions,
    );
    expect(lines).toHaveLength(4);
    // Setup lines have no source action.
    expect(lineActionIndices[0]).toBeNull();
    expect(lineActionIndices[1]).toBeNull();
    // The two action lines map to the original session-array indices.
    expect(lineActionIndices[2]).toBe(1);
    expect(lineActionIndices[3]).toBe(3);
    // Sanity: the deleted action's index never appears in the mapping.
    expect(lineActionIndices).not.toContain(2);
  });

  it("respects custom methodName so renames keep the same source index", () => {
    const actions: RecordedAction[] = [
      { type: "navigate", url: "https://example.com/" },
      {
        type: "click",
        selector: '[data-testid="logout"]',
        selectorStrategy: "data-testid",
        methodName: "SignOutCleanly",
      },
    ];
    const { lines, lineActionIndices } = computeTestBodyPreview(
      "Login",
      "Login",
      actions,
    );
    expect(lines.some((l) => l.includes("SignOutCleanly"))).toBe(true);
    expect(lineActionIndices[2]).toBe(1);
  });

  it("forwards `language` to the method-name resolver so non-C# previews keep legacy naming", () => {
    // Regression guard for task 40: an earlier draft accepted the
    // `language` parameter at the top level but did not pass it through
    // to `computeMethodNamesForActions`, so non-C# previews silently
    // got C#-style names. The legacy form bakes the method index into
    // the name (`ClickSubmit1`, `FillComment2`) and never adds the
    // `Async` suffix — we assert both to catch any future regression.
    const actions: RecordedAction[] = [
      { type: "navigate", url: "https://example.com/login" },
      {
        type: "click",
        selector: '[data-testid="submit"]',
        selectorStrategy: "data-testid",
      },
      {
        type: "fill",
        selector: "#comment",
        selectorStrategy: "id",
        value: "hi",
      },
    ];
    const { lines } = computeTestBodyPreview(
      "Login",
      "Login",
      actions,
      new Map(),
      "node",
    );
    // The setup line is `await Page.GotoAsync(...)` — that `Async` is
    // from the framework, not the naming convention — so we slice it
    // off and only inspect the action-derived lines.
    const actionLines = lines
      .filter((l) => l.includes("actions."))
      .join("\n");
    expect(actionLines).toContain("ClickSubmit1");
    expect(actionLines).toContain("FillComment2");
    expect(actionLines).not.toContain("Async");
    expect(actionLines).not.toContain("Selector");
  });
});


describe("clearHookBackups", () => {
  let tmp: string;
  let project: Project;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-clear-backups-"));
    project = makeProject(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("deletes every hook backup file across the project tree", async () => {
    const dirA = path.join(tmp, "Tests.Project", "Tests");
    const dirB = path.join(tmp, "Tests.Project", "Tests", "Sub");
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });
    const backups = [
      path.join(dirA, "LoginTests.BeforeEachAsync.2024-01-01-aaa.bak"),
      path.join(dirA, "LoginTests.OneTimeSetUpAsync.2024-01-02-bbb.bak"),
      path.join(dirB, "OtherTests.BeforeEachAsync.2024-01-03-ccc.bak"),
    ];
    for (const b of backups) await fs.writeFile(b, "old body");
    // Source code that must never be touched.
    const sourceFile = path.join(dirA, "LoginTests.cs");
    await fs.writeFile(sourceFile, "// real source");
    // A user-authored .bak file that doesn't match the hook backup shape.
    const userBak = path.join(dirA, "notes.bak");
    await fs.writeFile(userBak, "user notes");

    const result = await clearHookBackups(project);

    expect(result.deletedCount).toBe(3);
    expect(result.deletedPaths).toEqual(
      [
        "Tests.Project/Tests/LoginTests.BeforeEachAsync.2024-01-01-aaa.bak",
        "Tests.Project/Tests/LoginTests.OneTimeSetUpAsync.2024-01-02-bbb.bak",
        "Tests.Project/Tests/Sub/OtherTests.BeforeEachAsync.2024-01-03-ccc.bak",
      ].sort(),
    );
    for (const b of backups) {
      await expect(fs.stat(b)).rejects.toThrow();
    }
    // Source and unrelated .bak file are still present.
    expect((await fs.readFile(sourceFile, "utf8")).length).toBeGreaterThan(0);
    expect((await fs.readFile(userBak, "utf8")).length).toBeGreaterThan(0);
  });

  it("returns zero when there are no hook backups", async () => {
    await fs.mkdir(path.join(tmp, "Tests.Project"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "Tests.Project", "OnlyCode.cs"),
      "// nothing to clean",
    );
    const result = await clearHookBackups(project);
    expect(result.deletedCount).toBe(0);
    expect(result.deletedPaths).toEqual([]);
  });

  it("skips bin, obj, and node_modules directories", async () => {
    for (const skipped of ["bin", "obj", "node_modules"]) {
      const dir = path.join(tmp, "Tests.Project", skipped);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `Cached.BeforeEachAsync.2024-stamp.bak`),
        "should be left alone",
      );
    }
    const result = await clearHookBackups(project);
    expect(result.deletedCount).toBe(0);
    for (const skipped of ["bin", "obj", "node_modules"]) {
      const survivor = path.join(
        tmp,
        "Tests.Project",
        skipped,
        "Cached.BeforeEachAsync.2024-stamp.bak",
      );
      await expect(fs.stat(survivor)).resolves.toBeTruthy();
    }
  });
});


describe("renderAssertionLine (C#) — Tier-1 power assertions", () => {
  // Verify each new kind emits the expected NUnit + Playwright C#
  // line. Each kind is also probed with a missing-required-field input
  // to confirm the helper returns `null` (callers skip silently
  // instead of emitting malformed C#).

  it("emits await Expect(...).ToHaveTextAsync(...) for element-has-text", () => {
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "element-has-text",
        selector: "#title",
        assertText: "Hello",
      }),
    ).toBe(
      'await Expect(Page.Locator("#title")).ToHaveTextAsync("Hello");',
    );
  });

  it("emits ToHaveURLAsync(regex) for url-contains and ToHaveURLAsync(string) for url-equals", () => {
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "url-contains",
        assertUrl: "/checkout",
      }),
    ).toBe(
      'await Expect(Page).ToHaveURLAsync(new System.Text.RegularExpressions.Regex(System.Text.RegularExpressions.Regex.Escape("/checkout")));',
    );
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "url-equals",
        assertUrl: "https://example.com/done",
      }),
    ).toBe('await Expect(Page).ToHaveURLAsync("https://example.com/done");');
  });

  it("emits ToBeVisibleAsync for element-visible", () => {
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "element-visible",
        selector: "#cta",
      }),
    ).toBe('await Expect(Page.Locator("#cta")).ToBeVisibleAsync();');
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "element-visible",
        selector: "#hello",
      }),
    ).toBe('await Expect(Page.Locator("#hello")).ToBeVisibleAsync();');
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "element-visible",
      }),
    ).toBeNull();
  });

  it("emits ToBeHiddenAsync for element-hidden", () => {
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "element-hidden",
        selector: "#spinner",
      }),
    ).toBe('await Expect(Page.Locator("#spinner")).ToBeHiddenAsync();');
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "element-hidden",
        selector: "#bye",
      }),
    ).toBe('await Expect(Page.Locator("#bye")).ToBeHiddenAsync();');
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "element-hidden",
      }),
    ).toBeNull();
  });

  it("emits ToHaveCountAsync(n) for element-count-equals", () => {
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "element-count-equals",
        selector: ".row",
        assertCount: 3,
      }),
    ).toBe('await Expect(Page.Locator(".row")).ToHaveCountAsync(3);');
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "element-count-equals",
        selector: ".row",
      }),
    ).toBeNull();
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "element-count-equals",
        assertCount: 1,
      }),
    ).toBeNull();
  });

  it("emits ToHaveAttributeAsync for attribute-equals", () => {
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "attribute-equals",
        selector: "#link",
        assertAttribute: "href",
        assertAttrValue: "/home",
      }),
    ).toBe(
      'await Expect(Page.Locator("#link")).ToHaveAttributeAsync("href", "/home");',
    );
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "attribute-equals",
        selector: "a.docs",
        assertAttribute: "href",
        assertAttrValue: "/docs",
      }),
    ).toBe(
      'await Expect(Page.Locator("a.docs")).ToHaveAttributeAsync("href", "/docs");',
    );
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "attribute-equals",
        selector: "#link",
        assertAttrValue: "/home",
      }),
    ).toBeNull();
  });

  it("emits ToHaveValueAsync for value-equals", () => {
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "value-equals",
        selector: "#email",
        assertValue: "user@example.com",
      }),
    ).toBe(
      'await Expect(Page.Locator("#email")).ToHaveValueAsync("user@example.com");',
    );
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "value-equals",
        selector: "input[name=email]",
        assertValue: "a@b.c",
      }),
    ).toBe(
      'await Expect(Page.Locator("input[name=email]")).ToHaveValueAsync("a@b.c");',
    );
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "value-equals",
        assertValue: "x",
      }),
    ).toBeNull();
  });

  it("emits a GotoAsync+status assertion for response-status", () => {
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "response-status",
        assertStatusCode: 200,
      }),
    ).toBe("Assert.AreEqual(200, (await Page.GotoAsync(Page.Url))!.Status);");
    expect(
      renderAssertionLine({
        type: "assert",
        assertKind: "response-status",
      }),
    ).toBeNull();
  });

  it("returns null for non-assertion actions", () => {
    expect(
      renderAssertionLine({ type: "click", selector: "#x" }),
    ).toBeNull();
  });
});

describe("per-suite Constants + TestCategories (NUnit)", () => {
  let tmp: string;
  let project: Project;
  const rel = "Tests.Project/Tests/LoginTests.cs";

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-suite-"));
    project = makeProject(tmp);
    await fs.mkdir(path.join(tmp, "Tests.Project", "Tests"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmp, rel),
      `using System.Threading.Tasks;
using NUnit.Framework;
using Acme.Infrastructure.Fixtures;

namespace Acme.Tests
{
    [TestFixture]
    public class LoginTests : TestFixture
    {
    }
}
`,
    );
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("derives a per-suite constants stem and writes Constants/{Stem}Constants.cs", async () => {
    const codegen = await import("@/features/codegen/infrastructure/codegen");
    expect(codegen.deriveSuiteStem("LoginTests")).toBe("Login");
    expect(codegen.deriveSuiteStem("CheckoutTestSuite")).toBe("Checkout");
    expect(codegen.deriveSuiteStem("Plain")).toBe("Plain");
    expect(codegen.suiteConstantsClassName("LoginTests")).toBe("LoginConstants");
    expect(codegen.suiteTestCategoriesClassName("LoginTests")).toBe(
      "LoginTestCategories",
    );

    const written = await codegen.writeRecordedConstants(
      project,
      new Map([["UserName", "alice"]]),
      "LoginTests",
    );
    expect(written).toBe("Tests.Project/Constants/LoginConstants.cs");
    const text = await fs.readFile(path.join(tmp, written), "utf8");
    expect(text).toContain("namespace Acme.Tests.Constants");
    expect(text).toContain("public static class LoginConstants");
    expect(text).toContain('public const string UserName = "alice";');

    const round = await codegen.readRecordedConstants(project, "LoginTests");
    expect(round.get("UserName")).toBe("alice");
  });

  it("emits [Ignore] and [Category] above [Test] when metadata is set", async () => {
    await addTestMethod(
      project,
      rel,
      "DoesThing",
      ['await Page.GotoAsync("https://example.com");'],
      [],
      {
        suiteName: "LoginTests",
        metadata: {
          ignoreReason: "Flaky CI",
          categoryConstantName: "Smoke",
          categoryValue: "smoke-tests",
        },
      },
    );
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toMatch(/\[Ignore\("Flaky CI"\)\]\s*\n\s*\[Category\(LoginTestCategories\.Smoke\)\]\s*\n\s*\[Test\]/);
    expect(text).toContain("using Acme.Tests.TestCategories;");
  });

  it("adds `using {namespace}.Tests.Constants;` when the body references {Suite}Constants.X", async () => {
    await addTestMethod(
      project,
      rel,
      "UsesConstant",
      ['await actions.FillCommentAsync(LoginConstants.Greeting);'],
      [],
      { suiteName: "LoginTests" },
    );
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).toContain("using Acme.Tests.Constants;");
    expect(text).toContain("LoginConstants.Greeting");
  });

  it("does not add the constants using when the body has no constants reference", async () => {
    await addTestMethod(
      project,
      rel,
      "PlainBody",
      ['await Page.GotoAsync("https://example.com");'],
      [],
      { suiteName: "LoginTests" },
    );
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).not.toContain("using Acme.Tests.Constants;");
  });

  it("emits no metadata attributes when fields are blank", async () => {
    await addTestMethod(
      project,
      rel,
      "DoesPlainThing",
      ['await Page.GotoAsync("https://example.com");'],
      [],
      {
        suiteName: "LoginTests",
        metadata: {
          ignoreReason: null,
          categoryConstantName: null,
          categoryValue: null,
        },
      },
    );
    const text = await fs.readFile(path.join(tmp, rel), "utf8");
    expect(text).not.toContain("[Ignore(");
    expect(text).not.toContain("[Category(");
    expect(text).not.toContain("using Acme.Tests.TestCategories;");
  });

  it("upsertCategoryConstant is idempotent", async () => {
    const codegen = await import("@/features/codegen/infrastructure/codegen");
    const p1 = await codegen.upsertCategoryConstant(
      project,
      "LoginTests",
      "Smoke",
      "smoke-tests",
    );
    expect(p1).toBe("Tests.Project/TestCategories/LoginTestCategories.cs");
    await codegen.upsertCategoryConstant(
      project,
      "LoginTests",
      "Smoke",
      "smoke-tests",
    );
    await codegen.upsertCategoryConstant(
      project,
      "LoginTests",
      "Regression",
      "regression-tests",
    );
    const text = await fs.readFile(path.join(tmp, p1), "utf8");
    expect(text).toContain("namespace Acme.Tests.TestCategories");
    expect(text).toContain("public static class LoginTestCategories");
    const smokes = text.match(/public const string Smoke /g) ?? [];
    expect(smokes.length).toBe(1);
    expect(text).toContain('public const string Smoke = "smoke-tests";');
    expect(text).toContain(
      'public const string Regression = "regression-tests";',
    );
    // Re-running with a new value replaces in place — no duplicate line.
    await codegen.upsertCategoryConstant(
      project,
      "LoginTests",
      "Smoke",
      "smoke-tests-v2",
    );
    const text2 = await fs.readFile(path.join(tmp, p1), "utf8");
    expect(text2).toContain('public const string Smoke = "smoke-tests-v2";');
    const smokes2 = text2.match(/public const string Smoke /g) ?? [];
    expect(smokes2.length).toBe(1);
  });
});

describe("TestConfig — typed appsettings access (task #206)", () => {
  let tmp: string;
  let project: Project;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "testconfig-"));
    project = makeProject(tmp);
    await fs.mkdir(path.join(tmp, "Sln.Shared", "Configuration"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmp, "Sln.Shared", "Configuration", "TestConfig.cs"),
      "// placeholder\n",
    );
    await fs.mkdir(path.join(tmp, "Tests.Project"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("buildTestConfigContent emits typed URL accessors in stable sort order", () => {
    const content = buildTestConfigContent("Acme", ["Login", "BaseUrl"]);
    expect(content).toContain(
      'public static string BaseUrl => Configuration["Urls:BaseUrl"]!;',
    );
    expect(content).toContain(
      'public static string Login => Configuration["Urls:Login"]!;',
    );
    expect(content.indexOf("BaseUrl =>")).toBeLessThan(
      content.indexOf("Login =>"),
    );
    expect(content).toContain("namespace Acme.Shared.Configuration");
  });

  it("buildTestConfigContent filters non-identifier keys and dedupes", () => {
    const content = buildTestConfigContent("Acme", [
      "Login",
      "Login",
      "1Bad",
      "with space",
    ]);
    const matches = content.match(/public static string Login =>/g) ?? [];
    expect(matches.length).toBe(1);
    expect(content).not.toContain("1Bad");
    expect(content).not.toContain("with space");
  });

  it("buildTestConfigContent for empty list omits the URL accessor block", () => {
    const content = buildTestConfigContent("Acme", []);
    expect(content).toContain("// <auto-generated-urls>");
    expect(content).toContain("// </auto-generated-urls>");
    expect(content).not.toMatch(/public static string \w+ => Configuration/);
  });

  it("regenerateTestConfig writes Shared/Configuration/TestConfig.cs from appsettings.json", async () => {
    await fs.writeFile(
      path.join(tmp, "Tests.Project", "appsettings.json"),
      JSON.stringify({ Urls: { Login: "https://x", Admin: "https://y" } }),
    );
    const rel = await regenerateTestConfig(project);
    expect(rel).toBe("Sln.Shared/Configuration/TestConfig.cs");
    const content = await fs.readFile(path.join(tmp, rel!), "utf8");
    expect(content).toContain(
      'public static string Admin => Configuration["Urls:Admin"]!;',
    );
    expect(content).toContain(
      'public static string Login => Configuration["Urls:Login"]!;',
    );
  });

  it("regenerateTestConfig is a no-op when Shared/Configuration is missing", async () => {
    await fs.rm(path.join(tmp, "Sln.Shared"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "Tests.Project", "appsettings.json"),
      JSON.stringify({ Urls: { Login: "https://x" } }),
    );
    const rel = await regenerateTestConfig(project);
    expect(rel).toBeNull();
  });

  it("migrateUrlReferencesToTestConfig rewrites legacy accessors", () => {
    const before =
      'await Page.GotoAsync(Configuration["Urls:Login"]!);\n' +
      'var url = Configuration["Urls:Admin"]!;';
    const after = migrateUrlReferencesToTestConfig(before);
    expect(after).toBe(
      "await Page.GotoAsync(TestConfig.Login);\nvar url = TestConfig.Admin;",
    );
  });
});
