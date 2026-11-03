import type { ValidationStatus } from "@workspace/api-client-react";

export interface A11yViolation {
  id: string;
  impact: string | null;
  help: string;
  description: string;
  nodes: Array<{ target: string[]; html: string }>;
}

export interface VisualDiff {
  name: string;
  ratio: number;
  threshold: number;
  diffPath: string;
  created?: boolean;
}

export interface StepEvent {
  index: number;
  description: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  detail?: string | undefined;
  timestamp: string;
  a11y?: A11yViolation[] | undefined;
  visual?: VisualDiff | undefined;
  failedSelector?: string | undefined;
  errorMessage?: string | undefined;
  /** Bounded HTML snippet captured by the validation runner at failure. */
  domSnippet?: string | undefined;
  /** The live page URL at the moment the step failed (separate from preflight). */
  failedPageUrl?: string | undefined;
  /** Source location of the failing step, for re-pick replay. */
  failedAtSource?:
    | {
        filePath: string;
        kind: string;
        methodName: string | null;
        stepIndex: number;
      }
    | undefined;
}

export interface RunState {
  id: string;
  label: string;
  status: ValidationStatus | "connecting";
  steps: StepEvent[];
  message?: string | undefined;
  preflight?: { url: string; ok: boolean; statusCode?: number | undefined; error?: string | undefined } | undefined;
  finishedAt?: string | undefined;
  durationMs?: number | undefined;
  passedChildren?: number | undefined;
  failedChildren?: number | undefined;
  plannedChildren?: number | undefined;
}
