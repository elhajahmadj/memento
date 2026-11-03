/**
 * <TestsTreePanel /> — the Tests tab inside the workbench Explorer.
 *
 * Thin shell that wires the discovery query, selection state, view
 * filters (search + kind chips), and the Run-selected mutation
 * together. All rendering lives in focused subcomponents under
 * `./tests-tree-panel/`; all pure rules live under
 * `features/workbench/domain/tests-tree/`.
 *
 * The component never parses the opaque test IDs returned by
 * discovery and never re-orders the children (server response is
 * already deterministic).
 *
 * Selection state is persisted to `localStorage`, scoped per user +
 * project, via `useTestsTreeSelection`. Storage is best-effort —
 * any read/write error silently falls back to in-memory state.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  useDiscoverProjectTests,
  useRunProjectTestsBySelection,
  getDiscoverProjectTestsQueryKey,
} from "@workspace/api-client-react";
import type { TestKind } from "@workspace/api-client-react";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { ALL_KINDS } from "@/features/workbench/domain/tests-tree/kinds";
import {
  collectMethodIds,
  filterFolder,
} from "@/features/workbench/domain/tests-tree/tree-rules";
import { FolderRow } from "./tests-tree-panel/folder-row";
import {
  TestsTreeEmpty,
  TestsTreeError,
  TestsTreeLoading,
  TestsTreeNoMatches,
} from "./tests-tree-panel/tests-tree-status";
import { TestsTreeToolbar } from "./tests-tree-panel/tests-tree-toolbar";
import { useTestsTreeSelection } from "./tests-tree-panel/use-tests-tree-selection";

export function TestsTreePanel({ projectId }: { projectId: string | null }) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { selected, toggleOne, toggleMany } = useTestsTreeSelection(
    user?.id ?? null,
    projectId,
  );

  // Search + kind-chip filter state. Both are scoped to the panel
  // instance and reset when the project changes — they are *view*
  // controls, not user preferences, so we don't persist them.
  const [search, setSearch] = useState("");
  const [activeKinds, setActiveKinds] = useState<Set<TestKind>>(
    () => new Set(ALL_KINDS),
  );

  // Project switch clears the transient search/filter view state.
  // (Selection itself is restored from storage by the selection hook.)
  useEffect(() => {
    setSearch("");
    setActiveKinds(new Set(ALL_KINDS));
  }, [projectId]);

  const { data, isLoading, isError, error, refetch, isFetching } =
    useDiscoverProjectTests(projectId ?? "", {
      query: {
        enabled: !!projectId,
        queryKey: getDiscoverProjectTestsQueryKey(projectId ?? ""),
      },
    });

  const runMutation = useRunProjectTestsBySelection();

  const normalizedQuery = search.trim().toLowerCase();
  const filtersActive =
    normalizedQuery !== "" || activeKinds.size !== ALL_KINDS.length;

  const filteredRoot = useMemo(() => {
    if (!data) return null;
    if (!filtersActive) return data.root;
    return filterFolder(data.root, normalizedQuery, activeKinds, false);
  }, [data, filtersActive, normalizedQuery, activeKinds]);

  // Selection is kept globally so that toggling a filter doesn't
  // silently drop earlier picks, but every action that "operates on"
  // the selection — the count badge, the disabled state, and the
  // payload sent to Run selected — works on the *visible* intersection.
  const visibleIds = useMemo(
    () => new Set(filteredRoot ? collectMethodIds(filteredRoot) : []),
    [filteredRoot],
  );
  const visibleSelectedIds = useMemo(() => {
    const out: string[] = [];
    for (const id of selected) if (visibleIds.has(id)) out.push(id);
    return out;
  }, [selected, visibleIds]);

  const selectedCount = visibleSelectedIds.length;
  const isPending = runMutation.isPending;

  const handleRunSelected = useCallback(async () => {
    if (!projectId) return;
    const ids = visibleSelectedIds;
    if (ids.length === 0) return;
    try {
      const result = await runMutation.mutateAsync({
        projectId,
        data: { testIds: ids },
      });
      toast.success(
        `Queued ${ids.length} test${ids.length === 1 ? "" : "s"}`,
      );
      // The dispatcher returns one entry per language group; the first
      // is the natural landing page. The runs list lives at
      // `/tools/test-runs` for catching up on prior runs, but the
      // captured stdout/stderr — the bit SDETs actually need when a
      // dotnet/pytest/playwright invocation falls over — only lives on
      // the per-run detail surface.
      const firstRunId = result.runs[0]?.id;
      if (firstRunId) {
        navigate(
          `/tools/selection-runs/${encodeURIComponent(projectId)}/${firstRunId}`,
        );
      } else {
        navigate("/tools/test-runs");
      }
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to start selection run");
    }
  }, [projectId, visibleSelectedIds, runMutation, navigate]);

  const toggleKind = useCallback((kind: TestKind, next: boolean) => {
    setActiveKinds((prev) => {
      const out = new Set(prev);
      if (next) out.add(kind);
      else out.delete(kind);
      // Never let the user disable all three — fall back to "all on".
      if (out.size === 0) return new Set(ALL_KINDS);
      return out;
    });
  }, []);

  return (
    <div className="h-full flex flex-col">
      <TestsTreeToolbar
        selectedCount={selectedCount}
        isPending={isPending}
        canRun={selectedCount > 0 && !isPending && !!projectId}
        onRun={() => {
          void handleRunSelected();
        }}
        search={search}
        onSearchChange={setSearch}
        activeKinds={activeKinds}
        onToggleKind={toggleKind}
      />
      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading || (isFetching && !data) ? (
            <TestsTreeLoading />
          ) : isError ? (
            <TestsTreeError
              error={error as Error | null}
              onRetry={() => {
                void refetch();
              }}
            />
          ) : !data || data.root.totals.all === 0 ? (
            <TestsTreeEmpty />
          ) : !filteredRoot ? (
            <TestsTreeNoMatches />
          ) : (
            <FolderRow
              folder={filteredRoot}
              depth={0}
              selected={selected}
              toggleMany={toggleMany}
              toggleOne={toggleOne}
              isRoot
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
