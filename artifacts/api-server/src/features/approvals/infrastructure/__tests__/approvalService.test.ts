import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";

// We import the module fresh for each test so we can mock @workspace/db.
type ApprovalServiceModule = typeof import("@/features/approvals/infrastructure/approvalService");

vi.mock("@workspace/db", () => {
  return {
    db: {},
    approvalSubmissionsTable: {},
    forksTable: {},
    usersTable: {},
  };
});

async function makeFile(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf8");
}

let tmp: string;
let originalWorkspace: string;
let svc: ApprovalServiceModule;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-approvalsvc-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  svc = await import("@/features/approvals/infrastructure/approvalService");
});

afterEach(async () => {
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("approvalService.computeChangedFiles conflict detection", () => {
  it("reports null mainChangedSinceSnapshot when no main-base file exists", async () => {
    const main = path.join(tmp, "main");
    const snap = path.join(tmp, ".approvals", "abc");
    await makeFile(path.join(main, "a.txt"), "one\n");
    await makeFile(path.join(snap, "a.txt"), "two\n");

    const files = await svc.computeChangedFiles({
      snapshotDir: snap,
      mainDir: main,
    });
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("a.txt");
    expect(files[0].mainChangedSinceSnapshot).toBeNull();
  });

  it("flags mainChangedSinceSnapshot=true when main file changed after snapshot", async () => {
    const main = path.join(tmp, "main");
    const snap = path.join(tmp, ".approvals", "abc");
    // main contained "one" at submit time, fork submitted "two", main now has "edit".
    await makeFile(path.join(main, "a.txt"), "one\n");
    await makeFile(path.join(snap, "a.txt"), "two\n");
    // Write the mainbase sidecar file as snapshotMainBase would:
    const baseHashes = {
      hashes: {
        "a.txt":
          require("node:crypto")
            .createHash("sha256")
            .update("one\n")
            .digest("hex"),
      },
    };
    await fs.writeFile(`${snap}.mainbase.json`, JSON.stringify(baseHashes));
    // Now edit main:
    await fs.writeFile(path.join(main, "a.txt"), "edit\n");

    const files = await svc.computeChangedFiles({
      snapshotDir: snap,
      mainDir: main,
    });
    expect(files[0].mainChangedSinceSnapshot).toBe(true);
  });

  it("flags mainChangedSinceSnapshot=false when main is untouched since snapshot", async () => {
    const main = path.join(tmp, "main");
    const snap = path.join(tmp, ".approvals", "abc");
    await makeFile(path.join(main, "a.txt"), "one\n");
    await makeFile(path.join(snap, "a.txt"), "two\n");
    const baseHashes = {
      hashes: {
        "a.txt":
          require("node:crypto")
            .createHash("sha256")
            .update("one\n")
            .digest("hex"),
      },
    };
    await fs.writeFile(`${snap}.mainbase.json`, JSON.stringify(baseHashes));

    const files = await svc.computeChangedFiles({
      snapshotDir: snap,
      mainDir: main,
    });
    expect(files[0].mainChangedSinceSnapshot).toBe(false);
  });

  it("flags conflict when a file added in main since snapshot would be deleted by approval", async () => {
    const main = path.join(tmp, "main");
    const snap = path.join(tmp, ".approvals", "abc");
    // Snapshot has only b.txt; main originally had only b.txt; main now has a NEW file added.
    await makeFile(path.join(snap, "b.txt"), "snap b\n");
    await makeFile(path.join(main, "b.txt"), "snap b\n");
    const baseHashes = {
      hashes: {
        "b.txt":
          require("node:crypto")
            .createHash("sha256")
            .update("snap b\n")
            .digest("hex"),
      },
    };
    await fs.writeFile(`${snap}.mainbase.json`, JSON.stringify(baseHashes));
    // After-the-fact, someone added c.txt to main:
    await makeFile(path.join(main, "c.txt"), "added in main\n");

    const files = await svc.computeChangedFiles({
      snapshotDir: snap,
      mainDir: main,
    });
    const c = files.find((f) => f.path === "c.txt");
    expect(c).toBeDefined();
    expect(c!.kind).toBe("deleted");
    expect(c!.mainChangedSinceSnapshot).toBe(true);
  });
});

describe("approvalService.diffLines (used by side-by-side rendering)", () => {
  it("classifies adds, dels, and context lines via LCS", () => {
    const lines = svc.diffLines("a\nb\nc\n", "a\nB\nc\n");
    const types = lines.map((l) => l.type);
    expect(types).toContain("context");
    expect(types).toContain("add");
    expect(types).toContain("del");
  });
});

describe("approvalService.computeChangedFilesWithConflictCount", () => {
  it("returns the count of conflicting files", async () => {
    const main = path.join(tmp, "main");
    const snap = path.join(tmp, ".approvals", "abc");
    await makeFile(path.join(main, "a.txt"), "a1\n");
    await makeFile(path.join(main, "b.txt"), "b1\n");
    await makeFile(path.join(snap, "a.txt"), "a2\n");
    await makeFile(path.join(snap, "b.txt"), "b2\n");
    const sha = (s: string) =>
      require("node:crypto").createHash("sha256").update(s).digest("hex");
    await fs.writeFile(
      `${snap}.mainbase.json`,
      JSON.stringify({ hashes: { "a.txt": sha("a1\n"), "b.txt": sha("b1\n") } }),
    );
    // Edit one of the main files to create a conflict for that file only:
    await fs.writeFile(path.join(main, "a.txt"), "a-edited\n");

    const result = await svc.computeChangedFilesWithConflictCount({
      snapshotDir: snap,
      mainDir: main,
    });
    expect(result.files).toHaveLength(2);
    expect(result.conflictCount).toBe(1);
  });
});
