import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/shared/ui/checkbox";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { PreviewGroup } from "./preview-group";
import type { HealResult } from "./types";

/**
 * The dry-run preview body shared by both the AI and Advanced tabs.
 * Shows the change summary, every site grouped by file/recording, and
 * an "I've reviewed these changes" acknowledgement that gates Apply.
 *
 * The ack auto-confirms when the content already fits without scrolling
 * (no point forcing a scroll on a one-line diff).
 */
export function HealPreviewPanel({
  preview,
  acknowledged,
  onAcknowledgedChange,
}: {
  preview: HealResult;
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onAcknowledgedChange(false);
    const id = window.setTimeout(() => {
      const el = scrollRef.current;
      if (!el) {
        onAcknowledgedChange(true);
        return;
      }
      if (el.scrollHeight <= el.clientHeight + 2) {
        onAcknowledgedChange(true);
      }
    }, 0);
    return () => window.clearTimeout(id);
    // We deliberately depend only on `preview` so a parent re-render
    // doesn't reset the ack while the user is reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  const fileTotal = useMemo(
    () => preview.fileDetails.reduce((s, d) => s + d.replacements, 0),
    [preview],
  );

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
      onAcknowledgedChange(true);
    }
  };

  return (
    <div className="rounded border bg-muted/40 p-2 space-y-2">
      <div className="text-xs">
        Will replace <strong>{preview.totalReplacements}</strong>{" "}
        occurrence{preview.totalReplacements === 1 ? "" : "s"} across{" "}
        <strong>{preview.recordingsChanged}</strong>{" "}
        recording{preview.recordingsChanged === 1 ? "" : "s"}
        {preview.filesChanged > 0 ? (
          <>
            {" "}and <strong>{fileTotal}</strong>{" "}
            occurrence{fileTotal === 1 ? "" : "s"} across{" "}
            <strong>{preview.filesChanged}</strong> selectors file
            {preview.filesChanged === 1 ? "" : "s"}
          </>
        ) : null}
        . Expand any row to see the before/after snippet.
      </div>
      <ScrollArea className="max-h-72">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="max-h-72 space-y-3 overflow-auto pr-1"
          data-testid="heal-preview-scroll"
        >
          {preview.details.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Recordings
              </div>
              <ul
                className="space-y-1"
                data-testid="heal-preview-recordings"
              >
                {preview.details.map((d, i) => (
                  <PreviewGroup
                    key={`rec-${i}`}
                    testid={`heal-preview-recording-${i}`}
                    title={d.filePath}
                    subtitle={
                      d.methodName ? `→ ${d.methodName}` : `(${d.kind})`
                    }
                    count={d.replacements}
                    sites={d.sites ?? []}
                  />
                ))}
              </ul>
            </div>
          )}
          {preview.fileDetails.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Selectors files
              </div>
              <ul className="space-y-1" data-testid="heal-preview-files">
                {preview.fileDetails.map((d, i) => (
                  <PreviewGroup
                    key={`file-${i}`}
                    testid={`heal-preview-file-${i}`}
                    title={d.filePath}
                    subtitle={
                      d.keys.length > 0 ? `→ ${d.keys.join(", ")}` : ""
                    }
                    count={d.replacements}
                    sites={d.sites ?? []}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      </ScrollArea>
      {preview.totalReplacements > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(v) => onAcknowledgedChange(v === true)}
            data-testid="checkbox-ack-heal"
          />
          <span>
            I&apos;ve reviewed these changes
            {acknowledged ? "" : " (or scroll to the bottom of the list)"}
            .
          </span>
        </label>
      )}
    </div>
  );
}

export function useHealApi() {
  const [busy, setBusy] = useState(false);
  return { busy, setBusy };
}
