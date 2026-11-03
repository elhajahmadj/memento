import path from "node:path";
import { Router, type IRouter } from "express";
import { z } from "zod";

import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  detectProjectInfo,
  solutionNameFromMainProjectPath,
} from "@/features/projects/infrastructure/projectService";
import { enforceProjectOrgAccess } from "@/features/auth/infrastructure/orgScope";

import { discoverProjectTests } from "../infrastructure/discoveryService";
import {
  dispatchSelectionRun,
  getSelectionRun,
  groupTestIdsByLanguage,
} from "../infrastructure/runDispatcher";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

const RunBySelectionBody = z.object({
  testIds: z.array(z.string().min(1)).min(1),
});

/**
 * Resolve the `:projectId` URL param (the URL-encoded `slnPath`) to a
 * canonical project. Returns `null` after sending an HTTP error if the
 * caller isn't allowed to see the project, the path is outside the
 * workspace, or the marker file no longer exists.
 */
async function loadAuthorizedProject(
  req: import("express").Request,
  res: import("express").Response,
): Promise<{
  slnPath: string;
  rootPath: string;
  projectName: string;
  solutionType?: import("@/features/projects/infrastructure/projectService").Project["solutionType"];
} | null> {
  const raw = req.params["projectId"];
  if (typeof raw !== "string" || raw.length === 0) {
    res.status(400).json({ error: "Missing projectId" });
    return null;
  }
  const slnPath = path.resolve(decodeURIComponent(raw));
  const wsRoot = path.resolve(recorderConfig.workspaceDir);
  if (!slnPath.startsWith(wsRoot + path.sep)) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  const solutionName = solutionNameFromMainProjectPath(slnPath);
  if (!solutionName) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  const ok = await enforceProjectOrgAccess(req, res, solutionName);
  if (!ok) return null;
  let project;
  try {
    project = await detectProjectInfo(slnPath);
  } catch {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  return {
    slnPath: project.slnPath,
    rootPath: project.rootPath,
    projectName: project.solutionName,
    solutionType: project.solutionType,
  };
}

function defaultKindForSolutionType(
  st:
    | import("@/features/projects/infrastructure/projectService").Project["solutionType"]
    | undefined,
): import("../domain/types").TestKind {
  // Threaded into `classifyMethod` so untagged tests in a scaffolded
  // Playwright UI project (`{Sln}.Tests/Tests/*.cs`) classify as `e2e`
  // instead of falling through to `unit` and disappearing from the
  // workbench "Build with AI → Add method to existing suite" dropdown
  // when the user picks the Playwright (UI) test kind.
  if (st === "api") return "api";
  return "e2e";
}

router.get(
  "/projects/:projectId/tests",
  async (req, res): Promise<void> => {
    const project = await loadAuthorizedProject(req, res);
    if (!project) return;
    const tree = await discoverProjectTests({
      projectName: project.projectName,
      slnPath: project.slnPath,
      rootPath: project.rootPath,
      defaultKind: defaultKindForSolutionType(project.solutionType),
    });
    res.json(tree);
  },
);

router.post(
  "/projects/:projectId/runs/by-selection",
  async (req, res): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const project = await loadAuthorizedProject(req, res);
    if (!project) return;
    const parsed = RunBySelectionBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const groups = groupTestIdsByLanguage(parsed.data.testIds);
    // Each entry is a flat `InternalTestRun`-shaped record with the
    // language + selected test ids tacked on, so the existing
    // run-detail surface can render it without a wrapper unwrap.
    const runs = [...groups.entries()].map(([language, testIds]) => {
      const run = dispatchSelectionRun({
        language,
        rootPath: project.rootPath,
        testIds,
        user: { id: req.user!.id, username: req.user!.username },
        projectKey: project.slnPath,
      });
      return { ...run, language, testIds };
    });
    res.json({ runs });
  },
);

router.get(
  "/projects/:projectId/runs/by-selection/:runId",
  async (req, res): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const project = await loadAuthorizedProject(req, res);
    if (!project) return;
    const runId = req.params["runId"];
    if (typeof runId !== "string" || runId.length === 0) {
      res.status(400).json({ error: "Missing runId" });
      return;
    }
    const run = getSelectionRun(runId);
    // Scope check: a run id is only readable through *its own* project
    // URL. Even though we already enforced org access on `:projectId`,
    // mismatched project + runId pairs return 404 (not 403) so we
    // don't leak the existence of unrelated runs.
    if (!run || run.projectKey !== project.slnPath) {
      res.status(404).json({ error: "Selection run not found" });
      return;
    }
    res.json(run);
  },
);

export default router;
