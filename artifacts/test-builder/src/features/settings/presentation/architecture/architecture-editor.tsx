import { useState, useMemo, useEffect } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  FolderPlus,
  FilePlus2,
} from "lucide-react";
import {
  SolutionType,
  type Architecture,
  type ArchProject,
  type ArchFolder,
  type ArchFile,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { blankProject } from "@/features/settings/domain/architecture-helpers";
import { FileTree, type SelectedFile } from "./file-tree";
import { ArchFileEditor } from "./arch-file-editor";

export function ArchitectureEditor({
  architecture,
  onClose,
  onSave,
  saving,
}: {
  architecture: Architecture;
  onClose: () => void;
  onSave: (updated: Architecture) => Promise<void>;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<Architecture>(() =>
    JSON.parse(JSON.stringify(architecture)),
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    architecture.projects[0]?.id ?? "",
  );
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDraft(JSON.parse(JSON.stringify(architecture)));
    setSelectedProjectId(architecture.projects[0]?.id ?? "");
    setSelected(null);
  }, [architecture]);

  const selectedProject = useMemo(
    () => draft.projects.find((p) => p.id === selectedProjectId) ?? null,
    [draft, selectedProjectId],
  );

  const updateProject = (
    projectId: string,
    fn: (p: ArchProject) => ArchProject,
  ) => {
    setDraft((d) => ({
      ...d,
      projects: d.projects.map((p) => (p.id === projectId ? fn(p) : p)),
    }));
  };

  const setTestsProject = (projectId: string) => {
    setDraft((d) => ({
      ...d,
      projects: d.projects.map((p) => ({
        ...p,
        isTestsProject: p.id === projectId,
      })),
    }));
  };

  const addProject = () => {
    const p = blankProject(".NewProject");
    setDraft((d) => ({ ...d, projects: [...d.projects, p] }));
    setSelectedProjectId(p.id);
  };

  const removeProject = (projectId: string) => {
    setDraft((d) => ({
      ...d,
      projects: d.projects.filter((p) => p.id !== projectId),
    }));
    if (selectedProjectId === projectId) {
      setSelectedProjectId(draft.projects[0]?.id ?? "");
      setSelected(null);
    }
  };

  const traverse = (
    project: ArchProject,
    folderPath: string[],
  ): { folders: ArchFolder[]; files: ArchFile[] } => {
    let cur: { folders: ArchFolder[]; files: ArchFile[] } = {
      folders: project.folders,
      files: project.files,
    };
    for (const seg of folderPath) {
      const next = cur.folders.find((f) => f.name === seg);
      if (!next) return { folders: [], files: [] };
      cur = { folders: next.folders, files: next.files };
    }
    return cur;
  };

  const mutateAt = (
    project: ArchProject,
    folderPath: string[],
    fn: (node: { folders: ArchFolder[]; files: ArchFile[] }) => {
      folders: ArchFolder[];
      files: ArchFile[];
    },
  ): ArchProject => {
    const recur = (
      folders: ArchFolder[],
      files: ArchFile[],
      depth: number,
    ): { folders: ArchFolder[]; files: ArchFile[] } => {
      if (depth === folderPath.length) return fn({ folders, files });
      const seg = folderPath[depth];
      return {
        folders: folders.map((f) => {
          if (f.name !== seg) return f;
          const sub = recur(f.folders, f.files, depth + 1);
          return { ...f, folders: sub.folders, files: sub.files };
        }),
        files,
      };
    };
    const result = recur(project.folders, project.files, 0);
    return { ...project, folders: result.folders, files: result.files };
  };

  const addFolderAt = (folderPath: string[]) => {
    if (!selectedProject) return;
    const name = prompt("Folder name?");
    if (!name) return;
    updateProject(selectedProject.id, (p) =>
      mutateAt(p, folderPath, (node) => ({
        files: node.files,
        folders: [...node.folders, { name, folders: [], files: [] }],
      })),
    );
  };

  const addFileAt = (folderPath: string[]) => {
    if (!selectedProject) return;
    const name = prompt("File name (e.g. MyClass.cs)?");
    if (!name) return;
    updateProject(selectedProject.id, (p) =>
      mutateAt(p, folderPath, (node) => ({
        folders: node.folders,
        files: [...node.files, { name, content: "" }],
      })),
    );
    setSelected({ projectId: selectedProject.id, folderPath, fileName: name });
  };

  const deleteFolderAt = (folderPath: string[], folderName: string) => {
    if (!selectedProject) return;
    if (!confirm(`Delete folder "${folderName}" and all its contents?`)) return;
    updateProject(selectedProject.id, (p) =>
      mutateAt(p, folderPath, (node) => ({
        files: node.files,
        folders: node.folders.filter((f) => f.name !== folderName),
      })),
    );
  };

  const deleteFileAt = (folderPath: string[], fileName: string) => {
    if (!selectedProject) return;
    if (!confirm(`Delete file "${fileName}"?`)) return;
    updateProject(selectedProject.id, (p) =>
      mutateAt(p, folderPath, (node) => ({
        folders: node.folders,
        files: node.files.filter((f) => f.name !== fileName),
      })),
    );
    if (selected?.fileName === fileName) setSelected(null);
  };

  const renameFileAt = (folderPath: string[], oldName: string) => {
    if (!selectedProject) return;
    const next = prompt("Rename file to:", oldName);
    if (!next || next === oldName) return;
    updateProject(selectedProject.id, (p) =>
      mutateAt(p, folderPath, (node) => ({
        folders: node.folders,
        files: node.files.map((f) =>
          f.name === oldName ? { ...f, name: next } : f,
        ),
      })),
    );
    if (selected?.fileName === oldName) {
      setSelected({ ...selected, fileName: next });
    }
  };

  const updateFileContent = (content: string) => {
    if (!selected || !selectedProject) return;
    updateProject(selectedProject.id, (p) =>
      mutateAt(p, selected.folderPath, (node) => ({
        folders: node.folders,
        files: node.files.map((f) =>
          f.name === selected.fileName ? { ...f, content } : f,
        ),
      })),
    );
  };

  const selectedFileContent = useMemo(() => {
    if (!selected || !selectedProject) return null;
    const node = traverse(selectedProject, selected.folderPath);
    return node.files.find((f) => f.name === selected.fileName)?.content ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedProject]);

  const toggleExpand = (key: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-[90vw] !w-[90vw] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                Edit architecture: {draft.name}
                <span
                  className="text-xs font-mono uppercase text-muted-foreground border border-border rounded px-1.5 py-0.5"
                  data-testid="badge-editor-solution-type"
                >
                  {(draft.solutionType ?? SolutionType.playwright) ===
                  SolutionType.api
                    ? "api"
                    : "playwright"}
                </span>
              </DialogTitle>
              <DialogDescription>
                Use <code className="font-mono">{"{{Namespace}}"}</code> in file
                contents to substitute the project namespace at scaffold time.
                {(draft.solutionType ?? SolutionType.playwright) ===
                  SolutionType.api && (
                  <>
                    {" "}
                    This is an API architecture — only offered when the user
                    picks "API (HTTP-only)" in the New Project dialog.
                  </>
                )}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button
                onClick={() => onSave(draft)}
                disabled={saving}
                data-testid="button-save-arch"
              >
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Save className="h-4 w-4 mr-1.5" /> Save
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-[260px_320px_1fr] min-h-0">
          <div className="border-r border-border flex flex-col min-h-0">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Projects
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={addProject}
                data-testid="button-add-project"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <ul className="p-2 space-y-1">
                {draft.projects.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => {
                        setSelectedProjectId(p.id);
                        setSelected(null);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-md hover-elevate text-sm ${
                        selectedProjectId === p.id
                          ? "bg-accent text-accent-foreground"
                          : ""
                      }`}
                      data-testid={`button-select-project-${p.id}`}
                    >
                      <div className="font-mono">{p.nameSuffix}</div>
                      {p.isTestsProject && (
                        <div className="text-[10px] uppercase text-muted-foreground">
                          tests
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>

          <div className="border-r border-border flex flex-col min-h-0">
            {selectedProject ? (
              <>
                <div className="px-4 py-3 border-b border-border space-y-3">
                  <div>
                    <Label htmlFor="suffix" className="text-xs">
                      Name suffix
                    </Label>
                    <Input
                      id="suffix"
                      value={selectedProject.nameSuffix}
                      onChange={(e) =>
                        updateProject(selectedProject.id, (p) => ({
                          ...p,
                          nameSuffix: e.target.value,
                        }))
                      }
                      placeholder=".Tests"
                      className="mt-1 h-8 font-mono text-sm"
                      data-testid="input-project-suffix"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-xs">Tests project</Label>
                      <span className="text-[10px] text-muted-foreground">
                        Exactly one project must hold the NUnit tests.
                      </span>
                    </div>
                    <Switch
                      checked={selectedProject.isTestsProject}
                      disabled={selectedProject.isTestsProject}
                      onCheckedChange={(v) => {
                        if (v) setTestsProject(selectedProject.id);
                      }}
                      data-testid="switch-tests-project"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive w-full"
                    onClick={() => removeProject(selectedProject.id)}
                    data-testid="button-remove-project"
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" /> Remove project
                  </Button>
                </div>
                <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Files
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => addFolderAt([])}
                      title="Add folder at root"
                      data-testid="button-add-root-folder"
                    >
                      <FolderPlus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => addFileAt([])}
                      title="Add file at root"
                      data-testid="button-add-root-file"
                    >
                      <FilePlus2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-2">
                    <FileTree
                      project={selectedProject}
                      folders={selectedProject.folders}
                      files={selectedProject.files}
                      folderPath={[]}
                      expanded={expanded}
                      onToggle={toggleExpand}
                      selected={selected}
                      onSelect={(s) => setSelected(s)}
                      onAddFolder={addFolderAt}
                      onAddFile={addFileAt}
                      onDeleteFolder={deleteFolderAt}
                      onDeleteFile={deleteFileAt}
                      onRenameFile={renameFileAt}
                    />
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="p-6 text-sm text-muted-foreground">
                Select or add a project.
              </div>
            )}
          </div>

          <div className="flex flex-col min-h-0">
            {selected && selectedFileContent !== null ? (
              <ArchFileEditor
                key={`${selected.projectId}/${selected.folderPath.join("/")}/${selected.fileName}`}
                pathLabel={[...selected.folderPath, selected.fileName].join("/")}
                content={selectedFileContent}
                onChange={updateFileContent}
              />
            ) : (
              <div className="p-6 text-sm text-muted-foreground">
                Select a file to edit its contents.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
