/**
 * File row in the tests tree. Renders a collapsible test file with a
 * tri-state checkbox that toggles every method in the file.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { DiscoveredTestFile } from "@workspace/api-client-react";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  formatTotals,
  tristateFor,
} from "@/features/workbench/domain/tests-tree/tree-rules";
import { MethodRow } from "./method-row";

export interface FileRowProps {
  file: DiscoveredTestFile;
  depth: number;
  selected: ReadonlySet<string>;
  toggleMany: (ids: string[], next: boolean) => void;
  toggleOne: (id: string, next: boolean) => void;
}

export function FileRow({
  file,
  depth,
  selected,
  toggleMany,
  toggleOne,
}: FileRowProps) {
  const [open, setOpen] = useState(true);
  const ids = useMemo(() => file.methods.map((m) => m.id), [file]);
  const tri = tristateFor(ids, selected);
  return (
    <div data-testid={`tests-tree-file-${file.path}`}>
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
            data-testid={`tests-tree-file-checkbox-${file.path}`}
            aria-label={`Select all in ${file.name}`}
          />
        </span>
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate flex-1 font-mono" title={file.name}>
          {file.name}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {formatTotals(file.totals)}
        </span>
      </div>
      {open &&
        file.methods.map((m) => (
          <MethodRow
            key={m.id}
            method={m}
            depth={depth + 1}
            selected={selected}
            toggleOne={toggleOne}
          />
        ))}
    </div>
  );
}
