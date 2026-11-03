import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useGenerateTestMethod,
  getGetProjectTreeQueryKey,
  getGetFileContentQueryKey,
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
import { ensureAsyncSuffix } from "@/features/codegen";

import { invalidateDiscoveredTests } from "@/features/workbench/presentation/lib/invalidate-discovered-tests";

export function AddTestMethodDialog({
  filePath,
  onClose,
}: {
  filePath: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  // C# convention: every async test method ends in `Async`. We detect
  // C# from the file extension here (rather than refetching the
  // current project) and surface the suffixed form as a live preview.
  // The server enforces the same rule — this is purely cosmetic.
  const isCsharp = (filePath ?? "").toLowerCase().endsWith(".cs");
  const trimmedName = name.trim();
  // Non-C# languages must be a strict no-op: forward the raw input
  // verbatim (no trimming, no suffixing) so we don't introduce any
  // subtle behavior change for Python/Node/Java users.
  const finalName = isCsharp ? ensureAsyncSuffix(trimmedName) : name;
  const showAsyncPreview =
    isCsharp && !!trimmedName && finalName !== trimmedName;
  const gen = useGenerateTestMethod({
    mutation: {
      onSuccess: async () => {
        toast.success("Method added");
        await qc.invalidateQueries({
          queryKey: getGetFileContentQueryKey({ path: filePath ?? "" }),
        });
        await qc.invalidateQueries({ queryKey: getGetProjectTreeQueryKey() });
        await invalidateDiscoveredTests(qc);
        setName("");
        onClose();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed"),
    },
  });
  return (
    <Dialog open={!!filePath} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add test method</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {filePath}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ItShouldDoTheThing"
          data-testid="input-new-method"
        />
        {showAsyncPreview && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="hint-method-async-preview"
          >
            Will be generated as <code>{finalName}</code> (C# async convention).
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              filePath &&
              gen.mutate({
                data: { filePath, methodName: finalName },
              })
            }
            disabled={!name || gen.isPending}
            data-testid="button-confirm-method"
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
