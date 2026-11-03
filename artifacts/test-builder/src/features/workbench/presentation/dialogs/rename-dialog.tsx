import {
  useState,
  useEffect,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useRenameFile,
  getGetProjectTreeQueryKey,
  getListTestClassesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

import { invalidateDiscoveredTests } from "@/features/workbench/presentation/lib/invalidate-discovered-tests";
import type { TreeNodeT } from "@/features/workbench/domain/types";

export function RenameDialog({
  target,
  onClose,
}: {
  target: TreeNodeT | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  useEffect(() => {
    if (target) setName(target.name);
  }, [target]);

  const ren = useRenameFile({
    mutation: {
      onSuccess: async () => {
        toast.success("Renamed");
        await qc.invalidateQueries({ queryKey: getGetProjectTreeQueryKey() });
        await qc.invalidateQueries({ queryKey: getListTestClassesQueryKey() });
        await invalidateDiscoveredTests(qc);
        onClose();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed"),
    },
  });

  const submit = () => {
    if (!target) return;
    const segments = target.path.split("/");
    segments[segments.length - 1] = name;
    const newPath = segments.join("/");
    ren.mutate({ data: { oldPath: target.path, newPath } });
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {target?.path}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="input-rename"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!name || ren.isPending}
            data-testid="button-confirm-rename"
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
