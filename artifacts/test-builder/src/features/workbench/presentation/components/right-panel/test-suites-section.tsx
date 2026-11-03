import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { ChevronsRight, Plus } from "lucide-react";
import { TestClassRow } from "./test-class-row";

export function TestSuitesSection({
  tests,
  testsLoading,
  testsError,
  onRetryTests,
  methodsByPath,
  onAddClass,
  onAddMethod,
  onValidateClass,
  onValidateMethod,
  onCollapse,
}: {
  tests: Array<{ className: string; path: string }>;
  testsLoading: boolean;
  testsError: Error | null;
  onRetryTests?: (() => void) | undefined;
  methodsByPath: Map<string, string[]>;
  onAddClass: () => void;
  onAddMethod: (filePath: string) => void;
  // Omitted for JMX projects, which don't use the Playwright validation
  // flow. Downstream rows skip rendering the inline Validate button when
  // the callback is not supplied.
  onValidateClass?: ((filePath: string) => void) | undefined;
  onValidateMethod?:
    | ((filePath: string, methodName: string) => void)
    | undefined;
  onCollapse?: (() => void) | undefined;
}) {
  return (
    <>
      <div className="h-9 flex items-center justify-between px-3 border-b border-sidebar-border">
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Test Suites
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={onAddClass}
            data-testid="button-add-test-class"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          {onCollapse && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={onCollapse}
              aria-label="Collapse Test Suites"
              data-testid="button-collapse-test-suites"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <ScrollArea className="max-h-1/2">
        <div className="p-2">
          {testsError ? (
            <div
              className="text-xs text-muted-foreground px-2 py-3 space-y-2"
              data-testid="test-list-error"
            >
              <div className="text-destructive">
                Couldn't load test suites.
              </div>
              {testsError.message && (
                <div className="text-[11px] break-words opacity-80">
                  {testsError.message}
                </div>
              )}
              {onRetryTests && (
                <button
                  type="button"
                  onClick={onRetryTests}
                  className="mt-1 inline-flex items-center rounded-sm border border-sidebar-border px-2 py-1 text-xs hover-elevate"
                  data-testid="button-test-list-retry"
                >
                  Retry
                </button>
              )}
            </div>
          ) : testsLoading && tests.length === 0 ? (
            <div
              className="text-xs text-muted-foreground px-2 py-3"
              data-testid="test-list-loading"
            >
              Loading…
            </div>
          ) : tests.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-3">
              No test suites yet.
            </div>
          ) : (
            tests.map((t) => (
              <TestClassRow
                key={t.path}
                className={t.className}
                filePath={t.path}
                methods={methodsByPath.get(t.path) ?? []}
                onAddMethod={onAddMethod}
                onValidateClass={onValidateClass}
                onValidateMethod={onValidateMethod}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </>
  );
}
