import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  useListAiAgentKeys,
  useCreateAiAgentKey,
  useUpdateAiAgentKey,
  useDeleteAiAgentKey,
  useSetDefaultAiAgentKey,
  getListAiAgentKeysQueryKey,
  type AiAgentKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import {
  extractBoundProjects,
  extractErrorMessage,
  validateEditor,
} from "./ai-agent/helpers";
import { DEFAULT_MODELS, PROVIDER_DEFINITIONS } from "./ai-agent/providers";
import { EMPTY_PAYLOAD_FIELDS } from "./ai-agent/providers/types";
import { KeyEditorDialog } from "./ai-agent/key-editor-dialog";
import { KeyListRow } from "./ai-agent/key-list-row";
import {
  KeyBoundConflictDialog,
  KeyDeleteDialog,
  type DeleteConflict,
} from "./ai-agent/key-delete-dialogs";
import type { AiProvider, EditorState } from "./ai-agent/types";

const EMPTY_EDITOR: EditorState = {
  open: false,
  mode: "create",
  editingId: null,
  name: "",
  provider: "anthropic",
  apiKey: "",
  model: DEFAULT_MODELS.anthropic,
  endpointUrl: "",
  apiVersion: "",
  refererUrl: "",
  appName: "",
  isDefault: false,
};

export function AiAgentKeysSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useListAiAgentKeys();
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [deleting, setDeleting] = useState<AiAgentKey | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<DeleteConflict | null>(
    null,
  );

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListAiAgentKeysQueryKey() });

  const create = useCreateAiAgentKey({
    mutation: {
      onSuccess: async () => {
        toast.success("AI key created");
        setEditor(EMPTY_EDITOR);
        await invalidate();
      },
      onError: (e: Error) =>
        toast.error(extractErrorMessage(e, "Failed to create key")),
    },
  });

  const update = useUpdateAiAgentKey({
    mutation: {
      onSuccess: async () => {
        toast.success("AI key updated");
        setEditor(EMPTY_EDITOR);
        await invalidate();
      },
      onError: (e: Error) =>
        toast.error(extractErrorMessage(e, "Failed to update key")),
    },
  });

  const setDefault = useSetDefaultAiAgentKey({
    mutation: {
      onMutate: async ({ id }): Promise<{ previous?: { keys: AiAgentKey[] } }> => {
        const queryKey = getListAiAgentKeysQueryKey();
        await qc.cancelQueries({ queryKey });
        const previous = qc.getQueryData<{ keys: AiAgentKey[] }>(queryKey);
        if (previous) {
          qc.setQueryData<{ keys: AiAgentKey[] }>(queryKey, {
            keys: previous.keys.map((k) => ({
              ...k,
              isDefault: k.id === id,
            })),
          });
        }
        return previous ? { previous } : {};
      },
      onError: (
        e: Error,
        _vars,
        ctx: { previous?: { keys: AiAgentKey[] } } | undefined,
      ) => {
        if (ctx?.previous) {
          qc.setQueryData(getListAiAgentKeysQueryKey(), ctx.previous);
        }
        toast.error(extractErrorMessage(e, "Failed to set default"));
      },
      onSuccess: async () => {
        toast.success("Default key updated");
        await invalidate();
      },
    },
  });

  const remove = useDeleteAiAgentKey({
    mutation: {
      onSuccess: async () => {
        toast.success("AI key deleted");
        setDeleting(null);
        await invalidate();
      },
      onError: (e: unknown) => {
        const status =
          e && typeof e === "object" && "status" in e
            ? (e as { status: unknown }).status
            : undefined;
        const message = extractErrorMessage(e, "Failed to delete key");
        const bound = extractBoundProjects(e);
        if (status === 409 && bound && deleting) {
          setDeleteConflict({
            id: deleting.id,
            boundProjects: bound,
            message,
          });
          setDeleting(null);
          return;
        }
        if (status === 409) {
          toast.error(message);
          setDeleting(null);
          return;
        }
        toast.error(message);
      },
    },
  });

  const openAdd = () =>
    setEditor({ ...EMPTY_EDITOR, open: true, mode: "create" });

  const openEdit = (row: AiAgentKey) =>
    setEditor({
      open: true,
      mode: "edit",
      editingId: row.id,
      name: row.name,
      provider: row.provider as AiProvider,
      apiKey: "",
      model: row.model ?? DEFAULT_MODELS[row.provider as AiProvider] ?? "",
      endpointUrl: row.endpointUrl ?? "",
      apiVersion: row.apiVersion ?? "",
      refererUrl: row.refererUrl ?? "",
      appName: row.appName ?? "",
      isDefault: row.isDefault,
    });

  const openRotate = (row: AiAgentKey) =>
    setEditor({
      open: true,
      mode: "rotate",
      editingId: row.id,
      name: row.name,
      provider: row.provider as AiProvider,
      apiKey: "",
      model: row.model ?? DEFAULT_MODELS[row.provider as AiProvider] ?? "",
      endpointUrl: row.endpointUrl ?? "",
      apiVersion: row.apiVersion ?? "",
      refererUrl: row.refererUrl ?? "",
      appName: row.appName ?? "",
      isDefault: row.isDefault,
    });

  function handleSave() {
    const err = validateEditor(editor);
    if (err) {
      toast.error(err);
      return;
    }
    const trimmedKey = editor.apiKey.trim();
    const fields =
      PROVIDER_DEFINITIONS[editor.provider].buildPayloadFields?.(editor) ??
      EMPTY_PAYLOAD_FIELDS;
    if (editor.mode === "create") {
      create.mutate({
        data: {
          name: editor.name.trim(),
          provider: editor.provider,
          apiKey: trimmedKey,
          model: editor.model.trim() || null,
          endpointUrl: fields.endpointUrl,
          apiVersion: fields.apiVersion,
          refererUrl: fields.refererUrl,
          appName: fields.appName,
          isDefault: editor.isDefault,
        },
      });
      return;
    }
    if (!editor.editingId) return;
    if (editor.mode === "rotate") {
      update.mutate({
        id: editor.editingId,
        data: { apiKey: trimmedKey },
      });
      return;
    }
    update.mutate({
      id: editor.editingId,
      data: {
        name: editor.name.trim(),
        provider: editor.provider,
        model: editor.model.trim() ? editor.model.trim() : null,
        endpointUrl: fields.endpointUrl,
        apiVersion: fields.apiVersion,
        refererUrl: fields.refererUrl,
        appName: fields.appName,
      },
    });
  }

  const rows = data?.keys ?? [];
  const saving = create.isPending || update.isPending;

  return (
    <div className="space-y-3" data-testid="section-ai-agent-keys">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Manage AI provider keys for this organization. The key marked
          Default is used by every project unless it overrides it. Keys are
          encrypted at rest and never returned in plain text.
        </p>
        <Button size="sm" onClick={openAdd} data-testid="button-ai-keys-add">
          <Plus className="h-4 w-4 mr-1.5" />
          Add key
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No AI keys yet. Click <span className="font-medium">Add key</span>{" "}
          to create one.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <KeyListRow
              key={row.id}
              row={row}
              onSetDefault={(id) => setDefault.mutate({ id })}
              setDefaultPending={setDefault.isPending}
              onRotate={openRotate}
              onEdit={openEdit}
              onDelete={setDeleting}
            />
          ))}
        </ul>
      )}

      <KeyEditorDialog
        editor={editor}
        setEditor={setEditor}
        onClose={() => setEditor(EMPTY_EDITOR)}
        onSave={handleSave}
        saving={saving}
      />

      <KeyDeleteDialog
        deleting={deleting}
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate({ id: deleting.id });
        }}
      />

      <KeyBoundConflictDialog
        conflict={deleteConflict}
        onClose={() => setDeleteConflict(null)}
      />
    </div>
  );
}
