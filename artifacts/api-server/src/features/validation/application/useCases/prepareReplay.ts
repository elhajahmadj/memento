import type {
  AuthStateLoader,
  PreparedReplay,
  ReachabilityProbe,
  RecordingLoader,
  ReplayEventBus,
  ValidationStartArgs,
} from "../ports";
import { actionsToSteps } from "../../domain/actionsToSteps";
import { MAX_STEPS } from "../../domain/validationStep";
import type { Project } from "@/features/projects/infrastructure/projectService";

export type PrepareReplayResult =
  | { ok: true; prepared: PreparedReplay }
  | {
      ok: false;
      status: "error";
      summary: Record<string, unknown>;
    };

export interface PrepareReplayDeps {
  events: ReplayEventBus;
  recordings: RecordingLoader;
  authStates: AuthStateLoader;
  reachability: ReachabilityProbe;
  resolveProject(args: ValidationStartArgs): Project | null;
}

/**
 * Pure orchestration of the "pre-flight" phase of a replay run:
 *   1. resolve the project
 *   2. load the stored recording (or take an inline one)
 *   3. probe the start URL for reachability
 *   4. load class-level hooks when relevant
 *   5. expand recorded actions into a step plan and bound it
 *
 * All side effects (db loads, network probes, auth state lookup) go
 * through ports so this is fully unit-testable without Playwright,
 * Drizzle, or fetch.
 */
export function makePrepareReplay(deps: PrepareReplayDeps) {
  const { events, recordings, authStates, reachability, resolveProject } = deps;

  return async function prepareReplay(
    runId: string,
    args: ValidationStartArgs,
  ): Promise<PrepareReplayResult> {
    const project = args.project ?? resolveProject(args) ?? null;
    if (!project) {
      throw new Error("No project loaded for this validation run");
    }
    const ownerUserId = args.ownerUserId ?? args.userId;

    let stored = null as PreparedReplay["stored"] | null;
    if (args.inlineActions) {
      stored = {
        kind: args.kind,
        urlName: args.inlineActions.urlName,
        startUrl: args.inlineActions.startUrl,
        actions: args.inlineActions.actions,
        methodName: args.methodName ?? null,
      };
    } else if (args.kind === "testMethod") {
      if (!args.methodName) {
        throw new Error("methodName is required for testMethod validation");
      }
      stored = await recordings.loadTestMethodActions({
        userId: ownerUserId,
        projectName: project.solutionName,
        filePath: args.filePath,
        methodName: args.methodName,
      });
    } else {
      stored = await recordings.loadHookActions({
        userId: ownerUserId,
        projectName: project.solutionName,
        filePath: args.filePath,
        kind: args.kind,
      });
    }
    if (!stored) {
      return {
        ok: false,
        status: "error",
        summary: {
          error:
            "No stored recording for this target — only recordings finalized in this version of AutoScriba can be validated.",
        },
      };
    }

    events.push(runId, {
      type: "stage",
      stage: "reachability",
      url: stored.startUrl,
    });
    const probe = await reachability.probe(stored.startUrl);
    events.push(runId, {
      type: "preflight",
      url: stored.startUrl,
      ok: probe.ok,
      statusCode: probe.status,
      error: probe.error,
    });
    if (!probe.ok) {
      const message = `URL not reachable from server — use the C# runner instead. (${stored.startUrl}${probe.error ? `: ${probe.error}` : ""})`;
      return {
        ok: false,
        status: "error",
        summary: { error: message, message, url: stored.startUrl },
      };
    }

    const hookSets = args.kind === "testMethod"
      ? await recordings.loadHooksForClass({
          userId: ownerUserId,
          projectName: project.solutionName,
          filePath: args.filePath,
        })
      : {};

    const steps = actionsToSteps(stored.actions);
    events.push(runId, { type: "plan", steps });

    if (steps.length > MAX_STEPS) {
      return {
        ok: false,
        status: "error",
        summary: { error: `Step count exceeds the ${MAX_STEPS} limit` },
      };
    }

    const storageState =
      (await authStates.load({
        userId: ownerUserId,
        projectName: project.solutionName,
      })) ?? null;

    return {
      ok: true,
      prepared: {
        stored,
        hookSets,
        steps,
        storageState,
        ownerUserId,
        project,
      },
    };
  };
}
