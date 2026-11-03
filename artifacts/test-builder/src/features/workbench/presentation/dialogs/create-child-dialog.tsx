import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useGetCurrentProject,
  useCreateFile,
  useCreateFolder,
  getGetProjectTreeQueryKey,
  getListTestClassesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

import { invalidateDiscoveredTests } from "@/features/workbench/presentation/lib/invalidate-discovered-tests";

export function CreateChildDialog({
  kind,
  parent,
  onClose,
}: {
  kind: "folder" | "file";
  parent: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(kind === "file" ? "NewClass.cs" : "NewFolder");
  const project = useGetCurrentProject().data?.project;

  const cf = useCreateFolder({
    mutation: {
      onSuccess: async () => {
        toast.success("Folder created");
        await qc.invalidateQueries({ queryKey: getGetProjectTreeQueryKey() });
        await invalidateDiscoveredTests(qc);
        onClose();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed"),
    },
  });
  const cFile = useCreateFile({
    mutation: {
      onSuccess: async () => {
        toast.success("File created");
        await qc.invalidateQueries({ queryKey: getGetProjectTreeQueryKey() });
        await qc.invalidateQueries({ queryKey: getListTestClassesQueryKey() });
        await invalidateDiscoveredTests(qc);
        onClose();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed"),
    },
  });

  const submit = () => {
    if (!parent) return;
    const childPath = parent === "." ? name : `${parent}/${name}`;
    if (kind === "folder") cf.mutate({ data: { path: childPath } });
    else {
      const ns = project?.namespace ?? "App";
      const className = name.replace(/\.cs$/, "");
      const stub = `namespace ${ns}\n{\n    public class ${className}\n    {\n    }\n}\n`;
      cFile.mutate({ data: { path: childPath, content: stub } });
    }
  };

  return (
    <Dialog open={!!parent} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            New {kind} in {parent}
          </DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid={`input-new-${kind}`}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!name || cf.isPending || cFile.isPending}
            data-testid={`button-confirm-${kind}`}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
