import type { ComponentType } from "react";
import type { AiProvider, EditorState } from "../types";

export interface ConditionalFieldsValue {
  endpointUrl: string;
  apiVersion: string;
  refererUrl: string;
  appName: string;
}

export interface ConditionalFieldsProps extends ConditionalFieldsValue {
  onPatch: (patch: Partial<ConditionalFieldsValue>) => void;
}

export interface ProviderPayloadFields {
  endpointUrl: string | null;
  apiVersion: string | null;
  refererUrl: string | null;
  appName: string | null;
}

export const EMPTY_PAYLOAD_FIELDS: ProviderPayloadFields = {
  endpointUrl: null,
  apiVersion: null,
  refererUrl: null,
  appName: null,
};

export interface ProviderModelHint {
  helperText: string;
  placeholder: string;
}

export interface ProviderDefinition {
  value: AiProvider;
  label: string;
  shortLabel: string;
  defaultModel: string;
  ConditionalFields: ComponentType<ConditionalFieldsProps> | null;
  modelHint?: ProviderModelHint;
  applyDefaults?: (state: EditorState) => Partial<EditorState>;
  validate?: (editor: EditorState) => string | null;
  buildPayloadFields?: (editor: EditorState) => ProviderPayloadFields;
}
