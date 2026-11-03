import { useState } from "react";
import { Download, FileCode2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getFileContent } from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";

/**
 * <JmxFilesPanel /> — JMX-mode equivalent of the Tests tab.
 *
 * For JMX projects the conventional test discovery returns nothing
 * (there's no source code), so the Tests tab instead lists the
 * `.jmx` plans recorded into the project's `jmx/` folder. The list
 * is read from `project.jmxFiles` (mirrors `.testbuilder.json#jmxFiles`)
 * and refreshed by invalidating the current-project query after a
 * Stop Recording.
 *
 * Clicking download fetches the file via `GET /files/contents` and
 * triggers a browser save — same per-file mechanism the workbench
 * already uses for editor reads, just rendered as a blob. We chose
 * this over the project-zip route so the user gets the single `.jmx`
 * they just recorded rather than the whole project tarball.
 */
export function JmxFilesPanel({
  jmxFiles,
  embedCredentialsWarning,
}: {
  jmxFiles: string[];
  embedCredentialsWarning: boolean;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (relPath: string) => {
    setDownloading(relPath);
    try {
      const res = await getFileContent({ path: relPath });
      const blob = new Blob([res.content], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = relPath.split("/").pop() ?? "recording.jmx";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to download JMX file",
      );
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="h-full flex flex-col" data-testid="jmx-files-panel">
      <div className="h-9 flex items-center px-3 border-b border-sidebar-border text-xs font-mono uppercase tracking-wider text-muted-foreground">
        JMX files
      </div>
      {embedCredentialsWarning && (
        <div
          className="m-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200"
          data-testid="warning-jmx-embed-credentials"
        >
          This JMX contains credentials in plaintext XML. Use only for
          local testing.
        </div>
      )}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {jmxFiles.length === 0 ? (
            <div
              className="p-3 text-xs text-muted-foreground"
              data-testid="jmx-files-empty"
            >
              No `.jmx` recordings yet. Click Start Recording to capture
              one.
            </div>
          ) : (
            jmxFiles.map((relPath) => (
              <div
                key={relPath}
                className="flex items-center gap-2 px-2 py-1 rounded-sm hover-elevate text-xs"
                data-testid={`jmx-file-row-${relPath}`}
              >
                <FileCode2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-mono truncate flex-1" title={relPath}>
                  {relPath}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  disabled={downloading === relPath}
                  onClick={() => {
                    void handleDownload(relPath);
                  }}
                  aria-label={`Download ${relPath}`}
                  data-testid={`button-download-jmx-${relPath}`}
                >
                  {downloading === relPath ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
