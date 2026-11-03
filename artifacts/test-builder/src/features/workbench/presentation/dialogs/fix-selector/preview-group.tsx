import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { HealSite } from "./types";

/**
 * One file / recording entry in the dry-run preview. Collapsed by
 * default — click expands to show every before/after snippet.
 */
export function PreviewGroup({
  title,
  subtitle,
  count,
  sites,
  testid,
}: {
  title: string;
  subtitle?: string;
  count: number;
  sites: HealSite[];
  testid?: string;
}) {
  const [open, setOpen] = useState(false);
  const Caret = open ? ChevronDown : ChevronRight;
  return (
    <li className="rounded border bg-background" data-testid={testid}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/50"
        data-testid={testid ? `${testid}-toggle` : undefined}
        aria-expanded={open}
      >
        <Caret className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-xs font-mono">
          {title}
          {subtitle ? (
            <span className="text-muted-foreground"> {subtitle}</span>
          ) : null}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {count}×
        </span>
      </button>
      {open && (
        <ul
          className="space-y-1 border-t px-2 py-1.5"
          data-testid={testid ? `${testid}-sites` : undefined}
        >
          {sites.length === 0 ? (
            <li className="text-[11px] italic text-muted-foreground">
              No detailed snippets available.
            </li>
          ) : (
            sites.map((s, i) => (
              <li key={i} className="space-y-0.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {s.location}
                </div>
                <pre className="whitespace-pre-wrap break-all rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] font-mono text-red-700 dark:text-red-300">
                  - {s.before}
                </pre>
                <pre className="whitespace-pre-wrap break-all rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                  + {s.after}
                </pre>
              </li>
            ))
          )}
        </ul>
      )}
    </li>
  );
}
