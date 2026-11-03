import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import type { ConditionalFieldsProps, ProviderDefinition } from "./types";

function OpenRouterFields({
  refererUrl,
  appName,
  onPatch,
}: ConditionalFieldsProps) {
  return (
    <>
      <div>
        <Label>
          HTTP-Referer{" "}
          <span className="text-xs text-muted-foreground">(optional)</span>
        </Label>
        <Input
          value={refererUrl}
          onChange={(e) => onPatch({ refererUrl: e.target.value })}
          placeholder="https://your-site.example"
          data-testid="input-ai-keys-referer-url"
        />
      </div>
      <div>
        <Label>
          App name (X-Title){" "}
          <span className="text-xs text-muted-foreground">(optional)</span>
        </Label>
        <Input
          value={appName}
          onChange={(e) => onPatch({ appName: e.target.value })}
          placeholder="memento"
          data-testid="input-ai-keys-app-name"
        />
      </div>
    </>
  );
}

export const openrouterProvider: ProviderDefinition = {
  value: "openrouter",
  label: "OpenRouter",
  shortLabel: "OpenRouter",
  defaultModel: "anthropic/claude-3.5-haiku",
  ConditionalFields: OpenRouterFields,
  buildPayloadFields: (editor) => ({
    endpointUrl: null,
    apiVersion: null,
    refererUrl: editor.refererUrl.trim() || null,
    appName: editor.appName.trim() || null,
  }),
};
