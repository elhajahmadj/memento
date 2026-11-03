import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  scaffoldApiJava,
  javaApiPackageSegment,
  javaApiHelperModule,
  javaApiTestsModule,
  javaApiBasePackage,
} from "@/features/projects/infrastructure/apiJavaScaffolder";

let tmp: string;
let prev: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "api-java-scaffold-"));
  prev = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = tmp;
  const { recorderConfig } = await import(
    "@/features/projects/infrastructure/config"
  );
  (recorderConfig as { workspaceDir: string }).workspaceDir = tmp;
});

afterEach(async () => {
  if (prev === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("javaApiPackageSegment", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(javaApiPackageSegment("My-Cool App")).toBe("mycoolapp");
    expect(javaApiPackageSegment("Sample")).toBe("sample");
  });
  it("prefixes leading-digit names with 'pkg'", () => {
    expect(javaApiPackageSegment("123abc")).toBe("pkg123abc");
  });
  it("falls back to 'pkg' for empty/non-alnum input", () => {
    expect(javaApiPackageSegment("---")).toBe("pkg");
  });
});

describe("scaffoldApiJava", () => {
  it("emits the full Maven multi-module layout", async () => {
    const r = await scaffoldApiJava("Sample", "Sample");
    expect(r.helperProjectName).toBe("Sample-automation-api");
    expect(r.testProjectName).toBe("Sample-automation-api-tests");
    expect(r.slnPath).toBe(path.join(r.rootPath, "pom.xml"));

    const expected = [
      "pom.xml",
      "Sample-automation-api/pom.xml",
      "Sample-automation-api/src/main/java/com/sample/automation/api/constants/ApiEndpoints.java",
      "Sample-automation-api/src/main/java/com/sample/automation/api/constants/TestCollections.java",
      "Sample-automation-api/src/main/java/com/sample/automation/api/infrastructure/ApiTestFixture.java",
      "Sample-automation-api/src/main/java/com/sample/automation/api/infrastructure/ApiTestOptions.java",
      "Sample-automation-api/src/main/java/com/sample/automation/api/handlers/RetryInterceptor.java",
      "Sample-automation-api/src/main/java/com/sample/automation/api/handlers/HttpLoggingInterceptor.java",
      "Sample-automation-api/src/main/java/com/sample/automation/api/extensions/ConfigurationExtensions.java",
      "Sample-automation-api-tests/pom.xml",
      "Sample-automation-api-tests/src/test/resources/appsettings.json",
      "Sample-automation-api-tests/src/test/java/com/sample/automation/api/tests/infrastructure/ApiTestCollection.java",
    ];
    for (const rel of expected) {
      const abs = path.join(r.rootPath, rel);
      // eslint-disable-next-line no-await-in-loop
      await expect(fs.access(abs)).resolves.toBeUndefined();
    }
  });

  it("root pom aggregates the two modules and pins property versions", async () => {
    const r = await scaffoldApiJava("Sample", "Sample");
    const root = await fs.readFile(r.slnPath, "utf8");
    expect(root).toContain("<module>Sample-automation-api</module>");
    expect(root).toContain("<module>Sample-automation-api-tests</module>");
    expect(root).toContain("<jackson.version>2.17.2</jackson.version>");
    expect(root).toContain("<junit.version>5.11.0</junit.version>");
    expect(root).toContain("<assertj.version>3.26.3</assertj.version>");
  });

  it("appsettings.json starts as an empty Urls block", async () => {
    const r = await scaffoldApiJava("Sample", "Sample");
    const settings = JSON.parse(
      await fs.readFile(
        path.join(
          r.rootPath,
          "Sample-automation-api-tests/src/test/resources/appsettings.json",
        ),
        "utf8",
      ),
    );
    expect(settings).toEqual({ ApiTest: { Urls: {} } });
  });

  it("ApiTestFixture references the singleton accessor and Jackson", async () => {
    const r = await scaffoldApiJava("Sample", "Sample");
    const fixture = await fs.readFile(
      path.join(
        r.rootPath,
        "Sample-automation-api/src/main/java/com/sample/automation/api/infrastructure/ApiTestFixture.java",
      ),
      "utf8",
    );
    expect(fixture).toContain("public static ApiTestFixture getInstance()");
    expect(fixture).toContain("ObjectMapper");
    expect(fixture).toContain("appsettings.json");
  });

  it("normalizes solution names with hyphens for the package name", async () => {
    const r = await scaffoldApiJava("My-Cool-Sln", "ignored");
    expect(javaApiHelperModule("My-Cool-Sln")).toBe(
      "My-Cool-Sln-automation-api",
    );
    expect(javaApiTestsModule("My-Cool-Sln")).toBe(
      "My-Cool-Sln-automation-api-tests",
    );
    expect(javaApiBasePackage("My-Cool-Sln")).toBe(
      "com.mycoolsln.automation.api",
    );
    const endpoints = await fs.readFile(
      path.join(
        r.rootPath,
        "My-Cool-Sln-automation-api/src/main/java/com/mycoolsln/automation/api/constants/ApiEndpoints.java",
      ),
      "utf8",
    );
    expect(endpoints).toContain("package com.mycoolsln.automation.api.constants;");
    expect(endpoints).toContain("public final class ApiEndpoints");
  });
});
