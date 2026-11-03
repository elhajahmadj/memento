import {
  Loader2,
  Plus,
  Pencil,
  Copy,
  Download,
  Trash2,
  Upload,
} from "lucide-react";
import {
  SolutionType,
  type Architecture,
  type SolutionType as SolutionTypeT,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";

export function ArchitecturesSection({
  architectures,
  archLoading,
  upsertPending,
  highlightArchId,
  isDragOver,
  fileInputRef,
  handleImportFile,
  handleImportClick,
  handleCreateBlank,
  handleDuplicate,
  handleExport,
  setRenameTarget,
  setEditingArch,
  setConfirmDeleteArch,
  handleDragEnter,
  handleDragOver,
  handleDragLeave,
  handleDrop,
}: {
  architectures: Architecture[] | undefined;
  archLoading: boolean;
  upsertPending: boolean;
  highlightArchId: string | null;
  isDragOver: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleImportClick: () => void;
  handleCreateBlank: (solutionType?: SolutionTypeT) => void;
  handleDuplicate: (a: Architecture) => void;
  handleExport: (a: Architecture) => void;
  setRenameTarget: (a: Architecture) => void;
  setEditingArch: (a: Architecture) => void;
  setConfirmDeleteArch: (a: Architecture) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
}) {
  return (
    <section
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative rounded-lg transition-colors ${
        isDragOver
          ? "ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/5"
          : ""
      }`}
      data-testid="dropzone-architectures"
    >
      {isDragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80"
          data-testid="dropzone-architectures-overlay"
        >
          <div className="flex items-center gap-2 text-primary font-medium">
            <Upload className="h-5 w-5" />
            Drop JSON files or a folder to import
          </div>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          multiple
          className="hidden"
          onChange={handleImportFile}
          data-testid="input-import-architecture"
        />
        <Button
          variant="outline"
          onClick={handleImportClick}
          disabled={upsertPending}
          data-testid="button-import-architecture"
        >
          <Upload className="h-4 w-4 mr-1.5" />
          Import
        </Button>
        <Button
          onClick={() => handleCreateBlank(SolutionType.playwright)}
          disabled={upsertPending}
          data-testid="button-new-architecture"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Playwright
        </Button>
        <Button
          variant="outline"
          onClick={() => handleCreateBlank(SolutionType.api)}
          disabled={upsertPending}
          data-testid="button-new-api-architecture"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New API
        </Button>
      </div>
      {archLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <ul className="space-y-2">
          {!architectures?.some((a) => !a.isBuiltIn) && (
            <li
              className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 flex items-center justify-center gap-2 text-sm text-muted-foreground"
              data-testid="hint-architectures-empty"
            >
              <Upload className="h-4 w-4" />
              Drag JSON files or a folder here to import
            </li>
          )}
          {architectures?.map((a) => (
            <li
              key={a.id}
              className={`rounded-md border bg-card px-4 py-3 flex items-center justify-between transition-colors ${
                highlightArchId === a.id
                  ? "border-primary ring-2 ring-primary"
                  : "border-border"
              }`}
              data-testid={`row-arch-${a.id}`}
            >
              <div>
                <div className="font-medium flex items-center gap-2">
                  {a.name}
                  {a.isBuiltIn && (
                    <span className="text-xs font-mono uppercase text-muted-foreground border border-border rounded px-1.5 py-0.5">
                      built-in
                    </span>
                  )}
                  <span
                    className="text-xs font-mono uppercase text-muted-foreground border border-border rounded px-1.5 py-0.5"
                    data-testid={`badge-arch-solution-type-${a.id}`}
                  >
                    {(a.solutionType ?? SolutionType.playwright) ===
                    SolutionType.api
                      ? "api"
                      : "playwright"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {a.projects.length} project
                  {a.projects.length === 1 ? "" : "s"}
                  {a.projects.find((p) => p.isTestsProject)
                    ? ` · tests: ${a.projects.find((p) => p.isTestsProject)?.nameSuffix}`
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {!a.isBuiltIn && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRenameTarget(a)}
                    data-testid={`button-rename-arch-${a.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDuplicate(a)}
                  data-testid={`button-duplicate-arch-${a.id}`}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                {!a.isBuiltIn && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleExport(a)}
                    title="Export as JSON"
                    data-testid={`button-export-arch-${a.id}`}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                )}
                {!a.isBuiltIn && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingArch(a)}
                    data-testid={`button-edit-arch-${a.id}`}
                  >
                    Edit
                  </Button>
                )}
                {!a.isBuiltIn && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmDeleteArch(a)}
                    data-testid={`button-delete-arch-${a.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
