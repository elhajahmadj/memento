/**
 * Selection state + persistence for the tests-tree panel.
 *
 * Wraps the `(user, project)`-scoped localStorage helpers and exposes
 * a stable `toggleOne` / `toggleMany` API. Selection reloads from
 * storage whenever the scope key changes (user changes, project
 * switch) so each pair sees its own remembered picks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  readPersistedSelection,
  selectionStorageKey,
  writePersistedSelection,
} from "@/features/workbench/domain/tests-tree/selection-storage";

export interface TestsTreeSelectionApi {
  selected: Set<string>;
  toggleOne: (id: string, next: boolean) => void;
  toggleMany: (ids: string[], next: boolean) => void;
}

export function useTestsTreeSelection(
  userId: string | null | undefined,
  projectId: string | null,
): TestsTreeSelectionApi {
  const storageKey = useMemo(
    () => selectionStorageKey(userId, projectId),
    [userId, projectId],
  );
  const [selected, setSelected] = useState<Set<string>>(() =>
    readPersistedSelection(storageKey),
  );

  // Reload from storage when the (user, project) pair changes — both
  // because we want each project to remember its own picks and to
  // avoid bleeding one user's selection into another's session if
  // auth changes mid-flight.
  const lastKeyRef = useRef<string | null>(storageKey);
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return;
    lastKeyRef.current = storageKey;
    setSelected(readPersistedSelection(storageKey));
  }, [storageKey]);

  // Persist on every selection change. Empty selections clear the
  // entry so we don't leave dead keys around forever.
  useEffect(() => {
    writePersistedSelection(storageKey, selected);
  }, [storageKey, selected]);

  const toggleOne = useCallback((id: string, next: boolean) => {
    setSelected((prev) => {
      const out = new Set(prev);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });
  }, []);

  const toggleMany = useCallback((ids: string[], next: boolean) => {
    setSelected((prev) => {
      const out = new Set(prev);
      if (next) for (const id of ids) out.add(id);
      else for (const id of ids) out.delete(id);
      return out;
    });
  }, []);

  return { selected, toggleOne, toggleMany };
}
