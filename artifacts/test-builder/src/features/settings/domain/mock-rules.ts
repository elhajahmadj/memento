import type { RouteMockMethod } from "@workspace/api-client-react";

export const MOCK_METHODS: RouteMockMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

export interface MockDraft {
  id?: string;
  name: string;
  method: RouteMockMethod;
  urlPattern: string;
  status: string;
  bodyJson: string;
  enabled: boolean;
}

export interface ValidatedMock {
  name: string;
  method: RouteMockMethod;
  urlPattern: string;
  status: number;
  bodyJson: unknown;
  enabled: boolean;
}

export type ValidateMockResult =
  | { ok: true; value: ValidatedMock }
  | { ok: false; error: string };

/**
 * Pure validation for the Settings → Mocks add/edit dialog. Trims the
 * name + URL, parses the status as an int in 100–599, and parses the
 * (optional) body as JSON.
 */
export function validateMockDraft(draft: MockDraft): ValidateMockResult {
  const name = draft.name.trim();
  const urlPattern = draft.urlPattern.trim();
  if (!name || !urlPattern) {
    return { ok: false, error: "Name and URL pattern are required" };
  }
  const status = Number(draft.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return { ok: false, error: "Status must be 100–599" };
  }
  let bodyJson: unknown = null;
  if (draft.bodyJson.trim()) {
    try {
      bodyJson = JSON.parse(draft.bodyJson);
    } catch {
      return { ok: false, error: "Body must be valid JSON" };
    }
  }
  return {
    ok: true,
    value: {
      name,
      method: draft.method,
      urlPattern,
      status,
      bodyJson,
      enabled: draft.enabled,
    },
  };
}
