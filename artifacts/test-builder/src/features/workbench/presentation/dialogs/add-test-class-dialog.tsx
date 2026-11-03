import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useGenerateTestClass,
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

export function AddTestClassDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const gen = useGenerateTestClass({
    mutation: {
      onSuccess: async () => {
        toast.success("Test class created");
        await Promise.all([
          qc.invalidateQueries({ queryKey: getListTestClassesQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetProjectTreeQueryKey() }),
          invalidateDiscoveredTests(qc),
        ]);
        setName("");
        onOpenChange(false);
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed"),
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New test suite</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="LoginTests"
          data-testid="input-new-test-class"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => gen.mutate({ data: { className: name } })}
            disabled={!name || gen.isPending}
            data-testid="button-confirm-test-class"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
