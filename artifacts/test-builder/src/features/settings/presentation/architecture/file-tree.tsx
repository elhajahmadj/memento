import {
  ChevronDown,
  ChevronRight,
  Folder,
  FileText,
  FolderPlus,
  FilePlus2,
  Trash2,
  Pencil,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import type {
  ArchProject,
  ArchFolder,
  ArchFile,
} from "@workspace/api-client-react";

export interface SelectedFile {
  projectId: string;
  folderPath: string[];
  fileName: string;
}

interface FileTreeProps {
  project: ArchProject;
  folders: ArchFolder[];
  files: ArchFile[];
  folderPath: string[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  selected: SelectedFile | null;
  onSelect: (s: SelectedFile) => void;
  onAddFolder: (folderPath: string[]) => void;
  onAddFile: (folderPath: string[]) => void;
  onDeleteFolder: (folderPath: string[], name: string) => void;
  onDeleteFile: (folderPath: string[], name: string) => void;
  onRenameFile: (folderPath: string[], name: string) => void;
}

export function FileTree(props: FileTreeProps) {
  const {
    folders,
    files,
    folderPath,
    expanded,
    onToggle,
    selected,
    onSelect,
    onAddFolder,
    onAddFile,
    onDeleteFolder,
    onDeleteFile,
    onRenameFile,
    project,
  } = props;
  return (
    <ul className="space-y-0.5 text-sm">
      {folders.map((f) => {
        const childPath = [...folderPath, f.name];
        const key = childPath.join("/");
        const isOpen = expanded.has(key);
        return (
          <li key={`d-${key}`}>
            <div className="flex items-center group rounded hover-elevate px-1">
              <button
                className="flex items-center flex-1 gap-1 py-1"
                onClick={() => onToggle(key)}
                data-testid={`tree-folder-${key}`}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{f.name}</span>
              </button>
              <div className="opacity-0 group-hover:opacity-100 flex">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => onAddFolder(childPath)}
                  title="New folder"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => onAddFile(childPath)}
                  title="New file"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive"
                  onClick={() => onDeleteFolder(folderPath, f.name)}
                  title="Delete folder"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {isOpen && (
              <div className="ml-4 border-l border-border pl-2">
                <FileTree
                  project={project}
                  folders={f.folders}
                  files={f.files}
                  folderPath={childPath}
                  expanded={expanded}
                  onToggle={onToggle}
                  selected={selected}
                  onSelect={onSelect}
                  onAddFolder={onAddFolder}
                  onAddFile={onAddFile}
                  onDeleteFolder={onDeleteFolder}
                  onDeleteFile={onDeleteFile}
                  onRenameFile={onRenameFile}
                />
              </div>
            )}
          </li>
        );
      })}
      {files.map((f) => {
        const key = [...folderPath, f.name].join("/");
        const isSelected =
          selected?.projectId === project.id &&
          selected?.fileName === f.name &&
          selected.folderPath.join("/") === folderPath.join("/");
        return (
          <li key={`f-${key}`}>
            <div
              className={`flex items-center group rounded px-1 ${
                isSelected ? "bg-accent" : "hover-elevate"
              }`}
            >
              <button
                className="flex items-center flex-1 gap-1 py-1"
                onClick={() =>
                  onSelect({
                    projectId: project.id,
                    folderPath,
                    fileName: f.name,
                  })
                }
                data-testid={`tree-file-${key}`}
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground ml-3" />
                <span className="font-mono">{f.name}</span>
              </button>
              <div className="opacity-0 group-hover:opacity-100 flex">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => onRenameFile(folderPath, f.name)}
                  title="Rename"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive"
                  onClick={() => onDeleteFile(folderPath, f.name)}
                  title="Delete file"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
