export type FixSelectorInitialTab = "ai" | "repick" | "advanced";

export interface FixSelectorContext {
  selector: string;
  errorMessage?: string | undefined;
  actionDescription?: string | undefined;
  pageUrl?: string | undefined;
  /** Bounded HTML snippet captured by the validation runner at failure. */
  domSnippet?: string | undefined;
  priorSteps?: string[] | undefined;
  /**
   * Source of the failing step — used by the re-pick session to look
   * up the recording and (best-effort) replay prior steps so the page
   * is in the right state before the user clicks. Threaded from the
   * server's `step-failed` event via `failedAt`.
   */
  source?:
    | {
        filePath: string;
        kind: string;
        methodName: string | null;
        stepIndex: number;
      }
    | undefined;
}

export interface AiAvailability {
  available: boolean;
  reason?: string | null;
  message?: string | null;
  setupHref?: string | null;
  provider?: string | null;
}

export type HealVia = "ai" | "repick" | "advanced";

export interface AiApplyMetadata {
  provider: string;
  model: string | null;
  confidence: "high" | "medium" | "low";
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface RepickStartResult {
  sessionId: string;
  screenshotBase64: string;
  viewport: { width: number; height: number };
  pageUrl: string;
}

export interface RepickPickResult {
  selector: string;
  strategy: string;
  text: string | null;
  screenshotBase64: string;
}

export interface HealSite {
  location: string;
  before: string;
  after: string;
}

export interface HealDetail {
  filePath: string;
  kind: string;
  methodName: string | null;
  replacements: number;
  sites?: HealSite[];
}

export interface HealFileDetail {
  filePath: string;
  keys: string[];
  replacements: number;
  sites?: HealSite[];
}

export interface HealResult {
  oldSelector: string;
  newSelector: string;
  totalReplacements: number;
  recordingsChanged: number;
  details: HealDetail[];
  filesChanged: number;
  fileDetails: HealFileDetail[];
}

export interface AiSuggestion {
  suggestedSelector: string;
  confidence: "high" | "medium" | "low";
  explanation: string;
  model: string | null;
  provider: string;
  tokensIn: number | null;
  tokensOut: number | null;
}
