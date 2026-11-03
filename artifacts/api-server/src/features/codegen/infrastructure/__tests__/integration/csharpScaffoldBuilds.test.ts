import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";

/**
 * Compiles the default C# scaffold with `dotnet build`.
 *
 * The Node.js and Python scaffolds each had an integration test proving
 * their generated sources actually compile; C# — the original and most
 * intricate architecture, with a three-project solution and a DI-wired
 * fixture chain — had none. Every C# template change was therefore
 * verified by eye, which is how the fixture ended up shipping a static
 * `_browserManager`, a disposal order that closed the page after the
 * browser, and a double-disposed `IPlaywright`.
 *
 * This asserts the whole solution restores and builds warning-clean
 * enough to run, which is the cheapest guard that catches a template
 * typo before a user downloads it.
 *
 * Gated behind `RUN_SCAFFOLD_INTEGRATION=1` because it needs the .NET
 * SDK on PATH and a NuGet restore (~100 MB on a cold cache).
 */
const RUN = process.env.RUN_SCAFFOLD_INTEGRATION === "1";
const TEN_MINUTES = 10 * 60 * 1000;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd: string },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env },
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe.skipIf(!RUN)("csharp scaffold builds end-to-end", () => {
  let tmp: string;
  let originalWorkspace: string;
  let projectRoot: string;
  let buildResult: RunResult;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-csbuild-"));
    originalWorkspace = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
    setCurrentProject(null);

    const project = await createProject({
      solutionName: "AcmeCs",
      testProjectName: "AcmeCs.Tests",
      namespace: "Acme.Qa",
      language: "csharp",
    });
    projectRoot = project.rootPath;

    buildResult = await run("dotnet", ["build", "--nologo"], {
      cwd: projectRoot,
    });
  }, TEN_MINUTES);

  afterAll(async () => {
    recorderConfig.workspaceDir = originalWorkspace;
    setCurrentProject(null);
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  });

  it(
    "compiles the generated solution",
    () => {
      expect(
        buildResult.code,
        `dotnet build failed:\n${buildResult.stdout}\n${buildResult.stderr}`,
      ).toBe(0);
    },
    TEN_MINUTES,
  );

  it("produces no compiler warnings in the generated sources", () => {
    // Template regressions usually surface as CS warnings (unused usings,
    // unreachable code, nullability) long before they become errors.
    const warnings = buildResult.stdout
      .split("\n")
      .filter((l) => / warning CS\d+/.test(l));
    expect(warnings, warnings.join("\n")).toEqual([]);
  });

  it("defaults to headless so a first run doesn't pop a browser window", async () => {
    // The reported symptom was a browser flashing open and shut on every
    // test of a freshly exported solution.
    const raw = await fs.readFile(
      path.join(projectRoot, "AcmeCs.Tests", "appsettings.json"),
      "utf8",
    );
    expect(JSON.parse(raw).Headless).toBe(true);
  });

  it("does not hold the browser manager in static state", async () => {
    // A static field is shared by every fixture in the test host: under
    // NUnit parallelism one fixture's SetUp overwrites another's manager
    // and the loser's TearDown disposes the winner's live browser.
    const fixture = await fs.readFile(
      path.join(
        projectRoot,
        "AcmeCs.Infrastructure",
        "Fixtures",
        "TestFixture.cs",
      ),
      "utf8",
    );
    expect(fixture).not.toMatch(/static\s+IBrowserManager/);
    // And it must resolve per test from a scope, not the root provider,
    // or MEDI retains every resolved manager until ProcessExit.
    expect(fixture).toContain("CreateAsyncScope");
    expect(fixture).toContain("AddScoped<IBrowserManager, BrowserManager>");
  });
});
