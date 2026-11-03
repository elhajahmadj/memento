export type AiProvider =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openrouter"
  | "azure_openai"
  | "groq"
  | "deepseek"
  | "mistral";

export type EditorMode = "create" | "edit" | "rotate";

export interface EditorState {
  open: boolean;
  mode: EditorMode;
  editingId: string | null;
  name: string;
  provider: AiProvider;
  apiKey: string;
  model: string;
  endpointUrl: string;
  apiVersion: string;
  refererUrl: string;
  appName: string;
  isDefault: boolean;
}
