import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useListArchitectures,
  useUpsertArchitecture,
  useDeleteArchitecture,
  getListArchitecturesQueryKey,
  SolutionType,
  type Architecture,
  type SolutionType as SolutionTypeT,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  blankArchitecture,
  cloneArchitecture,
} from "@/features/settings/domain/architecture-helpers";
import { CollapsibleSection } from "../components/collapsible-section";
import { ArchitecturesSection } from "./architectures-section";
import { ArchitectureEditor } from "../architecture/architecture-editor";
import { ImportResultsDialog } from "./import-results-dialog";
import { ImportConflictDialog } from "./import-conflict-dialog";
import { useArchitectureImport } from "../hooks/use-architecture-import";

/**
 * Self-contained "Architectures" panel. Renders the
 * CollapsibleSection wrapper plus every dialog (editor, rename,
 * delete-confirm, import results, import conflict) so the host page
 * only has to drop `<ArchitecturesPanel defaultOpen={…} />` once.
 */
export function ArchitecturesPanel({
  defaultOpen,
}: {
  defaultOpen?: boolean;
}) {
  const qc = useQueryClient();
  const { data: architectures, isLoading: archLoading } =
    useListArchitectures();
  const [editingArch, setEditingArch] = useState<Architecture | null>(null);
  const [renameTarget, setRenameTarget] = useState<Architecture | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteArch, setConfirmDeleteArch] =
    useState<Architecture | null>(null);
  const [highlightArchId, setHighlightArchId] = useState<string | null>(null);

  const upsert = useUpsertArchitecture({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getListArchitecturesQueryKey() });
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to save architecture"),
    },
  });

  const removeArch = useDeleteArchitecture({
    mutation: {
      onSuccess: async () => {
        toast.success("Architecture deleted");
        setConfirmDeleteArch(null);
        await qc.invalidateQueries({ queryKey: getListArchitecturesQueryKey() });
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to delete"),
    },
  });

  const handleCreateBlank = async (
    solutionType: SolutionTypeT = SolutionType.playwright,
  ) => {
    const arch = blankArchitecture(solutionType);
    const saved = await upsert.mutateAsync({ data: arch });
    setEditingArch(saved);
  };

  const handleDuplicate = async (source: Architecture) => {
    const copy = cloneArchitecture(source, `${source.name} (copy)`);
    const saved = await upsert.mutateAsync({ data: copy });
    toast.success("Architecture duplicated");
    setEditingArch(saved);
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const updated = { ...renameTarget, name: renameValue.trim() };
    if (!updated.name) {
      toast.error("Name is required");
      return;
    }
    await upsert.mutateAsync({ data: updated });
    toast.success("Renamed");
    setRenameTarget(null);
  };

  const handleExport = (a: Architecture) => {
    const blob = new Blob([JSON.stringify(a, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeName = a.name.replace(/[^A-Za-z0-9_.-]+/g, "_") || "architecture";
    link.download = `${safeName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importer = useArchitectureImport({
    architectures,
    upsert: async (data) => upsert.mutateAsync({ data }),
  });

  const handleJumpToArchitecture = (id: string) => {
    importer.setImportResults(null);
    setHighlightArchId(id);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-testid="row-arch-${id}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    window.setTimeout(
      () => setHighlightArchId((cur) => (cur === id ? null : cur)),
      2000,
    );
  };

  return (
    <>
      <CollapsibleSection
        title="Architectures"
        description="Define the project layout, folders, and starter files used when scaffolding a new solution."
        testId="architectures"
        defaultOpen={defaultOpen}
      >
        <ArchitecturesSection
          architectures={architectures}
          archLoading={archLoading}
          upsertPending={upsert.isPending}
          highlightArchId={highlightArchId}
          isDragOver={importer.isDragOver}
          fileInputRef={importer.fileInputRef}
          handleImportFile={importer.handleImportFile}
          handleImportClick={importer.handleImportClick}
          handleCreateBlank={handleCreateBlank}
          handleDuplicate={handleDuplicate}
          handleExport={handleExport}
          setRenameTarget={(a) => {
            setRenameTarget(a);
            setRenameValue(a.name);
          }}
          setEditingArch={setEditingArch}
          setConfirmDeleteArch={setConfirmDeleteArch}
          handleDragEnter={importer.handleDragEnter}
          handleDragOver={importer.handleDragOver}
          handleDragLeave={importer.handleDragLeave}
          handleDrop={importer.handleDrop}
        />
      </CollapsibleSection>

      {editingArch && (
        <ArchitectureEditor
          architecture={editingArch}
          onClose={() => setEditingArch(null)}
          onSave={async (updated) => {
            const saved = await upsert.mutateAsync({ data: updated });
            toast.success("Architecture saved");
            setEditingArch(saved);
          }}
          saving={upsert.isPending}
        />
      )}

      <Dialog
        open={!!renameTarget}
        onOpenChange={(o) => !o && setRenameTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename architecture</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Label htmlFor="rename">Name</Label>
            <Input
              id="rename"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              data-testid="input-rename-arch"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={upsert.isPending}
              data-testid="button-confirm-rename-arch"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportResultsDialog
        importResults={importer.importResults}
        setImportResults={importer.setImportResults}
        isDialogDragOver={importer.isDialogDragOver}
        retryInputRef={importer.retryInputRef}
        handleRetryFailedFile={importer.handleRetryFailedFile}
        handleRetryFailedClick={importer.handleRetryFailedClick}
        handleDialogDragEnter={importer.handleDialogDragEnter}
        handleDialogDragOver={importer.handleDialogDragOver}
        handleDialogDragLeave={importer.handleDialogDragLeave}
        handleDialogDrop={importer.handleDialogDrop}
        onJumpToArchitecture={handleJumpToArchitecture}
        upsertPending={upsert.isPending}
      />

      <ImportConflictDialog
        pendingImport={importer.pendingImport}
        importRenameMode={importer.importRenameMode}
        setImportRenameMode={importer.setImportRenameMode}
        importRenameValue={importer.importRenameValue}
        setImportRenameValue={importer.setImportRenameValue}
        closeImportDialog={importer.closeImportDialog}
        handleImportKeepBoth={importer.handleImportKeepBoth}
        handleImportConfirmRename={importer.handleImportConfirmRename}
        upsertPending={upsert.isPending}
      />

      <Dialog
        open={!!confirmDeleteArch}
        onOpenChange={(o) => !o && setConfirmDeleteArch(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete architecture?</DialogTitle>
            <DialogDescription>
              This will remove{" "}
              <span className="font-mono">{confirmDeleteArch?.name}</span>.
              Existing projects scaffolded from it are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDeleteArch(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                confirmDeleteArch &&
                removeArch.mutate({ data: { id: confirmDeleteArch.id } })
              }
              disabled={removeArch.isPending}
              data-testid="button-confirm-delete-arch"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
