import type { RouteMockMethod } from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { MOCK_METHODS, type MockDraft } from "../../domain/mock-rules";

interface MockEditDialogProps {
  draft: MockDraft | null;
  onChange: (draft: MockDraft) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}

export function MockEditDialog({
  draft,
  onChange,
  onClose,
  onSave,
  saving,
}: MockEditDialogProps) {
  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-edit-mock">
        <DialogHeader>
          <DialogTitle>{draft?.id ? "Edit mock" : "Add mock"}</DialogTitle>
          <DialogDescription>
            The URL pattern uses Playwright glob syntax (e.g.{" "}
            <code>**/api/users/me</code>).
          </DialogDescription>
        </DialogHeader>
        {draft && (
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => onChange({ ...draft, name: e.target.value })}
                data-testid="input-mock-name"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Method</Label>
                <Select
                  value={draft.method}
                  onValueChange={(v) =>
                    onChange({ ...draft, method: v as RouteMockMethod })
                  }
                >
                  <SelectTrigger data-testid="select-mock-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOCK_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Status</Label>
                <Input
                  type="number"
                  min="100"
                  max="599"
                  value={draft.status}
                  onChange={(e) =>
                    onChange({ ...draft, status: e.target.value })
                  }
                  data-testid="input-mock-status"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">URL pattern</Label>
              <Input
                value={draft.urlPattern}
                onChange={(e) =>
                  onChange({ ...draft, urlPattern: e.target.value })
                }
                className="font-mono text-xs"
                data-testid="input-mock-url"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Response body (JSON, optional)
              </Label>
              <Textarea
                rows={6}
                value={draft.bodyJson}
                onChange={(e) =>
                  onChange({ ...draft, bodyJson: e.target.value })
                }
                className="font-mono text-xs"
                data-testid="input-mock-body"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(checked) =>
                  onChange({ ...draft, enabled: checked })
                }
                data-testid="switch-mock-enabled-edit"
              />
              <Label className="text-xs">Enabled</Label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            data-testid="button-cancel-mock"
          >
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={saving}
            data-testid="button-save-mock"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
