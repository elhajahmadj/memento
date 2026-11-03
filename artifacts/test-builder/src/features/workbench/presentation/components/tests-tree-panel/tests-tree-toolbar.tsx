/**
 * Toolbar above the tests tree — selected count, Run selected button,
 * search input, and kind-filter chips. Pure presentation; all state
 * lives on the parent panel.
 */
import { Loader2, Play, Search, X } from "lucide-react";
import type { TestKind } from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Toggle } from "@/shared/ui/toggle";
import {
  ALL_KINDS,
  KIND_BADGE_CLASS,
  KIND_LABEL,
} from "@/features/workbench/domain/tests-tree/kinds";
import { cn } from "@/shared/utils/utils";

export interface TestsTreeToolbarProps {
  selectedCount: number;
  isPending: boolean;
  canRun: boolean;
  onRun: () => void;
  search: string;
  onSearchChange: (next: string) => void;
  activeKinds: ReadonlySet<TestKind>;
  onToggleKind: (kind: TestKind, next: boolean) => void;
}

export function TestsTreeToolbar({
  selectedCount,
  isPending,
  canRun,
  onRun,
  search,
  onSearchChange,
  activeKinds,
  onToggleKind,
}: TestsTreeToolbarProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-sidebar-border">
        <span
          className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground"
          data-testid="tests-tree-selected-count"
        >
          {selectedCount} selected
        </span>
        <Button
          size="sm"
          variant="default"
          className="h-7 px-2 text-xs"
          onClick={onRun}
          disabled={!canRun}
          data-testid="button-tests-tree-run-selected"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Play className="h-3 w-3 mr-1 fill-current" />
          )}
          Run selected
        </Button>
      </div>
      <div className="flex flex-col gap-2 px-2 py-2 border-b border-sidebar-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tests..."
            className="h-7 pl-7 pr-7 text-xs"
            data-testid="tests-tree-search-input"
            aria-label="Search tests"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              data-testid="tests-tree-search-clear"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {ALL_KINDS.map((kind) => {
            const on = activeKinds.has(kind);
            return (
              <Toggle
                key={kind}
                size="sm"
                pressed={on}
                onPressedChange={(next) => onToggleKind(kind, next)}
                className={cn(
                  "h-6 px-2 text-[10px] font-mono uppercase tracking-wide border",
                  on
                    ? KIND_BADGE_CLASS[kind]
                    : "border-transparent text-muted-foreground",
                )}
                data-testid={`tests-tree-filter-${kind}`}
                aria-label={`Filter ${KIND_LABEL[kind]} tests`}
                aria-pressed={on}
              >
                {KIND_LABEL[kind]}
              </Toggle>
            );
          })}
        </div>
      </div>
    </>
  );
}
