import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { RecordedActionMsg } from "@/features/workbench/domain/types";

/**
 * Wires the actions feed to the global `recorder:*` window event bus.
 *
 * Listens for server-broadcast updates (new actions, renames, deletes,
 * undeletes, feed resets, hover/focus sync, keyboard escape, and the
 * right-panel toolbar's "open insert shared step" request) and routes
 * them through the setters passed in by the container.
 *
 * `itemRefs` is a Map of server-assigned index → row element used to
 * scroll into view on focus and to drop entries when rows are deleted.
 *
 * Re-binds when `items` or `focusedIndex` change so the
 * "open insert shared step" handler always closes over the latest
 * values; the other handlers only mutate state via setState so an
 * empty deps array would also be safe for them — mixed deps are easier
 * to reason about than two separate effects.
 */
export function useActionsFeedEvents({
  items,
  focusedIndex,
  itemRefs,
  setItems,
  setSelected,
  setLastSelectedIndex,
  setFocusedIndex,
  setHoveredIndex,
  setInsertSharedPosition,
  setInsertSharedOpen,
}: {
  items: RecordedActionMsg[];
  focusedIndex: number | null;
  itemRefs: MutableRefObject<Map<number, HTMLDivElement>>;
  setItems: Dispatch<SetStateAction<RecordedActionMsg[]>>;
  setSelected: Dispatch<SetStateAction<Set<number>>>;
  setLastSelectedIndex: Dispatch<SetStateAction<number | null>>;
  setFocusedIndex: Dispatch<SetStateAction<number | null>>;
  setHoveredIndex: Dispatch<SetStateAction<number | null>>;
  setInsertSharedPosition: Dispatch<
    SetStateAction<{
      liveCount: number;
      focusedIndex: number | null;
      focusedLabel: string | null;
    } | null>
  >;
  setInsertSharedOpen: Dispatch<SetStateAction<boolean>>;
}): void {
  useEffect(() => {
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<RecordedActionMsg | "reset">;
      if (e.detail === "reset") {
        setItems([]);
        setSelected(new Set());
        setLastSelectedIndex(null);
      } else setItems((prev) => [...prev, e.detail as RecordedActionMsg]);
    };
    const namedHandler = (ev: Event) => {
      const e = ev as CustomEvent<{
        index: number;
        methodName: string;
        decoratedMethodName?: string | null;
      }>;
      const { index, methodName, decoratedMethodName } = e.detail;
      setItems((prev) =>
        prev.map((it) =>
          it.index === index
            ? {
                ...it,
                methodName,
                ...(typeof decoratedMethodName === "string"
                  ? { decoratedMethodName }
                  : decoratedMethodName === null
                    ? { decoratedMethodName: null }
                    : {}),
              }
            : it,
        ),
      );
    };
    // Undoing a rename can either restore a previous custom name (string)
    // or revert to the auto-generated suggestion (null). In the null
    // case we strip `methodName` from the item so the feed falls back to
    // displaying `suggestedMethodName`, matching what the body preview
    // and code generation will use. For C# the server also sends the
    // restored decorated form so the displayed `${Verb}${Noun}Async`
    // updates atomically.
    const nameUndoneHandler = (ev: Event) => {
      const e = ev as CustomEvent<{
        index: number;
        methodName: string | null;
        decoratedMethodName?: string | null;
      }>;
      const { index, methodName, decoratedMethodName } = e.detail;
      setItems((prev) =>
        prev.map((it) => {
          if (it.index !== index) return it;
          const next: RecordedActionMsg = { ...it };
          if (methodName === null) {
            delete next.methodName;
          } else {
            next.methodName = methodName;
          }
          if (typeof decoratedMethodName === "string") {
            next.decoratedMethodName = decoratedMethodName;
          } else if (decoratedMethodName === null) {
            delete next.decoratedMethodName;
          }
          return next;
        }),
      );
    };
    const deletedHandler = (ev: Event) => {
      const e = ev as CustomEvent<{ index: number }>;
      const { index } = e.detail;
      setItems((prev) => prev.filter((it) => it.index !== index));
      // Drop the ref entry and clear focus if it pointed at the removed row.
      itemRefs.current.delete(index);
      setFocusedIndex((curr) => (curr === index ? null : curr));
      setSelected((prev) => {
        if (!prev.has(index)) return prev;
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      setLastSelectedIndex((curr) => (curr === index ? null : curr));
    };
    const undeletedHandler = (ev: Event) => {
      const e = ev as CustomEvent<{ item: RecordedActionMsg }>;
      const item = e.detail.item;
      if (typeof item.index !== "number") return;
      const idx = item.index;
      setItems((prev) => {
        if (prev.some((it) => it.index === idx)) return prev;
        // Insert back at the position that keeps the feed sorted by the
        // server-assigned index, matching where the row originally lived.
        let insertAt = prev.findIndex(
          (it) => typeof it.index === "number" && it.index > idx,
        );
        if (insertAt === -1) insertAt = prev.length;
        const next = prev.slice();
        next.splice(insertAt, 0, item);
        return next;
      });
    };
    const feedResetHandler = (ev: Event) => {
      const e = ev as CustomEvent<{ items: RecordedActionMsg[] }>;
      const nextItems = Array.isArray(e.detail?.items) ? e.detail.items : [];
      setItems(nextItems);
      // Reorder/insert/edit invalidates per-row state that referenced the
      // old index ordering. Drop selection + focus so a stale checkbox
      // doesn't apply to the wrong (now-different) row.
      setSelected(new Set());
      setLastSelectedIndex(null);
      setFocusedIndex(null);
      itemRefs.current.clear();
    };
    const hoverHandler = (ev: Event) => {
      const e = ev as CustomEvent<{ index: number | null }>;
      setHoveredIndex(
        typeof e.detail?.index === "number" ? e.detail.index : null,
      );
    };
    const focusHandler = (ev: Event) => {
      const e = ev as CustomEvent<{ index: number | null }>;
      const idx = typeof e.detail?.index === "number" ? e.detail.index : null;
      setFocusedIndex(idx);
      if (idx === null) return;
      // Scroll on the next frame so the focused row's outline is up to date
      // before we move it into view.
      requestAnimationFrame(() => {
        const el = itemRefs.current.get(idx);
        if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    };
    const keyHandler = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      window.dispatchEvent(
        new CustomEvent("recorder:focus-action", {
          detail: { index: null },
        }),
      );
    };
    // Right-panel toolbar -> "Insert shared step" button. Compute the
    // current focus + live-action count here so the dialog can default
    // to "after focused step" or "end of recording" without the
    // right-panel needing to know about the actions feed's internals.
    const openInsertSharedHandler = () => {
      const live = items.filter((a) => typeof a.index === "number");
      const focused =
        focusedIndex !== null
          ? items.find((a) => a.index === focusedIndex) ?? null
          : null;
      const focusedLabel = focused
        ? `${(live.findIndex((a) => a.index === focusedIndex) + 1) || ""}. ${focused.methodName ?? focused.suggestedMethodName ?? focused.type ?? "step"}`.trim()
        : null;
      setInsertSharedPosition({
        liveCount: live.length,
        focusedIndex,
        focusedLabel,
      });
      setInsertSharedOpen(true);
    };
    window.addEventListener("recorder:action", handler as EventListener);
    window.addEventListener("recorder:action-named", namedHandler as EventListener);
    window.addEventListener("recorder:action-name-undone", nameUndoneHandler as EventListener);
    window.addEventListener("recorder:action-deleted", deletedHandler as EventListener);
    window.addEventListener("recorder:action-undeleted", undeletedHandler as EventListener);
    window.addEventListener("recorder:hover-action", hoverHandler as EventListener);
    window.addEventListener("recorder:focus-action", focusHandler as EventListener);
    window.addEventListener("recorder:feed-reset", feedResetHandler as EventListener);
    window.addEventListener("recorder:request-open-insert-shared-step", openInsertSharedHandler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("recorder:action", handler as EventListener);
      window.removeEventListener("recorder:action-named", namedHandler as EventListener);
      window.removeEventListener("recorder:action-name-undone", nameUndoneHandler as EventListener);
      window.removeEventListener("recorder:action-deleted", deletedHandler as EventListener);
      window.removeEventListener("recorder:action-undeleted", undeletedHandler as EventListener);
      window.removeEventListener("recorder:hover-action", hoverHandler as EventListener);
      window.removeEventListener("recorder:focus-action", focusHandler as EventListener);
      window.removeEventListener("recorder:feed-reset", feedResetHandler as EventListener);
      window.removeEventListener("recorder:request-open-insert-shared-step", openInsertSharedHandler);
      window.removeEventListener("keydown", keyHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, focusedIndex]);
}
