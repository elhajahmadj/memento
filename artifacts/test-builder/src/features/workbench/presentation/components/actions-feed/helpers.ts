import type { RecordedActionMsg } from "@/features/workbench/domain/types";

/**
 * Whether a recorded action exposes a single editable value the user can
 * tweak after the fact. Mirrors the server-side `applyEditToAction`
 * switch in `recordingService` — keep these in sync. Pure visibility
 * assertions (`element-visible`/`element-hidden`) carry no value.
 */
export function isEditableAction(a: RecordedActionMsg): boolean {
  if (a.type === "fill" || a.type === "select" || a.type === "navigate") {
    return true;
  }
  if (a.type !== "assert") return false;
  switch (a.assertKind) {
    case "element-has-text":
    case "url-contains":
    case "url-equals":
    case "element-count-equals":
    case "attribute-equals":
    case "value-equals":
    case "response-status":
      return true;
    case "element-visible":
    case "element-hidden":
    default:
      return false;
  }
}

/**
 * Resolve the human-readable label and the current value for the
 * editable field on a recorded action. Used by `EditValueDialog` to
 * pre-fill the input and label the prompt.
 */
export function describeEditable(a: RecordedActionMsg): {
  label: string;
  value: string;
  kind: "text" | "number";
} {
  if (a.type === "fill") {
    return { label: "Typed text", value: a.value ?? "", kind: "text" };
  }
  if (a.type === "select") {
    return { label: "Selected option", value: a.value ?? "", kind: "text" };
  }
  if (a.type === "navigate") {
    return { label: "URL", value: a.url ?? "", kind: "text" };
  }
  switch (a.assertKind) {
    case "element-has-text":
      return { label: "Expected text", value: a.assertText ?? "", kind: "text" };
    case "url-contains":
    case "url-equals":
      return { label: "Expected URL", value: a.assertUrl ?? "", kind: "text" };
    case "element-count-equals":
      return {
        label: "Expected count",
        value: String(a.assertCount ?? 0),
        kind: "number",
      };
    case "attribute-equals":
      return {
        label: `Expected value of ${a.assertAttribute ?? "attribute"}`,
        value: a.assertAttrValue ?? "",
        kind: "text",
      };
    case "value-equals":
      return { label: "Expected value", value: a.assertValue ?? "", kind: "text" };
    case "response-status":
      return {
        label: "Expected status code",
        value: String(a.assertStatusCode ?? 200),
        kind: "number",
      };
    default:
      return { label: "Value", value: "", kind: "text" };
  }
}
