import { Loader2, KeyRound } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
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
import { applyProviderChange } from "./helpers";
import { DEFAULT_MODELS, PROVIDER_DEFINITIONS, PROVIDER_OPTIONS } from "./providers";
import type { AiProvider, EditorState } from "./types";

interface Props {
  editor: EditorState;
  setEditor: (next: EditorState | ((s: EditorState) => EditorState)) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}

export function KeyEditorDialog({
  editor,
  setEditor,
  onClose,
  onSave,
  saving,
}: Props) {
  const dialogTitle =
    editor.mode === "create"
      ? "Add API key"
      : editor.mode === "rotate"
        ? "Rotate API key"
        : "Edit API key";

  const providerDef = PROVIDER_DEFINITIONS[editor.provider];
  const ConditionalFields = providerDef.ConditionalFields;
  const modelHint = providerDef.modelHint ?? {
    helperText: "(leave blank to use provider default)",
    placeholder: DEFAULT_MODELS[editor.provider],
  };

  return (
    <Dialog open={editor.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <KeyRound className="inline h-4 w-4 mr-1.5" />
            {dialogTitle}
          </DialogTitle>
          <DialogDescription>
            {editor.mode === "rotate"
              ? "Provide the new API key. Provider and friendly name are kept."
              : "Friendly name, provider, and provider-specific settings. The API key is encrypted at rest."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {editor.mode !== "rotate" ? (
            <>
              <div>
                <Label htmlFor="ai-key-name">Name</Label>
                <Input
                  id="ai-key-name"
                  value={editor.name}
                  onChange={(e) =>
                    setEditor((s) => ({ ...s, name: e.target.value }))
                  }
                  placeholder="e.g. Shared Anthropic key"
                  data-testid="input-ai-keys-name"
                />
              </div>
              <div>
                <Label>Provider</Label>
                <Select
                  value={editor.provider}
                  onValueChange={(v) =>
                    setEditor((s) => applyProviderChange(s, v as AiProvider))
                  }
                >
                  <SelectTrigger data-testid="select-ai-keys-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>
                  Model{" "}
                  <span className="text-xs text-muted-foreground ml-1">
                    {modelHint.helperText}
                  </span>
                </Label>
                <Input
                  value={editor.model}
                  onChange={(e) =>
                    setEditor((s) => ({ ...s, model: e.target.value }))
                  }
                  placeholder={modelHint.placeholder}
                  data-testid="input-ai-keys-model"
                />
              </div>
              {ConditionalFields ? (
                <ConditionalFields
                  endpointUrl={editor.endpointUrl}
                  apiVersion={editor.apiVersion}
                  refererUrl={editor.refererUrl}
                  appName={editor.appName}
                  onPatch={(patch) =>
                    setEditor((s) => ({ ...s, ...patch }))
                  }
                />
              ) : null}
            </>
          ) : null}
          <div>
            <Label htmlFor="ai-key-secret">
              {editor.mode === "rotate"
                ? "New API key"
                : editor.mode === "edit"
                  ? "API key (leave blank to keep existing)"
                  : "API key"}
            </Label>
            <Input
              id="ai-key-secret"
              type="password"
              value={editor.apiKey}
              onChange={(e) =>
                setEditor((s) => ({ ...s, apiKey: e.target.value }))
              }
              autoComplete="off"
              placeholder={
                editor.mode === "edit"
                  ? "Use Rotate to change the stored key"
                  : "Provider API key"
              }
              disabled={editor.mode === "edit"}
              data-testid="input-ai-keys-secret"
            />
          </div>
          {editor.mode === "create" ? (
            <div className="flex items-center gap-2">
              <input
                id="ai-key-default"
                type="checkbox"
                checked={editor.isDefault}
                onChange={(e) =>
                  setEditor((s) => ({ ...s, isDefault: e.target.checked }))
                }
                data-testid="checkbox-ai-keys-default"
              />
              <Label htmlFor="ai-key-default" className="cursor-pointer">
                Make this the default key for the organization
              </Label>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={saving}
            data-testid="button-ai-keys-save"
          >
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
