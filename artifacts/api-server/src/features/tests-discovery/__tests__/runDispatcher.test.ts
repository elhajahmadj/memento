import { describe, it, expect, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  __resetSelectionRunsForTesting,
  __setSelectionSpawnImplForTesting,
  buildCSharpInvocation,
  buildJavaInvocation,
  buildNodeJsInvocation,
  buildPythonInvocation,
  dispatchSelectionRun,
  getSelectionRun,
  groupTestIdsByLanguage,
  languageForTestId,
  type SelectionSpawnImpl,
} from "../infrastructure/runDispatcher";

describe("languageForTestId", () => {
  it("routes ids by shape", () => {
    expect(languageForTestId("Memento.Tests.LoginSuite.HappyPath")).toBe("csharp");
    expect(languageForTestId("tests/test_login.py::test_thing")).toBe("python");
    expect(languageForTestId("tests/login.spec.ts > Login > happy")).toBe("nodejs");
    expect(languageForTestId("com.memento.LoginIT#happyPath")).toBe("java");
  });
});

describe("groupTestIdsByLanguage", () => {
  it("buckets a mixed selection", () => {
    const groups = groupTestIdsByLanguage([
      "A.B.C",
      "tests/foo.py::test_a",
      "tests/foo.spec.ts > a > b",
      "com.x.Y#z",
    ]);
    expect(groups.get("csharp")).toEqual(["A.B.C"]);
    expect(groups.get("python")?.length).toBe(1);
    expect(groups.get("nodejs")?.length).toBe(1);
    expect(groups.get("java")).toEqual(["com.x.Y#z"]);
  });
});

describe("CLI argv builders", () => {
  it("C# dotnet test --filter joins ids with |", () => {
    const inv = buildCSharpInvocation({
      rootPath: "/proj",
      testIds: ["A.B.C", "X.Y.Z"],
    });
    expect(inv.command).toBe("dotnet");
    expect(inv.args).toEqual([
      "test",
      "--filter",
      "FullyQualifiedName=A.B.C|FullyQualifiedName=X.Y.Z",
      "--nologo",
    ]);
  });
  it("Python pytest passes node ids verbatim", () => {
    const inv = buildPythonInvocation({
      rootPath: "/proj",
      testIds: ["tests/test_a.py::test_one", "tests/test_a.py::Cls::test_two"],
    });
    expect(inv.command).toBe("pytest");
    expect(inv.args).toEqual([
      "tests/test_a.py::test_one",
      "tests/test_a.py::Cls::test_two",
    ]);
  });
  it("Node.js (Playwright) scopes by file + grep", () => {
    const inv = buildNodeJsInvocation({
      rootPath: "/proj",
      testIds: [
        "tests/login.spec.ts > Login > happy",
        "tests/login.spec.ts > Login > sad (with [special])",
      ],
    });
    expect(inv.command).toBe("npx");
    expect(inv.args.slice(0, 3)).toEqual(["playwright", "test", "tests/login.spec.ts"]);
    const grepIdx = inv.args.indexOf("--grep");
    expect(grepIdx).toBeGreaterThan(-1);
    const grep = inv.args[grepIdx + 1]!;
    expect(grep.includes("Login > happy")).toBe(true);
    // special regex chars escaped
    expect(grep.includes("\\[special\\]")).toBe(true);
  });
  it("Java gradle uses --tests with `.` separator (no #)", () => {
    const inv = buildJavaInvocation({
      rootPath: "/non-existent-dir-no-pom",
      testIds: ["com.x.Y#methodA", "com.x.Y#methodB"],
    });
    expect(inv.command).toBe("gradle");
    expect(inv.args).toEqual([
      "test",
      "--tests",
      "com.x.Y.methodA",
      "--tests",
      "com.x.Y.methodB",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Integration test — exercises the dispatcher end-to-end against a   */
/* fixture xUnit project under `*.Automation.API.Tests`.              */
/*                                                                     */
/* We don't actually invoke the dotnet CLI (the sandboxed CI doesn't  */
/* have a populated NuGet cache and shouldn't hit the network from a  */
/* unit test), but we *do* materialize a minimal `.csproj` + `Tests/` */
/* layout matching what the recorder emits for the two-project        */
/* `{Solution}.Automation.API` + `{Solution}.Automation.API.Tests`    */
/* layout, then drive the dispatcher with a fake `spawn` that mimics  */
/* `dotnet test`. That gives us coverage of:                           */
/*                                                                     */
/*  1. The CLI shape our dispatcher hands to dotnet (filter syntax,   */
/*     cwd, --nologo) — `dotnet test --filter FullyQualifiedName=`    */
/*     is the same VSTest predicate xUnit honors, so what works for   */
/*     NUnit round-trips for xUnit too.                                */
/*  2. stdout + stderr capture: the assertion-fail trace lands on the */
/*     SelectionTestRun (no longer swallowed) so the run-detail UI    */
/*     can render it.                                                  */
/*  3. Exit-code → status mapping (0 → passed, non-zero → failed).    */
/* ------------------------------------------------------------------ */

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

afterEach(() => {
  __setSelectionSpawnImplForTesting(null);
  __resetSelectionRunsForTesting();
});

async function makeXunitFixtureProject(): Promise<{
  rootPath: string;
  testProjectDir: string;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rec-xunit-fixture-"));
  const testProjectDir = path.join(root, "Sample.Automation.API.Tests");
  await fs.mkdir(path.join(testProjectDir, "Tests"), { recursive: true });
  await fs.writeFile(
    path.join(testProjectDir, "Sample.Automation.API.Tests.csproj"),
    `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <IsPackable>false</IsPackable>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.10.0" />
    <PackageReference Include="xunit" Version="2.9.0" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />
  </ItemGroup>
</Project>
`,
  );
  await fs.writeFile(
    path.join(testProjectDir, "Tests", "HealthChecks.cs"),
    `using Xunit;
namespace Sample.Automation.API.Tests.Tests;
public class HealthChecks
{
    [Fact]
    public void Returns200() { Assert.Equal(200, 200); }
}
`,
  );
  return {
    rootPath: root,
    testProjectDir,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe("dispatchSelectionRun (csharp / xUnit fixture)", () => {
  it("invokes dotnet test with FullyQualifiedName=… and captures pass output", async () => {
    const fixture = await makeXunitFixtureProject();
    try {
      const calls: Array<{
        command: string;
        args: ReadonlyArray<string>;
        cwd: string;
      }> = [];
      const child = new FakeChild();
      const fake: SelectionSpawnImpl = (command, args, options) => {
        calls.push({ command, args: [...args], cwd: options.cwd });
        return child as unknown as ReturnType<SelectionSpawnImpl>;
      };
      __setSelectionSpawnImplForTesting(fake);

      const run = dispatchSelectionRun({
        language: "csharp",
        rootPath: fixture.rootPath,
        testIds: ["Sample.Automation.API.Tests.Tests.HealthChecks.Returns200"],
        user: { id: "u1", username: "alice" },
      });

      // Dispatcher hands the canonical `dotnet test --filter` shape.
      expect(calls).toHaveLength(1);
      expect(calls[0]?.command).toBe("dotnet");
      expect(calls[0]?.args).toEqual([
        "test",
        "--filter",
        "FullyQualifiedName=Sample.Automation.API.Tests.Tests.HealthChecks.Returns200",
        "--nologo",
      ]);
      // cwd is the project root — `dotnet test` discovers the .csproj
      // from `<root>/Sample.Automation.API.Tests/` automatically.
      expect(calls[0]?.cwd).toBe(fixture.rootPath);

      // Simulate a green dotnet run.
      child.stdout.emit(
        "data",
        Buffer.from(
          "Passed!  - Failed: 0, Passed: 1, Skipped: 0, Total: 1\n",
        ),
      );
      child.emit("close", 0);

      expect(run.status).toBe("passed");
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("Passed: 1");
      expect(run.stderr).toBe("");
      expect(run.finishedAt).not.toBeNull();
      expect(getSelectionRun(run.id)).toBe(run);
    } finally {
      await fixture.cleanup();
    }
  });

  it("surfaces assertion-failure output on the run instead of swallowing it", async () => {
    const fixture = await makeXunitFixtureProject();
    try {
      const child = new FakeChild();
      const fake: SelectionSpawnImpl = () =>
        child as unknown as ReturnType<SelectionSpawnImpl>;
      __setSelectionSpawnImplForTesting(fake);

      const run = dispatchSelectionRun({
        language: "csharp",
        rootPath: fixture.rootPath,
        testIds: ["Sample.Automation.API.Tests.Tests.HealthChecks.Returns200"],
        user: { id: "u1", username: "alice" },
      });

      const failureTrace = [
        "  Failed Sample.Automation.API.Tests.Tests.HealthChecks.Returns200 [12 ms]",
        "  Error Message:",
        "   Assert.Equal() Failure: Values differ",
        "   Expected: 200",
        "   Actual:   500",
        "  Stack Trace:",
        "     at Sample.Automation.API.Tests.Tests.HealthChecks.Returns200() in /work/Tests/HealthChecks.cs:line 7",
        "Failed!  - Failed: 1, Passed: 0, Skipped: 0, Total: 1",
        "",
      ].join("\n");
      child.stdout.emit("data", failureTrace);
      child.stderr.emit("data", "warning NU1701: package targeting issue\n");
      child.emit("close", 1);

      expect(run.status).toBe("failed");
      expect(run.exitCode).toBe(1);
      expect(run.stdout).toContain("Assert.Equal() Failure");
      expect(run.stdout).toContain("Failed: 1, Passed: 0");
      expect(run.stderr).toContain("NU1701");
    } finally {
      await fixture.cleanup();
    }
  });

  it("flags a spawn ENOENT (dotnet not on PATH) as `error`", async () => {
    const fixture = await makeXunitFixtureProject();
    try {
      __setSelectionSpawnImplForTesting(() => {
        const err = new Error("spawn dotnet ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      });

      const run = dispatchSelectionRun({
        language: "csharp",
        rootPath: fixture.rootPath,
        testIds: ["Sample.Automation.API.Tests.Tests.HealthChecks.Returns200"],
        user: { id: "u1", username: "alice" },
      });

      expect(run.status).toBe("error");
      expect(run.errorMessage).toContain("ENOENT");
      expect(run.finishedAt).not.toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });
});
