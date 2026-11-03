import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import { Download, Loader2 } from "lucide-react";
import type { Language } from "@workspace/api-client-react";
import { exportButtonLabel } from "@/features/projects/presentation/hooks/use-export-project";

export function ExportItem({
  isExporting,
  language,
  onExport,
}: {
  isExporting: boolean;
  language?: Language | undefined;
  onExport: () => void;
}) {
  return (
    <DropdownMenuItem
      onClick={onExport}
      disabled={isExporting}
      data-testid="button-download-zip"
    >
      {isExporting ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Download className="h-4 w-4 mr-2" />
      )}
      {exportButtonLabel(language)}
    </DropdownMenuItem>
  );
}
