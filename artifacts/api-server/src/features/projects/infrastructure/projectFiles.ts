/**
 * Filesystem CRUD helpers for the projects feature.
 *
 * Extracted out of `projectService.ts` so that downstream consumers
 * (notably the language codegen modules under `features/codegen/`)
 * can depend on the file-IO surface without pulling in
 * `projectService.ts`, which transitively wires the projects-feature
 * use cases (one of which depends back on codegen) and would otherwise
 * form a cycle.
 *
 * `projectService.ts` re-exports every function here so its existing
 * throw-style API is unchanged.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { Project } from "@/features/projects/domain/types";

/**
 * Symlink-aware containment check (audit finding M-7).
 *
 * `safeJoin` is a *lexical* guard: it normalizes the path, rejects `..`
 * and absolute inputs, and verifies the resolved string sits under the
 * project root. What it cannot see is a symlink — `path.resolve` never
 * touches the filesystem, so a link inside the project pointing outside
 * it resolves to a string that passes every one of those checks.
 *
 * That matters because users can create files and folders in their
 * project, and a project tree can also arrive by clone, fork, or archive
 * extraction. Without this, `GET /api/files?path=link/…` would read, and
 * `PUT` would write, anywhere the `pwuser` account can reach on the
 * shared `/data` volume — which holds every tenant's projects.
 *
 * Applied here rather than inside `safeJoin` on purpose: `safeJoin` has
 * ~130 call sites, nearly all of them building server-generated codegen
 * paths that are not attacker-influenced, and making it async to add an
 * `fs` call would churn all of them. These CRUD helpers are the boundary
 * where a *user-supplied* relative path reaches the filesystem, so this
 * is where the check belongs.
 *
 * Resolves the nearest existing ancestor, so it works for a path being
 * created as well as one being read.
 */
async function assertRealPathWithinRoot(
  rootPath: string,
  absPath: string,
): Promise<void> {
  const realRoot = await fs.realpath(rootPath).catch(() => path.resolve(rootPath));

  // Walk up to the nearest component that exists — for a create, the
  // leaf (and possibly some parents) won't yet.
  let probe = absPath;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      const rest = path.relative(probe, absPath);
      const candidate = rest ? path.join(real, rest) : real;
      if (
        candidate !== realRoot &&
        !candidate.startsWith(realRoot + path.sep)
      ) {
        throw new Error(`Path escapes project root: ${absPath}`);
      }
      return;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Path escapes")) {
        throw err;
      }
      const parent = path.dirname(probe);
      if (parent === probe) {
        // Walked to the filesystem root without finding anything real.
        throw new Error(`Path escapes project root: ${absPath}`);
      }
      probe = parent;
    }
  }
}

/**
 * `safeJoin` plus the symlink check. Use for any path that originated in
 * a request.
 */
async function safeJoinChecked(
  rootPath: string,
  relPath: string,
): Promise<string> {
  const abs = safeJoin(rootPath, relPath);
  await assertRealPathWithinRoot(rootPath, abs);
  return abs;
}

export async function readFile(
  project: Project,
  relPath: string,
): Promise<string> {
  const abs = await safeJoinChecked(project.rootPath, relPath);
  return fs.readFile(abs, "utf8");
}

export async function writeFile(
  project: Project,
  relPath: string,
  content: string,
): Promise<void> {
  const abs = await safeJoinChecked(project.rootPath, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

export async function createFile(
  project: Project,
  relPath: string,
  content: string,
): Promise<void> {
  const abs = await safeJoinChecked(project.rootPath, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, { flag: "wx" });
}

export async function deleteFile(
  project: Project,
  relPath: string,
): Promise<void> {
  const abs = await safeJoinChecked(project.rootPath, relPath);
  if (abs === path.resolve(project.rootPath)) {
    throw new Error("Cannot delete project root");
  }
  await fs.rm(abs, { recursive: true, force: true });
}

export async function rename(
  project: Project,
  oldRel: string,
  newRel: string,
): Promise<void> {
  const oldAbs = await safeJoinChecked(project.rootPath, oldRel);
  const newAbs = await safeJoinChecked(project.rootPath, newRel);
  await fs.mkdir(path.dirname(newAbs), { recursive: true });
  await fs.rename(oldAbs, newAbs);
}

export async function createFolder(
  project: Project,
  relPath: string,
): Promise<void> {
  const abs = await safeJoinChecked(project.rootPath, relPath);
  await fs.mkdir(abs, { recursive: true });
}
