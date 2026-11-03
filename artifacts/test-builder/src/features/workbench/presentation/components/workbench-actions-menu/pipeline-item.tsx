import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import { Workflow } from "lucide-react";

export function PipelineItem({
  onOpenPipelineDialog,
}: {
  onOpenPipelineDialog: () => void;
}) {
  return (
    <DropdownMenuItem
      onClick={onOpenPipelineDialog}
      data-testid="button-generate-pipeline-file"
    >
      <Workflow className="h-4 w-4 mr-2" />
      Generate Pipeline File
    </DropdownMenuItem>
  );
}
