import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import type {
  ReplayEventBus,
  ValidationRunRepository,
  ValidationStartArgs,
} from "../ports";

/**
 * Thrown when a project already has a queued/running validation run and
 * the caller tries to start another. Routes map this to HTTP 409.
 */
export class ActiveValidationRunError extends Error {
  readonly code = "ACTIVE_VALIDATION_RUN" as const;
  constructor(public readonly activeRunId: string) {
    super(
      "A validation run is already in progress for this project. Wait for it to finish before starting another.",
    );
    this.name = "ActiveValidationRunError";
  }
}

export interface EnqueueValidationRunDeps {
  repo: ValidationRunRepository;
  events: ReplayEventBus;
  schedule(args: ValidationStartArgs & { runId: string }): void;
}

/**
 * Insert a queued run row + enqueue it on the in-process worker. The
 * single-active-run guard is bypassed for child runs of a validate-all
 * fanout (they pass `parentRunId`).
 */
export function makeEnqueueValidationRun(deps: EnqueueValidationRunDeps) {
  const { repo, events, schedule } = deps;
  return async function enqueueValidationRun(
    args: ValidationStartArgs,
  ): Promise<string> {
    const project = args.project ?? getCurrentProject(args.userId) ?? null;
    if (!project) throw new Error("No project loaded");
    if (!args.parentRunId) {
      const active = await repo.findActiveForProject(project.solutionName);
      if (active) throw new ActiveValidationRunError(active);
    }
    // Tag session-scoped runs in the summary blob from the start so a
    // discard-during-queued-state can still find and remove them.
    const initialSummary: Record<string, unknown> = args.inlineActions
      ? { source: "session", sessionToken: args.inlineActions.sessionToken }
      : {};
    const { id } = await repo.insertQueued({
      projectName: project.solutionName,
      parentRunId: args.parentRunId ?? null,
      recordingFilePath: args.filePath,
      recordingKind: args.kind,
      recordingMethodName: args.methodName ?? null,
      triggeredByUserId: args.userId,
      summary: initialSummary,
    });
    events.push(id, { type: "run-queued", runId: id });
    schedule({ ...args, runId: id });
    return id;
  };
}
