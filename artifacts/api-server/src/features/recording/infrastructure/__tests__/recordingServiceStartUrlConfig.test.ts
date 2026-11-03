import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => {
  const page = {
    mouse: { click: vi.fn().mockResolvedValue(undefined) },
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    goto: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    mainFrame: () => ({ url: () => "" }),
    url: vi.fn().mockReturnValue("https://example.com/login"),
    locator: vi.fn().mockReturnValue({ first: () => ({ fill: vi.fn() }) }),
    screenshot: vi
      .fn()
      .mockImplementation(() => new Promise(() => undefined)),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    exposeBinding: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { page, context, browser };
});

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mocks.browser) },
}));

import { setCurrentProject, type Project } from "@/features/projects/infrastructure/projectService";
import * as recording from "@/features/recording/infrastructure/recordingService";

const USER_ID = "00000000-0000-0000-0000-000000000000";

function pythonProject(rootPath: string): Project {
  return {
    solutionName: "AcmePy",
    testProjectName: "acme_py_tests",
    namespace: "AcmePy",
    rootPath,
    slnPath: path.join(rootPath, "pyproject.toml"),
    language: "python",
  };
}

function nodejsProject(rootPath: string): Project {
  return {
    solutionName: "AcmeJs",
    testProjectName: "acme-js",
    namespace: "AcmeJs",
    rootPath,
    slnPath: path.join(rootPath, "package.json"),
    language: "nodejs",
  };
}

function csharpProject(rootPath: string): Project {
  return {
    solutionName: "Acme",
    testProjectName: "Acme.Tests",
    namespace: "Acme",
    rootPath,
    slnPath: path.join(rootPath, "Acme.sln"),
    language: "csharp",
  };
}

async function mkTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("recordingService.start() — language-aware URL persistence (full flow)", () => {
  let tmp: string | null = null;

  afterEach(async () => {
    await recording.shutdown();
    setCurrentProject(null);
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it("writes <SOLUTION>_URL_<NAME>=<url> to <root>/.env when starting a Python recording session", async () => {
    tmp = await mkTmp("rec-start-py-");
    const project = pythonProject(tmp);
    setCurrentProject(project);

    await recording.start(
      {
        startUrl: "https://example.com/login",
        urlName: "Login",
        target: "testMethod",
        methodName: "Login",
        existingTestClassPath: "tests/test_sample.py",
        newTestClassName: null,
      },
      USER_ID,
      project,
    );

    const envText = await fs.readFile(path.join(tmp, ".env"), "utf8");
    expect(envText.trim()).toBe("ACMEPY_URL_LOGIN=https://example.com/login");
  });

  it("writes <SOLUTION>_URL_<NAME>=<url> to <root>/.env when starting a Node.js recording session", async () => {
    tmp = await mkTmp("rec-start-node-");
    const project = nodejsProject(tmp);
    setCurrentProject(project);

    await recording.start(
      {
        startUrl: "https://example.com/login",
        urlName: "Login",
        target: "testMethod",
        methodName: "Login",
        existingTestClassPath: "tests/sample.spec.ts",
        newTestClassName: null,
      },
      USER_ID,
      project,
    );

    const envText = await fs.readFile(path.join(tmp, ".env"), "utf8");
    expect(envText.trim()).toBe("ACMEJS_URL_LOGIN=https://example.com/login");
  });

  it("writes the named URL into <root>/<testProject>/appsettings.json's Urls map when starting a C# recording session", async () => {
    tmp = await mkTmp("rec-start-cs-");
    const project = csharpProject(tmp);
    await fs.mkdir(path.join(tmp, project.testProjectName, "Tests"), {
      recursive: true,
    });
    // Pre-seed appsettings.json so the C# read-modify-write path has a
    // valid JSON to merge into (mirrors the existing scaffolded harness).
    await fs.writeFile(
      path.join(tmp, project.testProjectName, "appsettings.json"),
      JSON.stringify({ Urls: {} }, null, 2),
    );
    // Pre-seed the test class so existingTestClassPath resolves to a real
    // file — start() doesn't read it, but the project is otherwise valid.
    await fs.writeFile(
      path.join(tmp, project.testProjectName, "Tests", "SampleTests.cs"),
      "// placeholder",
    );
    setCurrentProject(project);

    await recording.start(
      {
        startUrl: "https://example.com/login",
        urlName: "Login",
        target: "testMethod",
        methodName: "Login",
        existingTestClassPath: `${project.testProjectName}/Tests/SampleTests.cs`,
        newTestClassName: null,
      },
      USER_ID,
      project,
    );

    const json = JSON.parse(
      await fs.readFile(
        path.join(tmp, project.testProjectName, "appsettings.json"),
        "utf8",
      ),
    );
    expect(json.Urls).toEqual({
      Login: "https://example.com/login",
    });
  });
});
