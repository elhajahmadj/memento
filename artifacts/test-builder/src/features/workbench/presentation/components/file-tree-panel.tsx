import { ScrollArea } from "@/shared/ui/scroll-area";

import { TreeRow } from "./tree-row";
import type { TreeNodeT } from "@/features/workbench/domain/types";

export function FileTreePanel({
  tree,
  selectedPath,
  onSelect,
  onAddFolder,
  onAddFile,
  onRename,
  onDelete,
  isLoading = false,
  isError = false,
  error = null,
  onRetry,
}: {
  tree: TreeNodeT | undefined;
  selectedPath: string | null;
  onSelect: (n: TreeNodeT) => void;
  onAddFolder: (parent: string) => void;
  onAddFile: (parent: string) => void;
  onRename: (n: TreeNodeT) => void;
  onDelete: (n: TreeNodeT) => void;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
  error?: Error | null | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1">
        <div className="p-2">
          {tree ? (
            <TreeRow
              node={tree}
              depth={0}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onAddFolder={onAddFolder}
              onAddFile={onAddFile}
              onRename={onRename}
              onDelete={onDelete}
              isRoot
            />
          ) : isError ? (
            <div
              className="p-4 text-xs text-muted-foreground space-y-2"
              data-testid="file-tree-error"
            >
              <div className="text-destructive">
                Couldn't load the project files.
              </div>
              {error?.message && (
                <div className="text-[11px] break-words opacity-80">
                  {error.message}
                </div>
              )}
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-1 inline-flex items-center rounded-sm border border-sidebar-border px-2 py-1 text-xs hover-elevate"
                  data-testid="button-file-tree-retry"
                >
                  Retry
                </button>
              )}
            </div>
          ) : isLoading ? (
            <div
              className="p-4 text-xs text-muted-foreground"
              data-testid="file-tree-loading"
            >
              Loading…
            </div>
          ) : (
            <div
              className="p-4 text-xs text-muted-foreground"
              data-testid="file-tree-empty"
            >
              No files yet.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
