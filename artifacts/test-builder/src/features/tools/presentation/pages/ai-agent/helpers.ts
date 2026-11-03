import type { AiAgentKey } from "@workspace/api-client-react";
import { DEFAULT_MODELS, PROVIDER_DEFINITIONS } from "./providers";
import type { AiProvider, EditorState } from "./types";

export function formatKeyLabel(k: AiAgentKey): string {
  return `${k.name} — ${k.provider} ••••${k.apiKeyLastFour}`;
}

export function extractErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === "object") {
    if ("data" in e) {
      const data = (e as { data: unknown }).data;
      if (data && typeof data === "object" && "error" in data) {
        const msg = (data as { error: unknown }).error;
        if (typeof msg === "string" && msg.trim()) return msg;
      }
    }
    if ("message" in e) {
      const msg = (e as { message: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
  }
  return fallback;
}

export function extractBoundProjects(e: unknown): string[] | null {
  if (!e || typeof e !== "object" || !("data" in e)) return null;
  const data = (e as { data: unknown }).data;
  if (!data || typeof data !== "object") return null;
  if (!("boundProjects" in data)) return null;
  const list = (data as { boundProjects: unknown }).boundProjects;
  if (!Array.isArray(list)) return null;
  return list.filter((s): s is string => typeof s === "string");
}

export function formatRelative(ts: number, nowTick: number): string {
  const seconds = Math.max(0, Math.round((nowTick - ts) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function trimDetail(s: string | null | undefined): string {
  if (!s) return "";
  const trimmed = s.trim();
  if (trimmed.length <= 400) return trimmed;
  return `${trimmed.slice(0, 400)}…`;
}

export function applyProviderChange(
  state: EditorState,
  next: AiProvider,
): EditorState {
  const def = PROVIDER_DEFINITIONS[next];
  const defModel = def.defaultModel;
  const knownDefault = Object.values(DEFAULT_MODELS).some(
    (m) => m === state.model,
  );
  const nextModel = !state.model.trim() || knownDefault ? defModel : state.model;
  const intermediate: EditorState = {
    ...state,
    provider: next,
    model: nextModel,
  };
  const patch = def.applyDefaults?.(intermediate) ?? {};
  return { ...intermediate, ...patch };
}

export function validateEditor(editor: EditorState): string | null {
  const name = editor.name.trim();
  if (editor.mode !== "rotate" && !name) return "Name is required";
  if (editor.mode === "create" && !editor.apiKey.trim())
    return "API key is required";
  if (editor.mode === "rotate" && !editor.apiKey.trim())
    return "New API key is required";
  const def = PROVIDER_DEFINITIONS[editor.provider];
  return def.validate?.(editor) ?? null;
}
