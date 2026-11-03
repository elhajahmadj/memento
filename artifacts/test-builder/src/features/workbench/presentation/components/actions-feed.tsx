import { useState, useRef } from "react";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { SaveAsSharedStepDialog } from "@/features/workbench/presentation/dialogs/save-as-shared-step-dialog";
import { InsertSharedStepDialog } from "@/features/workbench/presentation/dialogs/insert-shared-step-dialog";
import type { RecordedActionMsg } from "@/features/workbench/domain/types";
import { EditValueDialog } from "./actions-feed/edit-value-dialog";
import { ActionsFeedToolbar } from "./actions-feed/actions-feed-toolbar";
import { ActionRow } from "./actions-feed/action-row";
import { useActionsFeedEvents } from "./actions-feed/use-actions-feed-events";

/**
 * Live list of recorded actions. Owns selection / focus / hover state
 * and listens on the global `recorder:*` event bus for server-broadcast
 * updates (new actions, renames, deletes, undos, feed resets). All
 * per-row UI is delegated to `ActionRow`; the toolbar above the list
 * to `ActionsFeedToolbar`; the value editor to `EditValueDialog`.
 */
export function ActionsFeed() {
  const [items, setItems] = useState<RecordedActionMsg[]>([]);
  const [editTarget, setEditTarget] = useState<RecordedActionMsg | null>(null);
  // Synchronized hover state with the live test-body preview. Hovering a
  // feed row dispatches `recorder:hover-action` so the preview can light
  // up the matching line; the same event flows the other way so hovering
  // a preview line highlights the row here. Index is the server-assigned
  // session index, which is stable across renames and live updates.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  // Persistent "selected" focus so a click in either pane scrolls the other
  // pane to the matching item and visibly marks it. Cleared automatically
  // if the focused action is deleted.
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  // Multi-select state for bulk delete. `selected` holds the server-assigned
  // indices that are currently checked. `lastSelectedIndex` is the anchor for
  // shift-click range selection (mirrors the index of the most recently
  // toggled checkbox in the visible list, server-side index).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null,
  );
  // T003 — Save selection as shared step + Insert shared step both
  // live here because the actions-feed owns the selection / focused
  // state needed by both dialogs. The right-panel toolbar dispatches
  // `recorder:request-open-insert-shared-step` to ask us to open the
  // insert dialog with the current focus / live-count baked in.
  const [saveAsSharedOpen, setSaveAsSharedOpen] = useState(false);
  const [insertSharedOpen, setInsertSharedOpen] = useState(false);
  const [insertSharedPosition, setInsertSharedPosition] = useState<{
    liveCount: number;
    focusedIndex: number | null;
    focusedLabel: string | null;
  } | null>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  useActionsFeedEvents({
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
  });

  const clearFocus = () => {
    setFocusedIndex(null);
    window.dispatchEvent(
      new CustomEvent("recorder:focus-action", {
        detail: { index: null },
      }),
    );
  };

  // Server-assigned indices of currently-visible rows, in display order.
  const visibleIndices = items
    .map((it) => it.index)
    .filter((i): i is number => typeof i === "number");
  const selectedCount = selected.size;
  const allSelected =
    visibleIndices.length > 0 && visibleIndices.every((i) => selected.has(i));

  const dispatchBulkDelete = (indices: number[]) => {
    if (indices.length === 0) return;
    window.dispatchEvent(
      new CustomEvent("recorder:request-delete-bulk", {
        detail: { indices },
      }),
    );
  };

  const handleCheckboxClick = (
    e: React.MouseEvent<HTMLInputElement>,
    index: number,
  ) => {
    e.stopPropagation();
    const checked = (e.currentTarget as HTMLInputElement).checked;
    setSelected((prev) => {
      const next = new Set(prev);
      // Shift-click: toggle the contiguous range from the last anchor to
      // this row (inclusive) to the same checked state as this click.
      if (e.shiftKey && lastSelectedIndex !== null) {
        const a = visibleIndices.indexOf(lastSelectedIndex);
        const b = visibleIndices.indexOf(index);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          for (let k = lo; k <= hi; k++) {
            const idx = visibleIndices[k]!;
            if (checked) next.add(idx);
            else next.delete(idx);
          }
          setLastSelectedIndex(index);
          return next;
        }
      }
      if (checked) next.add(index);
      else next.delete(index);
      setLastSelectedIndex(index);
      return next;
    });
  };

  const handleSelectAllToggle = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleIndices));
    }
  };

  const handleDeleteSelected = () => {
    const ordered = visibleIndices.filter((i) => selected.has(i));
    if (ordered.length === 0) return;
    dispatchBulkDelete(ordered);
    setSelected(new Set());
    setLastSelectedIndex(null);
  };

  const handleClearSelection = () => {
    setSelected(new Set());
    setLastSelectedIndex(null);
  };

  const handleDeleteFromHere = (
    e: React.MouseEvent<HTMLButtonElement>,
    index: number,
  ) => {
    e.stopPropagation();
    const pos = visibleIndices.indexOf(index);
    if (pos === -1) return;
    const tail = visibleIndices.slice(pos);
    dispatchBulkDelete(tail);
    setSelected(new Set());
    setLastSelectedIndex(null);
  };

  const handleRegisterRef = (index: number, el: HTMLDivElement | null) => {
    if (el) itemRefs.current.set(index, el);
    else itemRefs.current.delete(index);
  };

  const handleRowFocus = (index: number) => {
    setFocusedIndex(index);
    window.dispatchEvent(
      new CustomEvent("recorder:focus-action", {
        detail: { index },
      }),
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {items.length > 0 && (
        <ActionsFeedToolbar
          selectedCount={selectedCount}
          allSelected={allSelected}
          onSelectAllToggle={handleSelectAllToggle}
          onClearSelection={handleClearSelection}
          onOpenSaveAsShared={() => setSaveAsSharedOpen(true)}
          onDeleteSelected={handleDeleteSelected}
        />
      )}
      <ScrollArea className="flex-1" onClick={clearFocus}>
        <div className="p-2 space-y-1 min-h-full">
          {items.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-3">
              Actions will stream here while recording.
            </div>
          ) : (
            items.map((a, i) => {
              const isHovered =
                typeof a.index === "number" && hoveredIndex === a.index;
              const isFocused =
                typeof a.index === "number" && focusedIndex === a.index;
              return (
                <ActionRow
                  key={i}
                  action={a}
                  fallbackKey={i}
                  visibleIndices={visibleIndices}
                  selected={selected}
                  isHovered={isHovered}
                  isFocused={isFocused}
                  onRegisterRef={handleRegisterRef}
                  onCheckboxClick={handleCheckboxClick}
                  onDeleteFromHere={handleDeleteFromHere}
                  onFocus={handleRowFocus}
                  onEditValue={(action) => setEditTarget(action)}
                />
              );
            })
          )}
        </div>
      </ScrollArea>
      <EditValueDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
      />
      <SaveAsSharedStepDialog
        open={saveAsSharedOpen}
        onOpenChange={setSaveAsSharedOpen}
        actions={items.filter((a) => selected.has(a.index ?? -1))}
        onSaved={() => {
          setSelected(new Set());
          setLastSelectedIndex(null);
        }}
      />
      <InsertSharedStepDialog
        open={insertSharedOpen}
        onOpenChange={setInsertSharedOpen}
        position={insertSharedPosition}
      />
    </div>
  );
}
