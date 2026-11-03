import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { ApprovalFileDiff } from "@workspace/api-client-react";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { languageFor } from "../../domain/syntax-highlight";
import { toSideBySide } from "../../domain/diff-rows";
import { HighlightedLine } from "./highlighted-line";

export function DiffView({ detail }: { detail: ApprovalFileDiff }) {
  const lang = useMemo(() => languageFor(detail.path), [detail.path]);
  const rows = useMemo(() => toSideBySide(detail.lines), [detail.lines]);
  if (detail.binary) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Binary file — diff not shown.
      </div>
    );
  }
  return (
    <div data-testid="diff-view" className="flex flex-col h-full min-h-0">
      <div className="border-b border-card-border px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
        <span className="font-mono truncate flex-1">{detail.path}</span>
        {detail.mainChangedSinceSnapshot === true && (
          <span
            className="inline-flex items-center gap-1 text-amber-500"
            data-testid="diff-view-conflict"
          >
            <AlertTriangle className="h-3 w-3" />
            main changed since snapshot
          </span>
        )}
      </div>
      <ScrollArea className="max-h-[34rem]">
        <table className="w-full text-xs font-mono leading-5 border-collapse">
          <thead className="sticky top-0 bg-card border-b border-card-border">
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th colSpan={2} className="text-left px-2 py-1 w-1/2 border-r border-card-border">
                Main (current)
              </th>
              <th colSpan={2} className="text-left px-2 py-1 w-1/2">
                Submission
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const oldCls =
                r.type === "del" || r.type === "change"
                  ? "bg-red-500/10"
                  : r.type === "add"
                    ? "bg-muted/30"
                    : "";
              const newCls =
                r.type === "add" || r.type === "change"
                  ? "bg-green-500/10"
                  : r.type === "del"
                    ? "bg-muted/30"
                    : "";
              return (
                <tr key={i} className="align-top">
                  <td
                    className="select-none text-right pr-2 pl-2 text-muted-foreground/60 w-10 border-r border-card-border/50"
                    style={{ minWidth: "2.5rem" }}
                  >
                    {r.oldNo ?? ""}
                  </td>
                  <td className={`px-2 whitespace-pre-wrap break-all border-r border-card-border ${oldCls}`}>
                    <HighlightedLine text={r.oldText} lang={lang} />
                  </td>
                  <td
                    className="select-none text-right pr-2 pl-2 text-muted-foreground/60 w-10 border-r border-card-border/50"
                    style={{ minWidth: "2.5rem" }}
                  >
                    {r.newNo ?? ""}
                  </td>
                  <td className={`px-2 whitespace-pre-wrap break-all ${newCls}`}>
                    <HighlightedLine text={r.newText} lang={lang} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
