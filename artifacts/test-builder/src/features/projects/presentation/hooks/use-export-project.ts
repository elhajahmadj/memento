import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  downloadProjectZip,
  type Language,
} from "@workspace/api-client-react";

export interface ExportProjectInput {
  solutionName: string;
  language?: Language | undefined;
  /**
   * Optional path to the project marker file on the server. When omitted,
   * the API zips whichever project the caller has currently loaded.
   */
  slnPath?: string | undefined;
}

/**
 * Derived label for an export button. C# / .NET solutions are exported as
 * "Solutions"; everything else (Python, Node.js, Java, or unknown) is just
 * a "Project".
 */
export function exportButtonLabel(language?: Language): string {
  return language === "csharp" ? "Export Solution" : "Export Project";
}

/**
 * Single shared download helper used by both the workstation toolbar and
 * the projects-list rows. Hits the generated `downloadProjectZip` client,
 * saves the resulting Blob as `<solutionName>.zip`, and shows a toast on
 * failure. Returns an `isExporting` flag so callers can disable their
 * button while a download is in flight.
 */
export function useExportProject(): {
  exportProject: (input: ExportProjectInput) => Promise<void>;
  isExporting: boolean;
} {
  const [isExporting, setIsExporting] = useState(false);

  const exportProject = useCallback(async (input: ExportProjectInput) => {
    setIsExporting(true);
    try {
      const blob = await downloadProjectZip(
        input.slnPath ? { slnPath: input.slnPath } : undefined,
      );
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${input.solutionName}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to export project",
      );
    } finally {
      setIsExporting(false);
    }
  }, []);

  return { exportProject, isExporting };
}
