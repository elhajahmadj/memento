import fs from "node:fs/promises";
import path from "node:path";
import {
  JMX_PROJECT_FILE,
  PROJECT_MARKER_FILE,
} from "../../domain/paths";
import type { Project } from "../../domain/types";
import type { ProjectMarker } from "../../domain/types";
import { refreshCurrentProjectFromDiskByRoot } from "../repositories/currentProjectRefresher";

/**
 * Clear every user-recorded artifact inside a JMX project while
 * preserving the scaffolded skeleton:
 *
 *   - keep `.jmxproject` sentinel
 *   - keep `.testbuilder.json` (but reset `jmxFiles: []`)
 *   - delete every other file/folder at the project root (captured
 *     events store, emitted `.jmx` plans, sidecars dropped by the
 *     recorder / emitter slices)
 *
 * Re-creating the project after clearing should produce the same
 * on-disk shape as a fresh scaffold.
 */
export async function clearJmxFiles(project: Project): Promise<void> {
  const root = project.rootPath;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === JMX_PROJECT_FILE) continue;
    if (entry.name === PROJECT_MARKER_FILE) continue;
    const target = path.join(root, entry.name);
    try {
      await fs.rm(target, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  // Reset emitted-file list in the marker, preserving every other field.
  try {
    const markerPath = path.join(root, PROJECT_MARKER_FILE);
    const raw = await fs.readFile(markerPath, "utf8");
    const parsed = JSON.parse(raw) as ProjectMarker;
    parsed.jmxFiles = [];
    await fs.writeFile(markerPath, JSON.stringify(parsed, null, 2));
  } catch {
    // marker missing or malformed — leave alone
  }

  // Keep every workbench session that has this project open in sync
  // with the just-emptied `jmxFiles` index — otherwise the next
  // `/api/projects/current` poll keeps returning the pre-clear list
  // until the user reloads.
  await refreshCurrentProjectFromDiskByRoot(root);
}
