import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

export type ValidationStepStatus = "pending" | "running" | "passed" | "failed";

export interface ValidationStep {
  index: number;
  type: RecordedAction["type"];
  selector: string | null;
  selectorStrategy: RecordedAction["selectorStrategy"] | null;
  value: string | null;
  status: ValidationStepStatus;
  durationMs: number | null;
  error: string | null;
  /**
   * For type === "assert" steps, which Playwright assertion to evaluate.
   * Carries through to the panel so a failed step can label what was
   * being checked. Includes the synthetic `route-mock` value used by
   * `apiAssertion` / `routeMock` recorded actions so the dashboard can
   * render them under their own icon.
   */
  assertKind?: RecordedAction["assertKind"] | "route-mock" | null;
  /**
   * Tier-1 power-assertion fields. Each is only populated for the
   * `assertKind` it belongs to; the runner picks the field it needs.
   */
  assertCount?: number | null;
  assertAttribute?: string | null;
  assertAttrValue?: string | null;
  assertValue?: string | null;
  assertStatusCode?: number | null;
  /** For type === "wait" steps, which wait primitive to invoke. */
  waitKind?: RecordedAction["waitKind"] | null;
  /** For wait[selector] steps, the selector to wait for. */
  waitSelector?: string | null;
  /** For wait[timeout] steps, the duration in milliseconds. */
  waitMs?: number | null;
}

/** Hard ceilings to keep validation runs from monopolising the container. */
export const MAX_STEPS = 500;
export const MAX_RUN_DURATION_MS = 60_000;
export const PER_STEP_TIMEOUT_MS = 10_000;
export const REACHABILITY_TIMEOUT_MS = 5_000;
