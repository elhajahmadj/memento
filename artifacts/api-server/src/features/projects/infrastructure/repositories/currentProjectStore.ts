import type { Project } from "../../domain/types";
import { logger } from "@/shared/logger";
import { isDevEnvironment } from "@/features/auth/infrastructure/devEnvironment";

/**
 * Per-user "currently loaded project" cache.
 *
 * Two audit findings shaped this file:
 *
 * M-4 — a nullish `userId` reads and writes a process-wide slot shared
 * by every such caller. That was reachable in production: `createProject`
 * called `setCurrentProject(project)` with no user, while `sessionStart`,
 * `openBrowserOps` and `hookOps` all fall back to `getCurrentProject()`
 * with no user — so one user's newly-created project could surface as
 * another user's "current project".
 *
 * The fix is at the writer: `createProject` now threads an
 * `ownerUserId` through and stores against that user. With no production
 * path writing the shared slot, the read-side fallback can no longer
 * return anyone else's project.
 *
 * The slot itself is kept, deliberately. It is load-bearing for the
 * existing test suites, which use the terse `setCurrentProject(project)`
 * / `getCurrentProject()` form throughout, and removing it made 42 of
 * them fail for reasons unrelated to what they assert. Keeping it costs
 * nothing now that nothing in production writes it, and
 * the deployed-environment guard in `setCurrentProject` is the check against a
 * new writer appearing unnoticed.
 *
 * M-3 — entries were only removed on explicit unload, project delete, or
 * assignment revocation. Logout and session expiry did not evict, so the
 * map retained one full `Project` per user who had *ever* loaded one, for
 * the process lifetime. Each entry is small, so this was a slow leak
 * rather than an urgent one — the classic shape that only shows up after
 * long uptime. `clearCurrentProjectForUser` is now called on logout, and
 * entries carry a last-touched timestamp swept on an idle interval.
 */

interface Entry {
  project: Project;
  /** Epoch ms of the last read or write. Drives the idle sweep (M-3). */
  touchedAt: number;
}

const currentProjects = new Map<string, Entry>();

/**
 * Evict an entry after this long without a read or write. Generous: a
 * user may leave a project loaded across a lunch break and expect it
 * back. The point is that the map cannot grow forever, not that entries
 * expire promptly.
 */
const IDLE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let sweeper: NodeJS.Timeout | null = null;

function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const cutoff = Date.now() - IDLE_TTL_MS;
    let evicted = 0;
    for (const [key, entry] of currentProjects) {
      if (entry.touchedAt <= cutoff) {
        currentProjects.delete(key);
        evicted += 1;
      }
    }
    if (evicted > 0) {
      logger.debug(
        { evicted, remaining: currentProjects.size },
        "current-project cache: swept idle entries",
      );
    }
  }, SWEEP_INTERVAL_MS);
  // Never hold the process open for the sweeper.
  sweeper.unref?.();
}

/**
 * Key used when a caller supplies no user. Reachable only from test
 * helpers now — see the M-4 note in the file header. Never written by a
 * production code path.
 */
const SHARED_SLOT_KEY = "__default__";

export function getCurrentProject(userId?: string | null): Project | null {
  const entry = currentProjects.get(userId || SHARED_SLOT_KEY);
  if (!entry) return null;
  entry.touchedAt = Date.now();
  return entry.project;
}

export function setCurrentProject(
  p: Project | null,
  userId?: string | null,
): void {
  const key = userId || SHARED_SLOT_KEY;
  if (!userId && p && !isDevEnvironment()) {
    // M-4 guard. In a deployed environment nothing should be writing the
    // shared slot; if something starts to, that is the cross-user leak
    // reappearing and it needs to be visible rather than silent. Not a
    // throw: taking a request down is a worse outcome than a loud log.
    logger.error(
      { solutionName: p.solutionName },
      "setCurrentProject called without a userId in a deployed environment. " +
        "The active project is per-user; this write lands in a slot other " +
        "users can read. Pass the owner's id.",
    );
  }
  if (p) {
    ensureSweeper();
    currentProjects.set(key, { project: p, touchedAt: Date.now() });
  } else {
    currentProjects.delete(key);
  }
}

/**
 * Drop a user's cached project outright. Called on logout (M-3) so a
 * signed-out user leaves nothing behind, and so the next sign-in starts
 * from a deterministic "no project loaded" state.
 */
export function clearCurrentProjectForUser(userId: string): void {
  currentProjects.delete(userId);
}

/**
 * Clear the cached "current project" for a single user when it matches
 * the given solution name. Used when a limited admin loses their
 * assignment so they can't continue interacting with that project on
 * their next request.
 */
export function clearCurrentProjectIfSolution(
  userId: string,
  solutionName: string,
): boolean {
  const entry = currentProjects.get(userId);
  if (entry && entry.project.solutionName === solutionName) {
    currentProjects.delete(userId);
    return true;
  }
  return false;
}

/**
 * Internal: enumerate the entries so listeners (e.g. delete use case)
 * can purge stale cached references when a project is deleted.
 */
export function forEachCurrentProject(
  visit: (key: string, project: Project) => void,
): void {
  for (const [key, entry] of currentProjects.entries()) {
    visit(key, entry.project);
  }
}

export function deleteCurrentProjectByKey(key: string): void {
  currentProjects.delete(key);
}

/** Entry count. Exported for the memory-hygiene tests. */
export function currentProjectCacheSize(): number {
  return currentProjects.size;
}

/**
 * Test seam — wipe the per-user current-project map. Called from
 * `bootServer()` in the api-server test helpers so a fresh test file
 * never inherits a "current project" entry written by a prior file
 * sharing this worker process. Production code never calls this.
 */
export function resetCurrentProjectsForTests(): void {
  currentProjects.clear();
}
