export type RecordingLanguage = "csharp" | "python" | "nodejs" | "java";

export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type NamePromptItem = {
  index: number;
  suggested: string;
  actionType: string;
  decoratedSuggestion?: string | undefined;
  language?: RecordingLanguage | undefined;
};

export type UndoEntry = {
  kind: "delete" | "rename";
  index: number;
  previousMethodName?: string | null;
};

export type FillPromptState = {
  label: string;
  kind: "input" | "textarea" | "contenteditable";
  selector: string;
  /**
   * Value-only mode, used while browsing an open-browser session before
   * it is attached. The text is typed into the live page and nothing is
   * recorded, so there is no action to name — the dialog hides its name
   * field and submits `typeOnly` instead of `fill`.
   */
  nameless?: boolean;
};
