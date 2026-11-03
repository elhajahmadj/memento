import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface UpdateCall {
  traceRefIn: string[];
}

const updateCalls: UpdateCall[] = [];
let updatedRowIds: string[] = [];

vi.mock("@workspace/db", () => {
  // Minimal chainable stub mirroring the drizzle update().set().where().returning()
  // shape that runValidationTraceCleanup invokes. We capture the inArray
  // argument's column-value list so each test can assert on which trace
  // names the cleanup tried to null.
  const update = () => ({
    set: (_vals: unknown) => ({
      where: (cond: { __in?: string[] }) => ({
        returning: async (_cols: unknown) => {
          updateCalls.push({ traceRefIn: cond.__in ?? [] });
          return updatedRowIds.map((id) => ({ id }));
        },
      }),
    }),
  });
  return {
    db: { update },
    validationRunsTable: { traceRef: { __column: "traceRef" } },
  };
});

vi.mock("drizzle-orm", () => ({
  inArray: (_col: unknown, vals: string[]) => ({ __in: vals }),
}));

vi.mock("@/shared/logger", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

type CleanupModule = typeof import("@/features/validation/infrastructure/validationTraceCleanup");

let tmp: string;
let svc: CleanupModule;

async function writeFileWithMtime(
  p: string,
  contents: string,
  mtimeMs: number,
): Promise<void> {
  await fs.writeFile(p, contents);
  const t = mtimeMs / 1000;
  await fs.utimes(p, t, t);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "trace-cleanup-"));
  updateCalls.length = 0;
  updatedRowIds = [];
  svc = await import("@/features/validation/infrastructure/validationTraceCleanup");
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("getValidationTraceDirStats", () => {
  it("reports zero when the directory does not exist", async () => {
    const stats = await svc.getValidationTraceDirStats({
      dir: path.join(tmp, "missing"),
    });
    expect(stats.fileCount).toBe(0);
    expect(stats.totalBytes).toBe(0);
    expect(stats.dir).toBe(path.join(tmp, "missing"));
  });

  it("sums regular file sizes and counts them", async () => {
    const a = path.join(tmp, "a.zip");
    const b = path.join(tmp, "b-final.png");
    await fs.writeFile(a, "abcdefghij"); // 10 bytes
    await fs.writeFile(b, "xyz"); // 3 bytes
    await fs.mkdir(path.join(tmp, "subdir")); // ignored

    const stats = await svc.getValidationTraceDirStats({ dir: tmp });

    expect(stats.fileCount).toBe(2);
    expect(stats.totalBytes).toBe(13);
    expect(stats.dir).toBe(tmp);
  });
});

describe("getLastValidationTraceCleanupRun", () => {
  it("returns null until a sweep has actually finished", async () => {
    svc.resetLastValidationTraceCleanupRun();
    expect(svc.getLastValidationTraceCleanupRun()).toBeNull();
    // Calling runValidationTraceCleanup directly does NOT update the
    // last-run cache — only the scheduled in-process sweep does.
    await svc.runValidationTraceCleanup({
      dir: path.join(tmp, "missing"),
    });
    expect(svc.getLastValidationTraceCleanupRun()).toBeNull();
  });
});

describe("runValidationTraceCleanup", () => {
  it("returns zero counts when the directory does not exist", async () => {
    const result = await svc.runValidationTraceCleanup({
      dir: path.join(tmp, "missing"),
    });
    expect(result).toEqual({ filesDeleted: 0, rowsCleared: 0 });
    expect(updateCalls).toHaveLength(0);
  });

  it("leaves recent files alone", async () => {
    const now = Date.now();
    const recent = path.join(tmp, "fresh.zip");
    await writeFileWithMtime(recent, "z", now - 60_000);

    const result = await svc.runValidationTraceCleanup({ dir: tmp, now });

    expect(result.filesDeleted).toBe(0);
    expect(await fs.readdir(tmp)).toEqual(["fresh.zip"]);
    expect(updateCalls).toHaveLength(0);
  });

  it("deletes files older than the configured max age", async () => {
    const now = Date.now();
    const old = path.join(tmp, "abc.zip");
    const oldPng = path.join(tmp, "abc-final.png");
    const fresh = path.join(tmp, "def.zip");
    await writeFileWithMtime(old, "z", now - 10 * 24 * 60 * 60 * 1000);
    await writeFileWithMtime(oldPng, "p", now - 10 * 24 * 60 * 60 * 1000);
    await writeFileWithMtime(fresh, "z", now - 60_000);

    updatedRowIds = ["row-1"];
    const result = await svc.runValidationTraceCleanup({ dir: tmp, now });

    expect(result.filesDeleted).toBe(2);
    expect(result.rowsCleared).toBe(1);
    expect(await fs.readdir(tmp)).toEqual(["def.zip"]);
    // Only the .zip basename is forwarded to the DB cleanup — the PNG
    // is not tracked in traceRef.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.traceRefIn).toEqual(["abc.zip"]);
  });

  it("does not call the DB when no zip files were deleted", async () => {
    const now = Date.now();
    const onlyPng = path.join(tmp, "ghi-final.png");
    await writeFileWithMtime(onlyPng, "p", now - 10 * 24 * 60 * 60 * 1000);

    const result = await svc.runValidationTraceCleanup({ dir: tmp, now });

    expect(result.filesDeleted).toBe(1);
    expect(result.rowsCleared).toBe(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("uses the workspace setting for the cutoff when no override is given", async () => {
    // Point the settings module at the per-test temp dir so writing the
    // settings file there is what the cleanup will read.
    const { recorderConfig } = await import("@/features/projects/infrastructure/config");
    const originalWorkspace = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
    try {
      await fs.writeFile(
        path.join(tmp, ".testbuilder-settings.json"),
        JSON.stringify({ validationTraceRetentionDays: 30 }),
      );
      const dir = path.join(tmp, "traces");
      await fs.mkdir(dir);
      const now = Date.now();
      const justUnder = path.join(dir, "keep.zip");
      const wellOver = path.join(dir, "drop.zip");
      // 20 days old — under the 30-day window, must survive.
      await writeFileWithMtime(justUnder, "z", now - 20 * 24 * 60 * 60 * 1000);
      // 40 days old — past the 30-day window, must be deleted.
      await writeFileWithMtime(wellOver, "z", now - 40 * 24 * 60 * 60 * 1000);

      const result = await svc.runValidationTraceCleanup({ dir, now });

      expect(result.filesDeleted).toBe(1);
      expect((await fs.readdir(dir)).sort()).toEqual(["keep.zip"]);
    } finally {
      recorderConfig.workspaceDir = originalWorkspace;
    }
  });

  it("respects a custom maxAgeMs override", async () => {
    const now = Date.now();
    const file = path.join(tmp, "x.zip");
    await writeFileWithMtime(file, "z", now - 2 * 60 * 60 * 1000); // 2h old

    // 1h cutoff should sweep it; 3h cutoff should not.
    const r1 = await svc.runValidationTraceCleanup({
      dir: tmp,
      now,
      maxAgeMs: 3 * 60 * 60 * 1000,
    });
    expect(r1.filesDeleted).toBe(0);
    await writeFileWithMtime(file, "z", now - 2 * 60 * 60 * 1000);

    const r2 = await svc.runValidationTraceCleanup({
      dir: tmp,
      now,
      maxAgeMs: 60 * 60 * 1000,
    });
    expect(r2.filesDeleted).toBe(1);
  });
});
