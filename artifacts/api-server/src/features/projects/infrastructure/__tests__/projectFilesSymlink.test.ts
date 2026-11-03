import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createFolder,
  readFile,
  writeFile,
} from "@/features/projects/infrastructure/projectFiles";
import type { Project } from "@/features/projects/domain/types";

/**
 * Symlink containment for user-supplied paths (audit finding M-7).
 *
 * `safeJoin` is a purely lexical guard — it normalizes, rejects `..` and
 * absolute inputs, and string-compares against the root. It cannot see a
 * symlink, because `path.resolve` never touches the filesystem, so a link
 * inside the project pointing outside it produces a path that passes
 * every one of those checks. Users can create files and folders in their
 * project, and trees also arrive by clone/fork/extract, so the escape is
 * reachable.
 *
 * Symlink creation needs elevated privileges on Windows, so the
 * symlink-dependent cases use `it.skipIf` and are reported as SKIPPED
 * there rather than as passes. On Linux (CI, Docker) they run for real.
 */

let root: string;
let outside: string;
let project: Project;

beforeEach(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "symlink-guard-"));
  root = path.join(base, "project");
  outside = path.join(base, "outside");
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, "secret.txt"), "OTHER TENANT DATA");
  project = {
    solutionName: "SymGuard",
    testProjectName: "SymGuard.Tests",
    namespace: "SymGuard",
    rootPath: root,
    slnPath: path.join(root, "SymGuard.sln"),
    language: "csharp",
  } as Project;
});

afterEach(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

/**
 * Whether this host can create symlinks at all, probed once at module
 * load. Windows needs elevated privileges or Developer Mode, so these
 * cases cannot run there.
 *
 * Drives `it.skipIf` rather than an early `return` inside each case: a
 * case that returns early is reported as **passed**, which reads exactly
 * like a case that actually verified something. Skipped shows up as
 * skipped in the summary, so nobody mistakes an unexercised guard for a
 * verified one.
 */
const SYMLINKS_UNSUPPORTED = (() => {
  const probe = nodeFs.mkdtempSync(path.join(os.tmpdir(), "symlink-probe-"));
  try {
    nodeFs.mkdirSync(path.join(probe, "t"));
    nodeFs.symlinkSync(path.join(probe, "t"), path.join(probe, "l"), "dir");
    return false;
  } catch {
    return true;
  } finally {
    nodeFs.rmSync(probe, { recursive: true, force: true });
  }
})();

/** Create a symlink. Only called when symlinks are supported. */
async function trySymlink(
  target: string,
  linkPath: string,
  type: "dir" | "file",
): Promise<boolean> {
  try {
    await fs.symlink(target, linkPath, type);
    return true;
  } catch {
    return false;
  }
}

describe("projectFiles — symlink escape (M-7)", () => {
  it.skipIf(SYMLINKS_UNSUPPORTED)("refuses to read through a directory symlink that leaves the project", async () => {
    const link = path.join(root, "escape");
    expect(await trySymlink(outside, link, "dir")).toBe(true);

    await expect(readFile(project, "escape/secret.txt")).rejects.toThrow(
      /escapes project root/i,
    );
  });

  it.skipIf(SYMLINKS_UNSUPPORTED)("refuses to write through a directory symlink that leaves the project", async () => {
    const link = path.join(root, "escape");
    expect(await trySymlink(outside, link, "dir")).toBe(true);

    await expect(
      writeFile(project, "escape/planted.txt", "written by another tenant"),
    ).rejects.toThrow(/escapes project root/i);

    // And nothing was actually written outside.
    await expect(
      fs.readFile(path.join(outside, "planted.txt"), "utf8"),
    ).rejects.toThrow();
  });

  it.skipIf(SYMLINKS_UNSUPPORTED)("refuses to read through a file symlink that leaves the project", async () => {
    const link = path.join(root, "leak.txt");
    expect(await trySymlink(path.join(outside, "secret.txt"), link, "file")).toBe(true);

    await expect(readFile(project, "leak.txt")).rejects.toThrow(
      /escapes project root/i,
    );
  });

  it("still allows ordinary paths inside the project", async () => {
    await writeFile(project, "Tests/Ordinary.cs", "// fine\n");
    expect(await readFile(project, "Tests/Ordinary.cs")).toBe("// fine\n");
  });

  it("still allows creating a nested folder inside the project", async () => {
    await createFolder(project, "Tests/Nested/Deeper");
    const stat = await fs.stat(path.join(root, "Tests", "Nested", "Deeper"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("still rejects plain ../ traversal (the lexical guard)", async () => {
    await expect(readFile(project, "../outside/secret.txt")).rejects.toThrow(
      /Unsafe path|escapes project root/i,
    );
  });

  it.skipIf(SYMLINKS_UNSUPPORTED)("allows a symlink that stays inside the project", async () => {
    await fs.mkdir(path.join(root, "real"), { recursive: true });
    await fs.writeFile(path.join(root, "real", "ok.txt"), "inside\n");
    const link = path.join(root, "alias");
    expect(await trySymlink(path.join(root, "real"), link, "dir")).toBe(true);

    // Containment, not a blanket symlink ban — an in-project link is fine.
    expect(await readFile(project, "alias/ok.txt")).toBe("inside\n");
  });
});
