/**
 * <ExplorerPanel /> — the workbench Explorer's tabs shell.
 *
 * Wraps the existing <FileTreePanel /> behind a "Files" tab and adds a
 * sibling "Tests" tab that consumes the discovered-test-method tree
 * from the server. Selection state lives inside <TestsTreePanel /> so
 * switching back to Files doesn't blow it away.
 */
import { useEffect, useRef, useState } from "react";
import { Layers, ChevronsLeft } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import { Button } from "@/shared/ui/button";
import type { TreeNodeT } from "@/features/workbench/domain/types";
import { FileTreePanel } from "./file-tree-panel";
import { TestsTreePanel } from "./tests-tree-panel";
import { JmxFilesPanel } from "./jmx-files-panel";
import { BranchDropdown } from "./branch-dropdown";

export function ExplorerPanel({
  projectId,
  projectName,
  tree,
  selectedPath,
  onSelect,
  onAddFolder,
  onAddFile,
  onRename,
  onDelete,
  isLoading,
  isError,
  error,
  onRetry,
  onCollapse,
  jmxFiles,
  jmxEmbedCredentialsWarning,
}: {
  projectId: string | null;
  projectName?: string | null | undefined;
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
  onCollapse?: (() => void) | undefined;
  /**
   * JMX-only: when provided (project is a JMX project), the Tests tab
   * is replaced with a list of `.jmx` plans that have been emitted
   * under the project's `jmx/` folder. The list is sourced from
   * `project.jmxFiles` (mirrors `.testbuilder.json#jmxFiles`) and
   * refreshes whenever the current-project query is invalidated.
   * `undefined` keeps the standard Tests tab (discovered test methods)
   * for non-JMX projects.
   */
  jmxFiles?: string[] | undefined;
  /**
   * JMX-only: shown as a small banner above the JMX file list when
   * the project's saved `jmxExport.embedCredentials` is true.
   */
  jmxEmbedCredentialsWarning?: boolean | undefined;
}) {
  const isJmx = jmxFiles !== undefined;
  // The Explorer tabs are controlled so we can auto-switch to the
  // JMX-files tab the moment a new `.jmx` recording shows up after
  // Stop Recording. Without this, the new row is rendered (forceMount)
  // but stays inside an inactive TabsContent with
  // `data-[state=inactive]:hidden` — the user sees "nothing happened"
  // and the e2e spec's `expect(jmx-file-row-…).toBeVisible()` resolves
  // to a `hidden` element. We compare the file count against the last
  // value we saw; any growth (the typical Stop-Recording path) flips
  // the active tab so the new row lands on-screen.
  const [activeTab, setActiveTab] = useState<"files" | "tests">("files");
  const prevJmxCountRef = useRef<number>(jmxFiles?.length ?? 0);
  useEffect(() => {
    if (!isJmx) return;
    const next = jmxFiles?.length ?? 0;
    const prev = prevJmxCountRef.current;
    prevJmxCountRef.current = next;
    if (next > prev) {
      setActiveTab("tests");
    }
  }, [isJmx, jmxFiles]);
  return (
    <div className="h-full flex flex-col bg-sidebar border-r border-sidebar-border">
      <div className="h-9 flex items-center justify-between px-3 border-b border-sidebar-border text-xs font-mono uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-2 min-w-0">
          <span className="flex items-center shrink-0">
            <Layers className="h-3.5 w-3.5 mr-2" />
            Explorer
          </span>
          {projectName ? <BranchDropdown projectName={projectName} /> : null}
        </span>
        {onCollapse && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={onCollapse}
            aria-label="Collapse Explorer"
            data-testid="button-collapse-explorer"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "files" | "tests")}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="px-2 pt-2">
          <TabsList className="h-8 w-full justify-start">
            <TabsTrigger
              value="files"
              className="text-xs h-6"
              data-testid="tab-explorer-files"
            >
              Files
            </TabsTrigger>
            <TabsTrigger
              value="tests"
              className="text-xs h-6"
              data-testid="tab-explorer-tests"
            >
              {isJmx ? "JMX files" : "Tests"}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent
          value="files"
          className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
          forceMount
          data-testid="tabpanel-explorer-files"
        >
          <FileTreePanel
            tree={tree}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onAddFolder={onAddFolder}
            onAddFile={onAddFile}
            onRename={onRename}
            onDelete={onDelete}
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={onRetry}
          />
        </TabsContent>
        <TabsContent
          value="tests"
          className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
          forceMount
          data-testid="tabpanel-explorer-tests"
        >
          {isJmx ? (
            <JmxFilesPanel
              jmxFiles={jmxFiles ?? []}
              embedCredentialsWarning={jmxEmbedCredentialsWarning === true}
            />
          ) : (
            <TestsTreePanel projectId={projectId} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
