import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import type { ApprovalWorkspace } from "@/features/approvals/domain/ports/approvalWorkspace";

const APPROVALS_SUBDIR = ".approvals";
const MAIN_BASE_EXT = ".mainbase.json";
const MAIN_BASE_TREE_EXT = ".mainbase";

interface MainBaseRecord {
  hashes: Record<string, string>;
}

function mainBaseFile(snapshotDir: string): string {
  return `${snapshotDir}${MAIN_BASE_EXT}`;
}

function mainBaseTreeDir(snapshotDir: string): string {
  return `${snapshotDir}${MAIN_BASE_TREE_EXT}`;
}

export class FsApprovalWorkspace implements ApprovalWorkspace {
  approvalsRoot(): string {
    return path.join(recorderConfig.workspaceDir, APPROVALS_SUBDIR);
  }

  mainProjectDir(projectName: string): string {
    return path.join(recorderConfig.workspaceDir, projectName);
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  async listFilesRel(root: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dirAbs: string, prefix: string): Promise<void> => {
      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = await fs.readdir(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (recorderConfig.ignoreDirs.has(e.name)) continue;
        const childAbs = path.join(dirAbs, e.name);
        const childRel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(childAbs, childRel);
        else if (e.isFile()) out.push(childRel);
      }
    };
    if (await this.exists(root)) await walk(root, "");
    return out;
  }

  async readUtf8OrNull(p: string): Promise<string | null> {
    try {
      const buf = await fs.readFile(p);
      if (buf.length > 512 * 1024) return null;
      if (buf.includes(0)) return null;
      return buf.toString("utf8");
    } catch {
      return null;
    }
  }

  async fileSha256(p: string): Promise<string | null> {
    try {
      const buf = await fs.readFile(p);
      return crypto.createHash("sha256").update(buf).digest("hex");
    } catch {
      return null;
    }
  }

  private async copyTree(src: string, dst: string): Promise<void> {
    await fs.mkdir(dst, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      if (recorderConfig.ignoreDirs.has(entry.name)) continue;
      const from = path.join(src, entry.name);
      const to = path.join(dst, entry.name);
      if (entry.isDirectory()) await this.copyTree(from, to);
      else if (entry.isFile()) await fs.copyFile(from, to);
    }
  }

  async snapshotFork(forkPath: string, snapshotDir: string): Promise<void> {
    await this.copyTree(forkPath, snapshotDir);
  }

  async snapshotMainBase(
    mainDir: string,
    snapshotDir: string,
  ): Promise<void> {
    // Hash sidecar.
    try {
      const rels = await this.listFilesRel(mainDir);
      const hashes: Record<string, string> = {};
      for (const rel of rels) {
        const h = await this.fileSha256(path.join(mainDir, rel));
        if (h !== null) hashes[rel] = h;
      }
      const rec: MainBaseRecord = { hashes };
      await fs.writeFile(mainBaseFile(snapshotDir), JSON.stringify(rec), "utf8");
    } catch {
      // best-effort; absence simply disables conflict detection later.
    }
    // Full tree so historical diffs survive approve-and-merge.
    try {
      await this.copyTree(mainDir, mainBaseTreeDir(snapshotDir));
    } catch {
      // best-effort; route falls back to current main when missing.
    }
  }

  async loadMainBaseHashes(
    snapshotDir: string,
  ): Promise<Record<string, string> | null> {
    try {
      const text = await fs.readFile(mainBaseFile(snapshotDir), "utf8");
      const parsed = JSON.parse(text) as MainBaseRecord;
      if (!parsed || typeof parsed !== "object" || !parsed.hashes) return null;
      return parsed.hashes;
    } catch {
      return null;
    }
  }

  async diffBaseDir(
    snapshotDir: string,
    fallbackMainDir: string,
  ): Promise<string> {
    const treeDir = mainBaseTreeDir(snapshotDir);
    if (await this.exists(treeDir)) return treeDir;
    return fallbackMainDir;
  }

  async applySnapshotToMain(
    snapshotDir: string,
    mainDir: string,
    selectedFiles?: ReadonlySet<string>,
  ): Promise<{ written: number; deleted: number }> {
    const [snapList, mainList] = await Promise.all([
      this.listFilesRel(snapshotDir),
      this.listFilesRel(mainDir),
    ]);
    const snapSet = new Set(snapList);
    let written = 0;
    let deleted = 0;
    for (const rel of mainList) {
      if (snapSet.has(rel)) continue;
      if (selectedFiles && !selectedFiles.has(rel)) continue;
      await fs.rm(path.join(mainDir, rel), { force: true });
      deleted++;
    }
    for (const rel of snapList) {
      if (selectedFiles && !selectedFiles.has(rel)) continue;
      const from = path.join(snapshotDir, rel);
      const to = path.join(mainDir, rel);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
      written++;
    }
    return { written, deleted };
  }
}
