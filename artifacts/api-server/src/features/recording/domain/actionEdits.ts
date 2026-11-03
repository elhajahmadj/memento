import type { RecordedAction } from "@/features/codegen/domain/types";

export interface BuiltAssertion {
  ok: true;
  assertion: RecordedAction;
  kind: NonNullable<RecordedAction["assertKind"]>;
}
export interface BuiltAssertionError {
  ok: false;
  message: string;
}

/**
 * Validate an `add-assertion` websocket payload and turn it into a
 * `RecordedAction`. Centralises the per-kind required-field rules so
 * the WS handler stays compact and so the same shape can be reused by
 * `edit-action-value` later if needed.
 *
 * Behavior MUST match the original in-line implementation in
 * `recordingService.ts` (lines 1901-2134 pre-split) verbatim — error
 * messages, defaulting rules, and field names are all part of the
 * websocket contract the workbench depends on.
 */
export function buildAssertionFromMessage(
  msg: Record<string, unknown>,
): BuiltAssertion | BuiltAssertionError {
  const kindRaw = msg.assertKind;
  const validKinds = [
    "element-has-text",
    "url-contains",
    "url-equals",
    "element-visible",
    "element-hidden",
    "element-count-equals",
    "attribute-equals",
    "value-equals",
    "response-status",
    "api-status",
    "accessibility",
    "visual-baseline",
  ] as const;
  if (
    typeof kindRaw !== "string" ||
    !(validKinds as readonly string[]).includes(kindRaw)
  ) {
    return {
      ok: false,
      message: `assertKind must be one of: ${validKinds.join(", ")}`,
    };
  }
  const kind = kindRaw as (typeof validKinds)[number];
  const sel = typeof msg.selector === "string" ? msg.selector.trim() : "";
  const requireSelector = (): BuiltAssertionError | null =>
    sel ? null : { ok: false, message: `${kind} requires a selector` };
  switch (kind) {
    case "element-has-text": {
      const err = requireSelector();
      if (err) return err;
      return {
        ok: true,
        kind,
        assertion: {
          type: "assert",
          assertKind: "element-has-text",
          selector: sel,
          assertText:
            typeof msg.assertText === "string" ? msg.assertText : "",
        },
      };
    }
    case "url-contains":
    case "url-equals": {
      const url = typeof msg.assertUrl === "string" ? msg.assertUrl : "";
      if (!url) {
        return {
          ok: false,
          message: `${kind} requires a non-empty assertUrl`,
        };
      }
      return {
        ok: true,
        kind,
        assertion: { type: "assert", assertKind: kind, assertUrl: url },
      };
    }
    case "element-visible":
    case "element-hidden": {
      const err = requireSelector();
      if (err) return err;
      return {
        ok: true,
        kind,
        assertion: { type: "assert", assertKind: kind, selector: sel },
      };
    }
    case "element-count-equals": {
      const err = requireSelector();
      if (err) return err;
      const count =
        typeof msg.assertCount === "number" &&
        Number.isFinite(msg.assertCount)
          ? Math.floor(msg.assertCount)
          : NaN;
      if (!Number.isFinite(count) || count < 0) {
        return {
          ok: false,
          message: "element-count-equals requires assertCount >= 0",
        };
      }
      return {
        ok: true,
        kind,
        assertion: {
          type: "assert",
          assertKind: kind,
          selector: sel,
          assertCount: count,
        },
      };
    }
    case "attribute-equals": {
      const err = requireSelector();
      if (err) return err;
      const attr =
        typeof msg.assertAttribute === "string"
          ? msg.assertAttribute.trim()
          : "";
      if (!attr) {
        return {
          ok: false,
          message: "attribute-equals requires assertAttribute",
        };
      }
      return {
        ok: true,
        kind,
        assertion: {
          type: "assert",
          assertKind: kind,
          selector: sel,
          assertAttribute: attr,
          assertAttrValue:
            typeof msg.assertAttrValue === "string" ? msg.assertAttrValue : "",
        },
      };
    }
    case "value-equals": {
      const err = requireSelector();
      if (err) return err;
      return {
        ok: true,
        kind,
        assertion: {
          type: "assert",
          assertKind: kind,
          selector: sel,
          assertValue:
            typeof msg.assertValue === "string" ? msg.assertValue : "",
        },
      };
    }
    case "response-status": {
      const code =
        typeof msg.assertStatusCode === "number" &&
        Number.isFinite(msg.assertStatusCode)
          ? Math.floor(msg.assertStatusCode)
          : NaN;
      if (!Number.isFinite(code) || code < 100 || code > 599) {
        return {
          ok: false,
          message:
            "response-status requires assertStatusCode in [100, 599]",
        };
      }
      return {
        ok: true,
        kind,
        assertion: {
          type: "assert",
          assertKind: kind,
          assertStatusCode: code,
        },
      };
    }
    case "api-status": {
      const url = typeof msg.apiUrl === "string" ? msg.apiUrl.trim() : "";
      if (!url) {
        return {
          ok: false,
          message: "api-status requires a non-empty apiUrl",
        };
      }
      const method =
        typeof msg.apiMethod === "string" &&
        ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(msg.apiMethod)
          ? (msg.apiMethod as "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
          : "GET";
      const status =
        typeof msg.apiExpectedStatus === "number" &&
        msg.apiExpectedStatus >= 100 &&
        msg.apiExpectedStatus < 600
          ? msg.apiExpectedStatus
          : 200;
      const expectedJson =
        typeof msg.apiExpectedJson === "string" &&
        msg.apiExpectedJson.trim().length > 0
          ? msg.apiExpectedJson
          : undefined;
      return {
        ok: true,
        kind,
        assertion: {
          type: "assert",
          assertKind: "api-status",
          apiUrl: url,
          apiMethod: method,
          apiExpectedStatus: status,
          apiExpectedJson: expectedJson,
        },
      };
    }
    case "accessibility": {
      const impactRaw =
        typeof msg.axeImpactLevel === "string" ? msg.axeImpactLevel : "";
      const impact: "minor" | "moderate" | "serious" | "critical" =
        impactRaw === "minor" ||
        impactRaw === "moderate" ||
        impactRaw === "serious" ||
        impactRaw === "critical"
          ? impactRaw
          : "serious";
      return {
        ok: true,
        kind,
        assertion: {
          type: "assert",
          assertKind: "accessibility",
          axeImpactLevel: impact,
        },
      };
    }
    case "visual-baseline": {
      const name =
        typeof msg.visualName === "string" && msg.visualName.trim().length > 0
          ? msg.visualName.trim().replace(/[^A-Za-z0-9_-]+/g, "-")
          : "baseline";
      const threshold =
        typeof msg.visualThreshold === "number" &&
        msg.visualThreshold >= 0 &&
        msg.visualThreshold <= 1
          ? msg.visualThreshold
          : 0.02;
      return {
        ok: true,
        kind,
        assertion: {
          type: "assert",
          assertKind: "visual-baseline",
          visualName: name,
          visualThreshold: threshold,
        },
      };
    }
  }
}

export interface EditApplied {
  ok: true;
  field: string;
  previousValue: string | number;
}
export interface EditError {
  ok: false;
  message: string;
}

/**
 * Apply an `edit-action-value` patch in place. Patches are constrained
 * by the action's `type` / `assertKind` so a typo can be fixed without
 * letting the user reshape an action into something it isn't.
 */
export function applyEditToAction(
  a: RecordedAction,
  msg: Record<string, unknown>,
): EditApplied | EditError {
  if (a.type === "fill" || a.type === "select") {
    if (typeof msg.value !== "string") {
      return { ok: false, message: "value must be a string" };
    }
    const previousValue = a.value ?? "";
    a.value = msg.value;
    return { ok: true, field: "value", previousValue };
  }
  if (a.type === "navigate") {
    if (typeof msg.url !== "string" || !msg.url) {
      return { ok: false, message: "url must be a non-empty string" };
    }
    const previousValue = a.url ?? "";
    a.url = msg.url;
    return { ok: true, field: "url", previousValue };
  }
  if (a.type !== "assert") {
    return {
      ok: false,
      message: `cannot edit value on action type ${a.type}`,
    };
  }
  switch (a.assertKind) {
    case "element-has-text": {
      if (typeof msg.assertText !== "string") {
        return { ok: false, message: "assertText must be a string" };
      }
      const previousValue = a.assertText ?? "";
      a.assertText = msg.assertText;
      return { ok: true, field: "assertText", previousValue };
    }
    case "url-contains":
    case "url-equals": {
      if (typeof msg.assertUrl !== "string" || !msg.assertUrl) {
        return {
          ok: false,
          message: "assertUrl must be a non-empty string",
        };
      }
      const previousValue = a.assertUrl ?? "";
      a.assertUrl = msg.assertUrl;
      return { ok: true, field: "assertUrl", previousValue };
    }
    case "element-count-equals": {
      const n =
        typeof msg.assertCount === "number" && Number.isFinite(msg.assertCount)
          ? Math.floor(msg.assertCount)
          : NaN;
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, message: "assertCount must be >= 0" };
      }
      const previousValue = a.assertCount ?? 0;
      a.assertCount = n;
      return { ok: true, field: "assertCount", previousValue };
    }
    case "attribute-equals": {
      if (typeof msg.assertAttrValue !== "string") {
        return { ok: false, message: "assertAttrValue must be a string" };
      }
      const previousValue = a.assertAttrValue ?? "";
      a.assertAttrValue = msg.assertAttrValue;
      if (typeof msg.assertAttribute === "string" && msg.assertAttribute) {
        a.assertAttribute = msg.assertAttribute;
      }
      return { ok: true, field: "assertAttrValue", previousValue };
    }
    case "value-equals": {
      if (typeof msg.assertValue !== "string") {
        return { ok: false, message: "assertValue must be a string" };
      }
      const previousValue = a.assertValue ?? "";
      a.assertValue = msg.assertValue;
      return { ok: true, field: "assertValue", previousValue };
    }
    case "response-status": {
      const n =
        typeof msg.assertStatusCode === "number" &&
        Number.isFinite(msg.assertStatusCode)
          ? Math.floor(msg.assertStatusCode)
          : NaN;
      if (!Number.isFinite(n) || n < 100 || n > 599) {
        return {
          ok: false,
          message: "assertStatusCode must be in [100, 599]",
        };
      }
      const previousValue = a.assertStatusCode ?? 200;
      a.assertStatusCode = n;
      return { ok: true, field: "assertStatusCode", previousValue };
    }
    case "element-visible":
    case "element-hidden":
    default:
      return {
        ok: false,
        message: `assertion ${String(a.assertKind)} has no editable value`,
      };
  }
}

/**
 * Find the array index of the previous/next non-deleted action neighbour
 * relative to `idx`. Returns null when no such neighbour exists.
 */
export function findVisibleNeighbor(
  actions: RecordedAction[],
  idx: number,
  dir: "up" | "down",
): number | null {
  if (dir === "up") {
    for (let i = idx - 1; i >= 0; i--) {
      if (!actions[i]!.deleted) return i;
    }
    return null;
  }
  for (let i = idx + 1; i < actions.length; i++) {
    if (!actions[i]!.deleted) return i;
  }
  return null;
}
