/**
 * Folder row in the tests tree — recursive. Renders a collapsible
 * folder with a tri-state checkbox that toggles every method
 * underneath, plus a rolled-up totals badge.
 */
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
} from "lucide-react";
import type { DiscoveredTestFolder } from "@workspace/api-client-react";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  collectMethodIds,
  formatTotals,
  tristateFor,
} from "@/features/workbench/domain/tests-tree/tree-rules";
import { FileRow } from "./file-row";

export interface FolderRowProps {
  folder: DiscoveredTestFolder;
  depth: number;
  selected: ReadonlySet<string>;
  toggleMany: (ids: string[], next: boolean) => void;
  toggleOne: (id: string, next: boolean) => void;
  isRoot?: boolean;
}

export function FolderRow({
  folder,
  depth,
  selected,
  toggleMany,
  toggleOne,
  isRoot = false,
}: FolderRowProps) {
  const [open, setOpen] = useState(true);
  const ids = useMemo(() => collectMethodIds(folder), [folder]);
  const tri = tristateFor(ids, selected);
  return (
    <div data-testid={`tests-tree-folder-${folder.path}`}>
      <div
        className="flex items-center gap-2 px-2 py-1 text-xs hover-elevate rounded-sm cursor-pointer"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={tri}
            onCheckedChange={(v) => toggleMany(ids, v === true)}
            data-testid={
              isRoot
                ? "tests-tree-root-checkbox"
                : `tests-tree-folder-checkbox-${folder.path}`
            }
            aria-label={`Select all in ${folder.name}`}
          />
        </span>
        {open ? (
          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <FolderIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="truncate flex-1 font-medium" title={folder.name}>
          {folder.name}
        </span>
        <span
          className="text-[10px] text-muted-foreground font-mono"
          data-testid={
            isRoot
              ? "tests-tree-root-totals"
              : `tests-tree-folder-totals-${folder.path}`
          }
        >
          {formatTotals(folder.totals)}
        </span>
      </div>
      {open &&
        folder.children.map((child) =>
          child.type === "folder" ? (
            <FolderRow
              key={child.path}
              folder={child}
              depth={depth + 1}
              selected={selected}
              toggleMany={toggleMany}
              toggleOne={toggleOne}
            />
          ) : (
            <FileRow
              key={child.path}
              file={child}
              depth={depth + 1}
              selected={selected}
              toggleMany={toggleMany}
              toggleOne={toggleOne}
            />
          ),
        )}
    </div>
  );
}
