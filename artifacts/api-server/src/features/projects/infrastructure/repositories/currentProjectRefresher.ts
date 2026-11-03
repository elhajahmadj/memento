import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_MARKER_FILE } from "../../domain/paths";
import type { Project, ProjectMarker } from "../../domain/types";
import { logger } from "@/shared/logger";
import {
  forEachCurrentProject,
  getCurrentProject,
  setCurrentProject,
} from "./currentProjectStore";

/**
 * Re-read the project marker (`.testbuilder.json`) for the project the
 * given user currently has open and replace the cached snapshot in
 * `currentProjectStore` with a fresh copy.
 *
 * Why this exists: the workbench reads project state — `jmxFiles`,
 * `targetUrl`, `bff`, etc — from `GET /api/projects/current`, which
 * serves the in-memory snapshot taken at `loadProject` time. Anything
 * that writes into `.testbuilder.json` after that point (the JMX
 * recorder emitting a new `.jmx`, the JMX clearer resetting
 * `jmxFiles: []`, future emitters) leaves the cache stale and the
 * workbench's panels lag behind disk until the user reloads or
 * switches projects. Calling this helper after a disk mutation keeps
 * the two in sync.
 *
 * Best-effort by design: a missing cache entry (user has no project
 * open), a missing marker, or a parse failure all silently skip — the
 * on-disk write has already happened, and the next `loadProject` will
 * pick it up. Identity fields (`rootPath`, `slnPath`, `solutionName`,
 * `language`) are preserved from the cached project; only the
 * marker-mirrored mutable fields are refreshed.
 */
export async function refreshCurrentProjectFromDisk(
  userId: string,
): Promise<void> {
  const cached = getCurrentProject(userId);
  if (!cached) return;
  const refreshed = await rereadProjectFromDisk(cached);
  if (!refreshed) return;
  setCurrentProject(refreshed, userId);
}

/**
 * Same as `refreshCurrentProjectFromDisk` but driven by a project root
 * path instead of a user id. Refreshes every cached current-project
 * entry whose `rootPath` matches the given root. Used by writers like
 * the JMX clearer that mutate a project's marker without knowing which
 * user(s) have it open.
 */
export async function refreshCurrentProjectFromDiskByRoot(
  rootPath: string,
): Promise<void> {
  const target = path.resolve(rootPath);
  const matches: Array<{ key: string; project: Project }> = [];
  forEachCurrentProject((key, project) => {
    if (path.resolve(project.rootPath) === target) {
      matches.push({ key, project });
    }
  });
  for (const { key, project } of matches) {
    const refreshed = await rereadProjectFromDisk(project);
    if (refreshed) setCurrentProject(refreshed, key);
  }
}

async function rereadProjectFromDisk(
  cached: Project,
): Promise<Project | null> {
  const markerPath = path.join(cached.rootPath, PROJECT_MARKER_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(markerPath, "utf8");
  } catch {
    return null;
  }
  let parsed: ProjectMarker;
  try {
    parsed = JSON.parse(raw) as ProjectMarker;
  } catch (err) {
    logger.warn(
      { err, rootPath: cached.rootPath },
      "currentProjectRefresher: failed to parse project marker",
    );
    return null;
  }
  return mergeMarkerIntoProject(cached, parsed);
}

/**
 * Overlay marker-mirrored mutable fields onto a cached `Project`,
 * leaving identity fields (rootPath/slnPath/solutionName/language)
 * untouched. Mirrors the JMX branch of `detectProjectInfo` so the
 * cache shape after a refresh equals what a fresh `loadProject`
 * would have produced.
 */
function mergeMarkerIntoProject(
  cached: Project,
  marker: ProjectMarker,
): Project {
  const next: Project = { ...cached };
  if (cached.language === "jmx") {
    next.jmxFiles = Array.isArray(marker.jmxFiles) ? marker.jmxFiles : [];
    next.jmxEmbedCredentials = marker.jmxExport?.embedCredentials === true;
    if (typeof marker.targetUrl === "string" && marker.targetUrl) {
      next.targetUrl = marker.targetUrl;
    } else {
      delete next.targetUrl;
    }
    if (typeof marker.jwtAuth === "boolean") next.jwtAuth = marker.jwtAuth;
    else delete next.jwtAuth;
    if (typeof marker.bff === "boolean") next.bff = marker.bff;
    else delete next.bff;
  }
  return next;
}
