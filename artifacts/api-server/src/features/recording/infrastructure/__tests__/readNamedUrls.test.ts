import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readNamedUrls,
  upsertNamedUrl,
} from "@/features/recording/infrastructure/recordingService";
import type { Project } from "@/features/projects/infrastructure/projectService";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "read-urls-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function csharpProject(rootPath: string, solutionName = "AcmeSln"): Project {
  return {
    solutionName,
    testProjectName: `${solutionName}.Tests`,
    namespace: solutionName,
    rootPath,
    slnPath: path.join(rootPath, `${solutionName}.sln`),
    language: "csharp",
  };
}

function nodejsProject(rootPath: string, solutionName = "AcmeJs"): Project {
  return {
    solutionName,
    testProjectName: solutionName.toLowerCase(),
    namespace: solutionName,
    rootPath,
    slnPath: path.join(rootPath, "package.json"),
    language: "nodejs",
  };
}

describe("readNamedUrls - C#", () => {
  it("returns [] when appsettings.json is missing", async () => {
    const project = csharpProject(tmp);
    expect(await readNamedUrls(project)).toEqual([]);
  });

  it("returns each entry under the Urls map", async () => {
    const project = csharpProject(tmp);
    await fs.mkdir(path.join(tmp, project.testProjectName), { recursive: true });
    await fs.writeFile(
      path.join(tmp, project.testProjectName, "appsettings.json"),
      JSON.stringify(
        { Urls: { BaseUrl: "https://a.example", Login: "https://a.example/login" } },
        null,
        2,
      ),
    );
    const urls = await readNamedUrls(project);
    expect(urls).toEqual([
      { name: "BaseUrl", url: "https://a.example" },
      { name: "Login", url: "https://a.example/login" },
    ]);
  });

  it("returns [] when Urls is missing or malformed", async () => {
    const project = csharpProject(tmp);
    await fs.mkdir(path.join(tmp, project.testProjectName), { recursive: true });
    await fs.writeFile(
      path.join(tmp, project.testProjectName, "appsettings.json"),
      JSON.stringify({ Urls: ["not", "an", "object"] }),
    );
    expect(await readNamedUrls(project)).toEqual([]);
  });
});

describe("readNamedUrls - .env (Node/Python)", () => {
  it("returns [] when .env is missing", async () => {
    expect(await readNamedUrls(nodejsProject(tmp))).toEqual([]);
  });

  it("parses bare KEY=value lines and ignores unrelated keys", async () => {
    const project = nodejsProject(tmp);
    await fs.writeFile(
      path.join(tmp, ".env"),
      [
        "DEBUG=1",
        "ACMEJS_URL_LOGIN=https://example.com/login",
        "ACMEJS_URL_HOME_PAGE=https://example.com/",
        "OTHER_VAR=keep-me",
        "",
      ].join("\n"),
    );
    expect(await readNamedUrls(project)).toEqual([
      { name: "LOGIN", url: "https://example.com/login" },
      { name: "HOME_PAGE", url: "https://example.com/" },
    ]);
  });

  it("tolerates export prefix, surrounding whitespace, quotes, and inline comments", async () => {
    const project = nodejsProject(tmp);
    await fs.writeFile(
      path.join(tmp, ".env"),
      [
        "# header comment",
        "  export ACMEJS_URL_LOGIN = https://example.com/login   # main",
        `ACMEJS_URL_QUOTED="https://example.com/with#hash"`,
        "ACMEJS_URL_SINGLE='https://example.com/single'",
        "ACMEJS_URL_EMPTY=",
        "",
      ].join("\n"),
    );
    expect(await readNamedUrls(project)).toEqual([
      { name: "LOGIN", url: "https://example.com/login" },
      { name: "QUOTED", url: "https://example.com/with#hash" },
      { name: "SINGLE", url: "https://example.com/single" },
    ]);
  });

  it("round-trips with upsertNamedUrl when the solution name has punctuation", async () => {
    const project = nodejsProject(tmp, "Acme.QA.Tests");
    await upsertNamedUrl(project, "Login", "https://example.com/login");
    await upsertNamedUrl(project, "Home Page", "https://example.com/");
    const urls = await readNamedUrls(project);
    expect(urls).toEqual([
      { name: "LOGIN", url: "https://example.com/login" },
      { name: "HOME_PAGE", url: "https://example.com/" },
    ]);
  });
});
