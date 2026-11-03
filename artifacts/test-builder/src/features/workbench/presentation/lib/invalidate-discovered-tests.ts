import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidate every "discover project tests" query in the cache,
 * regardless of which project id it was keyed by. Used by the file
 * mutation flows (finalize recording, add test method, save edits in
 * the code viewer, rename/delete/create files and folders) so the
 * Test Explorer reflects newly added/renamed/removed tests right away
 * without waiting for a window-focus refetch or page reload.
 *
 * The discover query is keyed as `["/api/projects/<projectId>/tests"]`
 * (see `getDiscoverProjectTestsQueryKey` in the generated client),
 * which we match by predicate so we don't need the project id at the
 * call site.
 */
export function invalidateDiscoveredTests(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({
    predicate: (q) => {
      const key = q.queryKey;
      if (!Array.isArray(key) || key.length === 0) return false;
      const head = key[0];
      return (
        typeof head === "string" &&
        head.startsWith("/api/projects/") &&
        head.endsWith("/tests")
      );
    },
  });
}
