/**
 * Status surfaces for the tests tree: loading skeleton, error banner
 * with retry, empty (no tests discovered), and no-matches (everything
 * filtered out). The parent panel decides which one to render based on
 * the discovery query state and the filtered subtree.
 */

export function TestsTreeLoading() {
  return (
    <div className="space-y-2 p-2" data-testid="tests-tree-loading">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-4 rounded-sm bg-muted/50 animate-pulse"
          style={{ width: `${90 - i * 12}%` }}
        />
      ))}
    </div>
  );
}

export function TestsTreeError({
  error,
  onRetry,
}: {
  error: Error | null | undefined;
  onRetry: () => void;
}) {
  return (
    <div className="p-3 text-xs space-y-2" data-testid="tests-tree-error">
      <div className="text-destructive">Couldn't load discovered tests.</div>
      {error?.message && (
        <div className="text-[11px] break-words opacity-80 text-muted-foreground">
          {error.message}
        </div>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 inline-flex items-center rounded-sm border border-sidebar-border px-2 py-1 text-xs hover-elevate"
        data-testid="button-tests-tree-retry"
      >
        Retry
      </button>
    </div>
  );
}

export function TestsTreeEmpty() {
  return (
    <div
      className="p-4 text-xs text-muted-foreground"
      data-testid="tests-tree-empty"
    >
      No tests discovered yet.
    </div>
  );
}

export function TestsTreeNoMatches() {
  return (
    <div
      className="p-4 text-xs text-muted-foreground"
      data-testid="tests-tree-no-matches"
    >
      No tests match your search.
    </div>
  );
}
