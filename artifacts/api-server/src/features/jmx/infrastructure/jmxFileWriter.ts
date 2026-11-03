/**
 * Write an emitted `.jmx` plan to the project's `jmx/` folder and
 * index it in `.testbuilder.json#jmxFiles` so the workbench file
 * explorer can list it.
 *
 * Path resolution: the JMX recorder treats `projectId` as the URL-
 * encoded `slnPath` (the JMX marker file, `<workspace>/<name>/.jmxproject`).
 * The project root is the directory containing that marker.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  JMX_PROJECT_FILE,
  PROJECT_MARKER_FILE,
  projectDirFromSlnPath,
} from "@/features/projects/domain/paths";
import type { ProjectMarker } from "@/features/projects/domain/types";

const JMX_SUBDIR = "jmx";

export interface WriteJmxFileArgs {
  projectId: string;
  jmxFileName: string;
  xml: string;
}

export interface WriteJmxFileResult {
  /** Absolute path of the written `.jmx` file. */
  filePath: string;
  /** Path relative to the project root, stored in `.testbuilder.json#jmxFiles`. */
  relativePath: string;
}

/**
 * Resolve the project root directory from the recorder's opaque
 * `projectId` and enforce the workspace boundary.
 *
 * The recorder treats `projectId` as the URL-encoded slnPath of the JMX
 * marker file (`<workspaceDir>/<project>/.jmxproject`). An authenticated
 * caller could otherwise craft a `projectId` that points anywhere on
 * disk and steer the `.jmx` writer + marker updater outside the
 * workspace — so we resolve the candidate marker path, then route it
 * through `projectDirFromSlnPath`, which rejects anything that isn't
 * exactly one level under `recorderConfig.workspaceDir`.
 *
 * Throws "Project path is outside the workspace" when the input
 * resolves outside the workspace or to the workspace root itself.
 */
export function projectRootFromProjectId(projectId: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(projectId);
  } catch {
    decoded = projectId;
  }
  // Normalize to a `.jmxproject` marker path so `projectDirFromSlnPath`
  // can enforce the "one level under workspace" rule uniformly whether
  // the caller passed the marker file or the directory itself.
  const base = path.basename(decoded).toLowerCase();
  const markerPath =
    base === JMX_PROJECT_FILE ? decoded : path.join(decoded, JMX_PROJECT_FILE);
  return projectDirFromSlnPath(markerPath);
}

/** Sanitize a user-supplied filename and ensure a `.jmx` extension. */
export function normalizeJmxFileName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("jmxFileName is required");
  // Reject path traversal in the raw input (basename collapses `..`).
  if (trimmed.split(/[\\/]/).some((seg) => seg === ".." || seg === ".")) {
    throw new Error("jmxFileName must not contain '..'");
  }
  // Strip directory components — files always land under `jmx/`.
  const base = path.basename(trimmed);
  return base.toLowerCase().endsWith(".jmx") ? base : `${base}.jmx`;
}

export async function writeJmxFile(
  args: WriteJmxFileArgs,
): Promise<WriteJmxFileResult> {
  const root = projectRootFromProjectId(args.projectId);
  const fileName = normalizeJmxFileName(args.jmxFileName);
  const jmxDir = path.join(root, JMX_SUBDIR);
  await fs.mkdir(jmxDir, { recursive: true });
  const filePath = path.join(jmxDir, fileName);
  await fs.writeFile(filePath, args.xml, "utf8");
  const relativePath = path.posix.join(JMX_SUBDIR, fileName);
  await appendToMarkerIndex(root, relativePath);
  return { filePath, relativePath };
}

async function appendToMarkerIndex(
  root: string,
  relativePath: string,
): Promise<void> {
  const markerPath = path.join(root, PROJECT_MARKER_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(markerPath, "utf8");
  } catch {
    // Marker missing — the project may have been created outside the
    // normal scaffolder. Best-effort: skip the index update silently
    // so the .jmx file still lands on disk.
    return;
  }
  let parsed: ProjectMarker;
  try {
    parsed = JSON.parse(raw) as ProjectMarker;
  } catch {
    return;
  }
  const existing = Array.isArray(parsed.jmxFiles) ? parsed.jmxFiles : [];
  if (!existing.includes(relativePath)) existing.push(relativePath);
  parsed.jmxFiles = existing;
  await fs.writeFile(markerPath, JSON.stringify(parsed, null, 2));
}
