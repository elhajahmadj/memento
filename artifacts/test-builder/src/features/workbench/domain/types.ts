export interface TreeNodeT {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNodeT[];
}

export interface RecordedActionMsg {
  type: string;
  selector?: string | undefined;
  strategy?: string | undefined;
  value?: string | undefined;
  url?: string | undefined;
  ts?: number | undefined;
  editable?: {
    kind: "input" | "textarea" | "contenteditable";
    label: string;
  } | undefined;
  /** Server-assigned position in the session's recorded-action list. */
  index?: number | undefined;
  /** Auto-generated method name suggestion used to pre-fill the name prompt. */
  suggestedMethodName?: string | null | undefined;
  suggestedNoun?: string | null | undefined;
  decoratedMethodName?: string | null | undefined;
  /** User-chosen method name (set after the user accepts the prompt). */
  methodName?: string | undefined;
  /** UI-added assertion fields (only set when type === "assert"). */
  assertKind?:
    | "element-has-text"
    | "url-contains"
    | "url-equals"
    | "element-visible"
    | "element-hidden"
    | "element-count-equals"
    | "attribute-equals"
    | "value-equals"
    | "response-status"
    | undefined;
  assertText?: string | undefined;
  assertUrl?: string | undefined;
  assertCount?: number | undefined;
  assertAttribute?: string | undefined;
  assertAttrValue?: string | undefined;
  assertValue?: string | undefined;
  assertStatusCode?: number | undefined;
  /** UI-added wait fields (only set when type === "wait"). */
  waitKind?: "selector" | "networkidle" | "timeout" | undefined;
  waitSelector?: string | undefined;
  waitMs?: number | undefined;
  /**
   * T003 Shared steps: set on actions spliced into the live session via
   * a saved macro. The actions feed renders these with a small badge so
   * the user can see at a glance which rows belong to which macro.
   */
  macroName?: string | undefined;
  /**
   * BFF endpoint classification, set only for captured HTTP rows in
   * BFF-mode JMX projects (see `bffEndpointClassifier` on the server).
   * Drives the small coloured tag rendered by `ActionRow`. Absent for
   * every other action type and every non-BFF project so the rest of
   * the recorder UI is visually unchanged.
   */
  bffClass?: "bff" | "idp" | "upstream" | undefined;
}

export interface FrameMsg {
  data: string;
  width: number;
  height: number;
}

/**
 * Build a `vscode://file/...` URL for a project's on-disk root. Normalises
 * Windows paths and prepends a slash when one is missing.
 */
export function vscodeFileUrl(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/");
  const prefix = normalized.startsWith("/") ? "" : "/";
  return `vscode://file${prefix}${normalized}`;
}
