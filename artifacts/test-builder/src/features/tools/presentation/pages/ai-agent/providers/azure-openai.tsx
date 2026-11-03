import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { DEFAULT_AZURE_API_VERSION } from "../constants";
import type { ConditionalFieldsProps, ProviderDefinition } from "./types";

function AzureOpenAiFields({
  endpointUrl,
  apiVersion,
  onPatch,
}: ConditionalFieldsProps) {
  return (
    <>
      <div>
        <Label>Endpoint URL</Label>
        <Input
          value={endpointUrl}
          onChange={(e) => onPatch({ endpointUrl: e.target.value })}
          placeholder="https://my-resource.openai.azure.com"
          data-testid="input-ai-keys-endpoint-url"
        />
      </div>
      <div>
        <Label>API version</Label>
        <Input
          value={apiVersion}
          onChange={(e) => onPatch({ apiVersion: e.target.value })}
          placeholder={DEFAULT_AZURE_API_VERSION}
          data-testid="input-ai-keys-api-version"
        />
      </div>
    </>
  );
}

export const azureOpenAiProvider: ProviderDefinition = {
  value: "azure_openai",
  label: "Azure OpenAI",
  shortLabel: "Azure OpenAI",
  defaultModel: "",
  ConditionalFields: AzureOpenAiFields,
  modelHint: {
    helperText: "(Azure deployment name — required)",
    placeholder: "my-gpt-4o-mini-deployment",
  },
  applyDefaults: (state) =>
    state.apiVersion.trim() ? {} : { apiVersion: DEFAULT_AZURE_API_VERSION },
  validate: (editor) => {
    if (editor.mode !== "rotate" && !editor.endpointUrl.trim())
      return "Azure endpoint URL is required";
    if (editor.mode !== "rotate" && !editor.model.trim())
      return "Azure deployment name (model) is required";
    return null;
  },
  buildPayloadFields: (editor) => ({
    endpointUrl: editor.endpointUrl.trim() || null,
    apiVersion: editor.apiVersion.trim() || DEFAULT_AZURE_API_VERSION,
    refererUrl: null,
    appName: null,
  }),
};
