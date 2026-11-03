import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import { ActiveValidationRunError } from "./enqueueValidationRun";
import type {
  AuditRecorder,
  RecordingLoader,
  ReplayEventBus,
  ValidationAllStartArgs,
  ValidationRunRepository,
  ValidationStartArgs,
} from "../ports";

export interface EnqueueValidateAllDeps {
  repo: ValidationRunRepository;
  events: ReplayEventBus;
  audit: AuditRecorder;
  recordings: RecordingLoader;
  enqueueOne(args: ValidationStartArgs): Promise<string>;
  /** Background poll: roll children up into the parent's terminal status. */
  watchParent(parentId: string, childIds: string[]): void;
}

/**
 * Validate every stored recording in the current project, in order.
 * Creates a parent "all" run plus one child run per recording.
 */
export function makeEnqueueValidateAll(deps: EnqueueValidateAllDeps) {
  const { repo, events, audit, recordings, enqueueOne, watchParent } = deps;
  return async function enqueueValidateAll(
    args: ValidationAllStartArgs,
  ): Promise<string> {
    const project = args.project ?? getCurrentProject(args.userId) ?? null;
    if (!project) throw new Error("No project loaded");
    const active = await repo.findActiveForProject(project.solutionName);
    if (active) throw new ActiveValidationRunError(active);
    const eligible = await recordings.listRecordingsForUser({
      userId: args.userId,
      projectName: project.solutionName,
    });
    const parent = await repo.insertQueued({
      projectName: project.solutionName,
      parentRunId: null,
      recordingFilePath: null,
      recordingKind: "all",
      recordingMethodName: null,
      triggeredByUserId: args.userId,
      summary: { plannedChildren: eligible.length },
    });
    events.push(parent.id, {
      type: "run-queued",
      runId: parent.id,
      plannedChildren: eligible.length,
    });
    const childIds: string[] = [];
    for (const r of eligible) {
      const childId = await enqueueOne({
        userId: args.userId,
        ownerUserId: r.userId,
        filePath: r.filePath,
        kind: r.kind,
        methodName: r.methodName ? r.methodName : undefined,
        parentRunId: parent.id,
        project,
      });
      childIds.push(childId);
      try {
        await audit.record({
          user: { id: args.userId },
          project: project.solutionName,
          action: "validation_queued",
          file: r.filePath,
          details: {
            runId: childId,
            parentRunId: parent.id,
            kind: r.kind,
            methodName: r.methodName ?? null,
          },
        });
      } catch {
        // Audit failures must never block the fanout.
      }
    }
    await repo.updateParentRunning({
      parentId: parent.id,
      plannedChildren: eligible.length,
      childIds,
    });
    watchParent(parent.id, childIds);
    return parent.id;
  };
}
