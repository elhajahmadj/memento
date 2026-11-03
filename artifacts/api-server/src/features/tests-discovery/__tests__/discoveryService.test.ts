import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { discoverProjectTests } from "../infrastructure/discoveryService";
import type {
  DiscoveredTestFile,
  DiscoveredTestFolder,
  DiscoveredTestNode,
} from "../domain/types";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "td-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

function findFolder(node: DiscoveredTestFolder, segs: string[]): DiscoveredTestFolder | null {
  let cur: DiscoveredTestNode = node;
  for (const seg of segs) {
    if (cur.type !== "folder") return null;
    const next: DiscoveredTestNode | undefined = cur.children.find((c) => c.name === seg);
    if (!next) return null;
    cur = next;
  }
  return cur.type === "folder" ? cur : null;
}

function findFile(node: DiscoveredTestFolder, segs: string[]): DiscoveredTestFile | null {
  let cur: DiscoveredTestNode = node;
  for (let i = 0; i < segs.length; i += 1) {
    if (cur.type !== "folder") return null;
    const next: DiscoveredTestNode | undefined = cur.children.find((c) => c.name === segs[i]);
    if (!next) return null;
    cur = next;
  }
  return cur.type === "file" ? cur : null;
}

describe("discoverProjectTests", () => {
  it("walks a multi-language project, classifies, and rolls up totals", async () => {
    await write(
      "Tests/e2e/Login.cs",
      `namespace ProjA.Tests; public class LoginSuite { [Test] public void HappyPath() {} }`,
    );
    await write(
      "tests/test_login.py",
      `def test_module_level():\n    pass\n`,
    );
    await write(
      "tests/api/test_health.py",
      `def test_health():\n    pass\n`,
    );
    await write(
      "tests/login.spec.ts",
      `test.describe("Login @e2e", () => { test("happy", async () => {}); });`,
    );
    await write(
      "src/test/java/com/memento/LoginIT.java",
      `package com.memento; @Tag("e2e") public class LoginIT { @Test public void happyPath() {} }`,
    );
    // Build artifact that should be ignored
    await write(
      "node_modules/lib/foo.spec.ts",
      `test("ignored", () => {});`,
    );

    const tree = await discoverProjectTests({
      projectName: "ProjA",
      slnPath: path.join(tmp, "ProjA.sln"),
      rootPath: tmp,
    });

    expect(tree.root.totals.all).toBe(5);
    expect(tree.root.totals.e2e).toBe(3); // C# e2e folder, py->n/a, ts @e2e tag, java @Tag e2e
    expect(tree.root.totals.api).toBe(1);
    expect(tree.root.totals.unit).toBe(1);

    const csFile = findFile(tree.root, ["Tests", "e2e", "Login.cs"]);
    expect(csFile?.language).toBe("csharp");
    expect(csFile?.methods[0]?.id).toBe("ProjA.Tests.LoginSuite.HappyPath");
    expect(csFile?.methods[0]?.kind).toBe("e2e");

    // Node.js (Playwright) ids must be canonical
    // `relative/path/file.spec.ts > describe > test`.
    const nodeFile = findFile(tree.root, ["tests", "login.spec.ts"]);
    expect(nodeFile?.language).toBe("nodejs");
    expect(nodeFile?.methods[0]?.id).toBe(
      "tests/login.spec.ts > Login @e2e > happy",
    );

    const apiFolder = findFolder(tree.root, ["tests", "api"]);
    expect(apiFolder?.totals.api).toBe(1);

    // Folders sort before files, alphabetical
    const root = tree.root;
    const childNames = root.children.map((c) => `${c.type}:${c.name}`);
    const folders = childNames.filter((n) => n.startsWith("folder:"));
    const files = childNames.filter((n) => n.startsWith("file:"));
    expect(childNames).toEqual([...folders, ...files]);
  });

  it(
    "surfaces C# base / setup-only fixtures but not non-test helpers " +
      "(task #86 — Build with AI dropdown regression)",
    async () => {
      // (a) A real [Test]-bearing suite.
      await write(
        "ProjA.UxTests/Tests/LoginTestSuite.cs",
        `namespace ProjA.UxTests.Tests;
[TestFixture]
public class LoginTestSuite : BaseFixture
{
  [Test]
  public void HappyPath() {}
}`,
      );
      // (b) A [SetUp]-only abstract base fixture — no [Test] yet but
      // strong fixture signals (`abstract class` + `[OneTimeSetUp]`).
      // Should still appear so the user can target it from the
      // "Add method to existing suite" dropdown.
      await write(
        "ProjA.UxTests/Tests/BaseFixture.cs",
        `namespace ProjA.UxTests.Tests;
public abstract class BaseFixture
{
  [OneTimeSetUp]
  public void OneTimeSetUp() {}
  [SetUp]
  public void SetUp() {}
}`,
      );
      // (c) A non-test helper class — no fixture signals at all,
      // must NOT be surfaced.
      await write(
        "ProjA.UxTests/Helpers/StringHelper.cs",
        `namespace ProjA.UxTests.Helpers;
public static class StringHelper
{
  public static string Trim(string s) => s.Trim();
}`,
      );

      const tree = await discoverProjectTests({
        projectName: "ProjA",
        slnPath: path.join(tmp, "ProjA.sln"),
        rootPath: tmp,
      });

      const happyFile = findFile(tree.root, [
        "ProjA.UxTests",
        "Tests",
        "LoginTestSuite.cs",
      ]);
      const baseFile = findFile(tree.root, [
        "ProjA.UxTests",
        "Tests",
        "BaseFixture.cs",
      ]);
      const helperFile = findFile(tree.root, [
        "ProjA.UxTests",
        "Helpers",
        "StringHelper.cs",
      ]);

      // (a) and (b) appear, (c) does not.
      expect(happyFile).not.toBeNull();
      expect(baseFile).not.toBeNull();
      expect(helperFile).toBeNull();

      // (a) has its [Test] method; (b) is fixture-only (no runnable
      // methods) so totals are zero but the file is still surfaced.
      expect(happyFile?.methods.map((m) => m.name)).toEqual(["HappyPath"]);
      expect(baseFile?.methods).toEqual([]);
      expect(baseFile?.totals.all).toBe(0);
    },
  );
});
