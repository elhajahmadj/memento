import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  DEFAULT_HOOK_BACKUP_RETENTION,
  HOOK_BACKUP_RETENTION_MAX,
  HOOK_BACKUP_RETENTION_MIN,
  getHookBackupRetention,
  setHookBackupRetention,
  DEFAULT_VALIDATION_TRACE_RETENTION_DAYS,
  VALIDATION_TRACE_RETENTION_MAX,
  VALIDATION_TRACE_RETENTION_MIN,
  getValidationTraceRetentionDays,
  setValidationTraceRetentionDays,
} from "@/features/settings/infrastructure/settings";

let tmp: string;
let originalWorkspace: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-settings-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("hook backup retention setting", () => {
  it("returns the default when no settings file exists", async () => {
    expect(await getHookBackupRetention()).toBe(DEFAULT_HOOK_BACKUP_RETENTION);
  });

  it("persists and reads back a user-supplied value", async () => {
    const stored = await setHookBackupRetention(12);
    expect(stored).toBe(12);
    expect(await getHookBackupRetention()).toBe(12);

    // The on-disk file is human-readable JSON so the user can inspect it.
    const txt = await fs.readFile(
      path.join(tmp, ".testbuilder-settings.json"),
      "utf8",
    );
    expect(JSON.parse(txt).hookBackupRetention).toBe(12);
  });

  it("rejects non-integer values", async () => {
    await expect(setHookBackupRetention(3.5)).rejects.toThrow(/integer/);
    await expect(setHookBackupRetention(Number.NaN)).rejects.toThrow(/integer/);
  });

  it("rejects values outside the supported range", async () => {
    await expect(
      setHookBackupRetention(HOOK_BACKUP_RETENTION_MIN - 1),
    ).rejects.toThrow(/between/);
    await expect(
      setHookBackupRetention(HOOK_BACKUP_RETENTION_MAX + 1),
    ).rejects.toThrow(/between/);
  });

  it("falls back to the default when the stored value is malformed", async () => {
    await fs.writeFile(
      path.join(tmp, ".testbuilder-settings.json"),
      JSON.stringify({ hookBackupRetention: "lots" }),
    );
    expect(await getHookBackupRetention()).toBe(DEFAULT_HOOK_BACKUP_RETENTION);
  });

  it("clamps an out-of-range stored value into the supported range", async () => {
    await fs.writeFile(
      path.join(tmp, ".testbuilder-settings.json"),
      JSON.stringify({ hookBackupRetention: 9999 }),
    );
    expect(await getHookBackupRetention()).toBe(HOOK_BACKUP_RETENTION_MAX);
  });

  it("preserves other keys in the settings file when updating", async () => {
    await fs.writeFile(
      path.join(tmp, ".testbuilder-settings.json"),
      JSON.stringify({ hookBackupRetention: 4, somethingElse: "keep me" }),
    );
    await setHookBackupRetention(7);
    const txt = await fs.readFile(
      path.join(tmp, ".testbuilder-settings.json"),
      "utf8",
    );
    const parsed = JSON.parse(txt);
    expect(parsed.hookBackupRetention).toBe(7);
    expect(parsed.somethingElse).toBe("keep me");
  });
});

describe("validation trace retention setting", () => {
  it("returns the default when no settings file exists", async () => {
    expect(await getValidationTraceRetentionDays()).toBe(
      DEFAULT_VALIDATION_TRACE_RETENTION_DAYS,
    );
  });

  it("persists and reads back a user-supplied value", async () => {
    const stored = await setValidationTraceRetentionDays(30);
    expect(stored).toBe(30);
    expect(await getValidationTraceRetentionDays()).toBe(30);

    const txt = await fs.readFile(
      path.join(tmp, ".testbuilder-settings.json"),
      "utf8",
    );
    expect(JSON.parse(txt).validationTraceRetentionDays).toBe(30);
  });

  it("rejects non-integer values", async () => {
    await expect(setValidationTraceRetentionDays(3.5)).rejects.toThrow(
      /integer/,
    );
    await expect(setValidationTraceRetentionDays(Number.NaN)).rejects.toThrow(
      /integer/,
    );
  });

  it("rejects values outside the supported range", async () => {
    await expect(
      setValidationTraceRetentionDays(VALIDATION_TRACE_RETENTION_MIN - 1),
    ).rejects.toThrow(/between/);
    await expect(
      setValidationTraceRetentionDays(VALIDATION_TRACE_RETENTION_MAX + 1),
    ).rejects.toThrow(/between/);
  });

  it("falls back to the default when the stored value is malformed", async () => {
    await fs.writeFile(
      path.join(tmp, ".testbuilder-settings.json"),
      JSON.stringify({ validationTraceRetentionDays: "forever" }),
    );
    expect(await getValidationTraceRetentionDays()).toBe(
      DEFAULT_VALIDATION_TRACE_RETENTION_DAYS,
    );
  });

  it("clamps an out-of-range stored value into the supported range", async () => {
    await fs.writeFile(
      path.join(tmp, ".testbuilder-settings.json"),
      JSON.stringify({ validationTraceRetentionDays: 99999 }),
    );
    expect(await getValidationTraceRetentionDays()).toBe(
      VALIDATION_TRACE_RETENTION_MAX,
    );
  });

  it("preserves the hook backup retention when updating trace retention", async () => {
    await setHookBackupRetention(8);
    await setValidationTraceRetentionDays(14);
    const txt = await fs.readFile(
      path.join(tmp, ".testbuilder-settings.json"),
      "utf8",
    );
    const parsed = JSON.parse(txt);
    expect(parsed.hookBackupRetention).toBe(8);
    expect(parsed.validationTraceRetentionDays).toBe(14);
  });
});
