import { Button } from "@/shared/ui/button";
import { Code2 } from "lucide-react";
import { toast } from "sonner";
import { vscodeFileUrl } from "@/features/workbench/domain/types";

export function OpenInVscodeButton({ rootPath }: { rootPath: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        window.location.href = vscodeFileUrl(rootPath);
        toast.info(
          `Asked VS Code to open ${rootPath}. If nothing happens, install VS Code or check your protocol handler.`,
          { duration: 8000 },
        );
      }}
      title={`Open ${rootPath} in VS Code`}
      data-testid="button-open-in-vscode"
    >
      <Code2 className="h-4 w-4 mr-2" />
      Open in VS Code
    </Button>
  );
}
