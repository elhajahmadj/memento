import { Save, Trash2 } from "lucide-react";

/**
 * Top toolbar above the actions list. Renders Select-all, the
 * selected-count label, Clear, Save-as-shared-step, and bulk Delete.
 * Stateless — the container owns selection state and supplies all
 * handlers and counts.
 */
export function ActionsFeedToolbar({
  selectedCount,
  allSelected,
  onSelectAllToggle,
  onClearSelection,
  onOpenSaveAsShared,
  onDeleteSelected,
}: {
  selectedCount: number;
  allSelected: boolean;
  onSelectAllToggle: () => void;
  onClearSelection: () => void;
  onOpenSaveAsShared: () => void;
  onDeleteSelected: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/40 text-xs"
      data-testid="actions-feed-toolbar"
    >
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onSelectAllToggle}
          className="h-3.5 w-3.5 cursor-pointer"
          aria-label="Select all actions"
          data-testid="checkbox-select-all-actions"
        />
        <span className="text-muted-foreground">
          {selectedCount > 0 ? `${selectedCount} selected` : "Select all"}
        </span>
      </label>
      <div className="ml-auto flex items-center gap-1">
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={onClearSelection}
            className="px-2 py-0.5 rounded-sm text-muted-foreground hover-elevate"
            data-testid="button-clear-action-selection"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={onOpenSaveAsShared}
          disabled={selectedCount === 0}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm hover-elevate disabled:opacity-40 disabled:hover:bg-transparent"
          title="Save selected actions as a reusable shared step"
          data-testid="button-save-selected-as-shared-step"
        >
          <Save className="h-3 w-3" />
          Save as shared step
        </button>
        <button
          type="button"
          onClick={onDeleteSelected}
          disabled={selectedCount === 0}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-destructive hover-elevate disabled:opacity-40 disabled:hover:bg-transparent"
          title="Delete selected actions"
          data-testid="button-delete-selected-actions"
        >
          <Trash2 className="h-3 w-3" />
          Delete{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </button>
      </div>
    </div>
  );
}
