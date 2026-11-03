import { useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  Folder,
  FolderOpen,
  FilePlus2,
  FolderPlus,
} from "lucide-react";

import type { TreeNodeT } from "@/features/workbench/domain/types";

export function TreeRow({
  node,
  depth,
  selectedPath,
  onSelect,
  onAddFolder,
  onAddFile,
  onRename,
  onDelete,
  isRoot = false,
}: {
  node: TreeNodeT;
  depth: number;
  selectedPath: string | null;
  onSelect: (n: TreeNodeT) => void;
  onAddFolder: (parent: string) => void;
  onAddFile: (parent: string) => void;
  onRename: (n: TreeNodeT) => void;
  onDelete: (n: TreeNodeT) => void;
  isRoot?: boolean;
}) {
  const [open, setOpen] = useState(isRoot || depth < 2);
  const isSelected = selectedPath === node.path;
  const isFolder = node.type === "folder";

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onClick={() => {
              if (isFolder) setOpen((v) => !v);
              else onSelect(node);
            }}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-sm cursor-pointer text-sm hover-elevate ${
              isSelected ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
            }`}
            style={{ paddingLeft: depth * 12 + 8 }}
            data-testid={`tree-node-${node.path.replace(/\//g, "-")}`}
          >
            {isFolder ? (
              <>
                {open ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                {open ? (
                  <FolderOpen className="h-4 w-4 text-primary shrink-0" />
                ) : (
                  <Folder className="h-4 w-4 text-primary shrink-0" />
                )}
              </>
            ) : (
              <>
                <span className="w-3.5 shrink-0" />
                <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              </>
            )}
            <span className="truncate">{node.name}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {isFolder && (
            <>
              <ContextMenuItem onClick={() => onAddFolder(node.path)}>
                <FolderPlus className="h-4 w-4 mr-2" />
                Add Folder
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onAddFile(node.path)}>
                <FilePlus2 className="h-4 w-4 mr-2" />
                Add Class
              </ContextMenuItem>
            </>
          )}
          {!isRoot && (
            <>
              <ContextMenuItem onClick={() => onRename(node)}>
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => onDelete(node)}
                className="text-destructive focus:text-destructive"
              >
                Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {isFolder && open && node.children && (
        <div>
          {node.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onAddFolder={onAddFolder}
              onAddFile={onAddFile}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
