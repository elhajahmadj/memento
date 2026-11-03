import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { upsertNamedUrl } from "@/features/recording/infrastructure/recordingService";
import type { Project } from "@/features/projects/infrastructure/projectService";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "upsert-url-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function csharpProject(rootPath: string): Project {
  return {
    solutionName: "AcmeSln",
    testProjectName: "AcmeSln.Tests",
    namespace: "AcmeSln",
    rootPath,
    slnPath: path.join(rootPath, "AcmeSln.sln"),
    language: "csharp",
  };
}

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

describe("upsertNamedUrl - C#", () => {
  it("writes the named URL into <root>/<testProject>/appsettings.json's Urls map", async () => {
    const project = csharpProject(tmp);
    await fs.mkdir(path.join(tmp, project.testProjectName), {
      recursive: true,
    });
    // Pre-seed appsettings.json — the C# branch reads-modifies-writes it
    // and would hit ENOENT on the directory if we hadn't mkdir-d above.
    await fs.writeFile(
      path.join(tmp, project.testProjectName, "appsettings.json"),
      JSON.stringify({ Urls: { Existing: "https://old.example" } }, null, 2),
    );

    await upsertNamedUrl(project, "Login", "https://example.com/login");

    const json = JSON.parse(
      await fs.readFile(
        path.join(tmp, project.testProjectName, "appsettings.json"),
        "utf8",
      ),
    );
    expect(json.Urls).toEqual({
      Existing: "https://old.example",
      Login: "https://example.com/login",
    });
  });
});

describe("upsertNamedUrl - Python (.env)", () => {
  it("writes <SOLUTION>_URL_<NAME>=<url> to <root>/.env using the codegen-adapter convention", async () => {
    const project = pythonProject(tmp);

    await upsertNamedUrl(project, "Login", "https://example.com/login");

    const envText = await fs.readFile(path.join(tmp, ".env"), "utf8");
    // Matches what codegenAdapter renders for Python:
    //   `os.environ.get("ACMEPY_URL_LOGIN")`.
    expect(envText.trim()).toBe("ACMEPY_URL_LOGIN=https://example.com/login");
  });

  it("replaces an existing key in place rather than appending a duplicate", async () => {
    const project = pythonProject(tmp);
    await fs.writeFile(
      path.join(tmp, ".env"),
      [
        "# Hand-edited comment",
        "OTHER_VAR=keep-me",
        "ACMEPY_URL_LOGIN=https://stale.example",
        "",
      ].join("\n"),
    );

    await upsertNamedUrl(project, "Login", "https://example.com/login");

    const envText = await fs.readFile(path.join(tmp, ".env"), "utf8");
    expect(envText).toBe(
      [
        "# Hand-edited comment",
        "OTHER_VAR=keep-me",
        "ACMEPY_URL_LOGIN=https://example.com/login",
        "",
      ].join("\n"),
    );
  });
});

describe("upsertNamedUrl - shared key naming with codegen", () => {
  it("uses the same env-var key the generated test code reads (covers `.` in solution name)", async () => {
    // Regression guard: when `solutionName` contains a `.` the writer
    // and reader must agree on the sanitized key, otherwise the
    // generated `process.env[KEY]` lookup returns undefined.
    const project = nodejsProject(tmp);
    project.solutionName = "Acme.QA.Tests";

    await upsertNamedUrl(project, "Login", "https://example.com/login");

    const envText = await fs.readFile(path.join(tmp, ".env"), "utf8");
    expect(envText.trim()).toBe(
      "ACME_QA_TESTS_URL_LOGIN=https://example.com/login",
    );
  });
});

describe("upsertNamedUrl - Node.js (.env)", () => {
  it("writes <SOLUTION>_URL_<NAME>=<url> to <root>/.env without requiring a phantom <testProject>/ directory", async () => {
    const project = nodejsProject(tmp);
    // Note: no `<root>/<testProject>/` directory exists — that's exactly
    // the bug fix this test guards against.

    await upsertNamedUrl(project, "Home Page", "https://example.com/");

    const envText = await fs.readFile(path.join(tmp, ".env"), "utf8");
    // Non-alphanumeric chars in the URL name collapse to a single
    // underscore, matching codegenAdapter's `<SOLUTION>_URL_<NAME>` convention.
    expect(envText.trim()).toBe("ACMEJS_URL_HOME_PAGE=https://example.com/");
  });

  it("preserves unrelated lines and only updates the matching key", async () => {
    const project = nodejsProject(tmp);
    await fs.writeFile(
      path.join(tmp, ".env"),
      [
        "ACMEJS_BASE_URL=https://example.com",
        "ACMEJS_URL_LOGIN=https://stale.example/login",
        "DEBUG=1",
        "",
      ].join("\n"),
    );

    await upsertNamedUrl(project, "Login", "https://example.com/login");

    const envText = await fs.readFile(path.join(tmp, ".env"), "utf8");
    expect(envText).toBe(
      [
        "ACMEJS_BASE_URL=https://example.com",
        "ACMEJS_URL_LOGIN=https://example.com/login",
        "DEBUG=1",
        "",
      ].join("\n"),
    );
  });
});
