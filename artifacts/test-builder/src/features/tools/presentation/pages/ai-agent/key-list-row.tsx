import { Pencil, RotateCcw, Star, Trash2 } from "lucide-react";
import type { AiAgentKey } from "@workspace/api-client-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { PROVIDER_LABEL } from "./providers";
import type { AiProvider } from "./types";

interface Props {
  row: AiAgentKey;
  onSetDefault: (id: string) => void;
  setDefaultPending: boolean;
  onRotate: (row: AiAgentKey) => void;
  onEdit: (row: AiAgentKey) => void;
  onDelete: (row: AiAgentKey) => void;
}

export function KeyListRow({
  row,
  onSetDefault,
  setDefaultPending,
  onRotate,
  onEdit,
  onDelete,
}: Props) {
  return (
    <li
      className="rounded-md border border-border bg-card px-4 py-3"
      data-testid={`row-ai-keys-${row.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.name}</span>
            {row.isDefault ? (
              <Badge
                variant="secondary"
                data-testid={`badge-ai-keys-default-${row.id}`}
              >
                Default
              </Badge>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {PROVIDER_LABEL[row.provider as AiProvider] ?? row.provider} ·{" "}
            {row.model ?? "—"} · ••••{row.apiKeyLastFour} · updated{" "}
            {new Date(row.updatedAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!row.isDefault ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetDefault(row.id)}
              disabled={setDefaultPending}
              data-testid={`button-ai-keys-set-default-${row.id}`}
            >
              <Star className="h-4 w-4 mr-1.5" />
              Set default
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRotate(row)}
            data-testid={`button-ai-keys-rotate-${row.id}`}
          >
            <RotateCcw className="h-4 w-4 mr-1.5" />
            Rotate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(row)}
            data-testid={`button-ai-keys-edit-${row.id}`}
          >
            <Pencil className="h-4 w-4 mr-1.5" />
            Edit settings
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(row)}
            data-testid={`button-ai-keys-delete-${row.id}`}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Delete
          </Button>
        </div>
      </div>
    </li>
  );
}
