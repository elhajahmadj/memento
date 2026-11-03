import { Router, type IRouter } from "express";
import {
  CloneProjectFromRepoBody,
  GetProjectGitConfigResponse,
  PutProjectGitConfigBody,
  PullProjectGitConfigResponse,
  PushProjectGitConfigBody,
  PushProjectGitConfigResponse,
  ListProjectBranchesResponse,
  CreateProjectBranchBody,
  CreateProjectBranchResponse,
  CheckoutProjectBranchBody,
  CheckoutProjectBranchResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import {
  enforceProjectOrgAccess,
  requireProjectOrgAccess,
  resolveScopePolicy,
} from "@/features/auth/infrastructure/orgScope";
import { getGitConfig } from "@/features/projects/infrastructure/gitConfigRepository";
import { getContainer } from "@/composition/container";
import { detectProjectInfo } from "@/features/projects/infrastructure/projectService";
import { setCurrentProject } from "@/features/projects/infrastructure/projectService";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import { db, projectGitConfigsTable, projectOrganizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs/promises";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

router.post("/projects/clone", requireAdmin, async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = CloneProjectFromRepoBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ errorCode: "invalid_input", message: parsed.error.message });
    return;
  }
  const policy = await resolveScopePolicy(req);
  const activeOrgId = req.session.activeOrgId ?? null;
  if (policy.kind === "none") {
    res.status(400).json({
      errorCode: "invalid_input",
      message:
        "Select an active organization before cloning a project. SSO users must have an active org for new projects to be tenant-scoped.",
    });
    return;
  }
  if (policy.kind === "org" && !activeOrgId) {
    res.status(400).json({
      errorCode: "invalid_input",
      message: "No active organization on session",
    });
    return;
  }

  const result = await getContainer().useCases.gitConfig.cloneProjectFromRepo({
    solutionName: parsed.data.solutionName,
    provider: parsed.data.provider ?? "azure_repos",
    repoUrl: parsed.data.repoUrl,
    branch: parsed.data.branch,
    pat: parsed.data.pat ?? null,
    repoPatId: parsed.data.repoPatId ?? null,
    actingUserId: user.id,
  });

  if (!result.ok) {
    const status = result.code === "project_exists" ? 409 : 400;
    res.status(status).json({ errorCode: result.code, message: result.message });
    return;
  }

  // Stamp the new project with the active org so it's visible to the
  // current SSO tenant and hidden from other orgs (same pattern as
  // POST /projects).
  if (policy.kind === "org") {
    try {
      await db
        .insert(projectOrganizationsTable)
        .values({
          projectName: result.solutionName,
          organizationId: policy.orgId,
        })
        .onConflictDoNothing();
    } catch (stampErr) {
      req.log.warn(
        { err: stampErr, project: result.solutionName },
        "Failed to stamp cloned project with org",
      );
    }
  }

  // Require a recognizable project root marker. Without one, the
  // project would not be indexed by listAvailableProjects() and the
  // user would get a confusing 201 success that doesn't appear in
  // their Projects list. Roll the clone back cleanly instead.
  let inner: string[];
  try {
    inner = await fs.readdir(result.rootPath);
  } catch (err) {
    req.log.error(
      { err, project: result.solutionName },
      "Failed to read cloned project directory",
    );
    await rollbackClone(result.rootPath, result.solutionName, policy.kind === "org" ? policy.orgId : null);
    res.status(400).json({
      errorCode: "git_failed",
      message: "Failed to read cloned project directory.",
    });
    return;
  }
  const sln = inner.find((f) => f.endsWith(".sln"));
  const markerPath = sln
    ? path.join(result.rootPath, sln)
    : inner.includes("pyproject.toml")
      ? path.join(result.rootPath, "pyproject.toml")
      : inner.includes("package.json")
        ? path.join(result.rootPath, "package.json")
        : inner.includes("pom.xml")
          ? path.join(result.rootPath, "pom.xml")
          : inner.includes(".testbuilder.json")
            ? path.join(result.rootPath, ".testbuilder.json")
            : null;
  if (!markerPath) {
    req.log.warn(
      { project: result.solutionName, files: inner.slice(0, 20) },
      "Cloned repo has no recognizable project marker; rolling back",
    );
    await rollbackClone(result.rootPath, result.solutionName, policy.kind === "org" ? policy.orgId : null);
    res.status(400).json({
      errorCode: "invalid_input",
      message:
        "Cloned repository has no recognizable project file (.sln, pyproject.toml, package.json, pom.xml, or .testbuilder.json) at its root.",
    });
    return;
  }

  let project;
  try {
    project = await detectProjectInfo(markerPath);
    // Force the canonical name (directory name) so downstream lookups
    // (project_git_configs, org stamps, assignments) all match.
    project = { ...project, solutionName: result.solutionName };
    // Persist that canonical name by writing/overwriting
    // `.testbuilder.json`. Without this, listAvailableProjects() and
    // loadProject() would later derive solutionName from the cloned
    // .sln basename or an existing marker, drifting from the row in
    // project_git_configs and the org stamp keyed on result.solutionName.
    await writeClonedProjectMarker(result.rootPath, project);
  } catch (err) {
    req.log.error(
      { err, project: result.solutionName, markerPath },
      "Failed to detect project info from clone marker; rolling back",
    );
    await rollbackClone(result.rootPath, result.solutionName, policy.kind === "org" ? policy.orgId : null);
    res.status(400).json({
      errorCode: "invalid_input",
      message: "Cloned repository contents could not be parsed as a memento project.",
    });
    return;
  }

  req.log.info(
    {
      project: result.solutionName,
      provider: parsed.data.provider ?? "azure_repos",
      branch: parsed.data.branch,
    },
    "Cloned project from repo",
  );
  setCurrentProject(project, user.id);
  res.status(201).json(project);
});

function paramString(v: unknown): string {
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

async function writeClonedProjectMarker(
  rootPath: string,
  project: {
    solutionName: string;
    testProjectName: string;
    namespace: string;
    language: string;
    solutionType?: string;
  },
): Promise<void> {
  const markerFile = path.join(rootPath, ".testbuilder.json");
  let existing: Record<string, unknown> = {};
  try {
    const txt = await fs.readFile(markerFile, "utf8");
    const parsed = JSON.parse(txt);
    if (parsed && typeof parsed === "object") existing = parsed;
  } catch {
    // no existing marker — that's fine
  }
  const merged = {
    ...existing,
    architectureId:
      typeof existing.architectureId === "string" && existing.architectureId
        ? existing.architectureId
        : "",
    solutionName: project.solutionName,
    testProjectName: project.testProjectName,
    namespace: project.namespace,
    language: project.language,
    solutionType: project.solutionType,
  };
  await fs.writeFile(markerFile, JSON.stringify(merged, null, 2) + "\n", "utf8");
}

async function rollbackClone(
  rootPath: string,
  solutionName: string,
  orgId: string | null,
): Promise<void> {
  // Best-effort: try every step, log and continue on individual failures
  // so a half-rolled-back state still gets as much cleanup as possible.
  try {
    await fs.rm(rootPath, { recursive: true, force: true });
  } catch {
    // ignore — directory may already be gone
  }
  try {
    await db
      .delete(projectGitConfigsTable)
      .where(eq(projectGitConfigsTable.projectName, solutionName));
  } catch {
    // ignore — row may not exist
  }
  if (orgId) {
    try {
      await db
        .delete(projectOrganizationsTable)
        .where(eq(projectOrganizationsTable.projectName, solutionName));
    } catch {
      // ignore
    }
  }
}

router.get(
  "/projects/:projectName/git-config",
  requireProjectOrgAccess((req) => paramString(req.params.projectName)),
  requireAdmin,
  async (req, res): Promise<void> => {
    const projectName = paramString(req.params.projectName);
    if (!(await enforceProjectOrgAccess(req, res, projectName))) return;
    const cfg = await getGitConfig(projectName);
    res.json(GetProjectGitConfigResponse.parse(cfg));
  },
);

router.put(
  "/projects/:projectName/git-config",
  requireProjectOrgAccess((req) => paramString(req.params.projectName)),
  requireAdmin,
  async (req, res): Promise<void> => {
    const projectName = paramString(req.params.projectName);
    if (!(await enforceProjectOrgAccess(req, res, projectName))) return;
    const parsed = PutProjectGitConfigBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    try {
      const cfg = await getContainer().useCases.gitConfig.upsertGitConfig({
        projectName,
        provider: parsed.data.provider ?? "azure_repos",
        repoUrl: parsed.data.repoUrl,
        branch: parsed.data.branch,
        pat: parsed.data.pat ?? null,
        repoPatId: parsed.data.repoPatId ?? null,
        updatedByUserId: req.user!.id,
      });
      res.json(GetProjectGitConfigResponse.parse(cfg));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.post(
  "/projects/:projectName/git-config/pull",
  requireProjectOrgAccess((req) => paramString(req.params.projectName)),
  requireAdmin,
  async (req, res): Promise<void> => {
    const projectName = paramString(req.params.projectName);
    if (!(await enforceProjectOrgAccess(req, res, projectName))) return;
    const cfg = await getGitConfig(projectName);
    try {
      const result = await getContainer().useCases.gitConfig.pullProject(projectName, req.user!.id);
      if (!result.ok) {
        await recordAudit({
          user: req.user!,
          project: projectName,
          action: "project_git_pull",
          details: {
            repoUrl: cfg.repoUrl,
            branch: cfg.branch,
            error: result.code,
          },
        });
        res.status(400).json(
          PullProjectGitConfigResponse.parse({
            ok: false,
            errorCode: result.code,
            message: result.message,
          }),
        );
        return;
      }
      await recordAudit({
        user: req.user!,
        project: projectName,
        action: "project_git_pull",
        details: {
          repoUrl: cfg.repoUrl,
          branch: cfg.branch,
          commitSha: result.commitSha,
          commitMessage: result.commitMessage,
        },
      });
      res.json(
        PullProjectGitConfigResponse.parse({
          ok: true,
          commitSha: result.commitSha,
          commitMessage: result.commitMessage,
        }),
      );
    } catch (e) {
      req.log.error({ err: e }, "Pull failed");
      res.status(500).json({ error: (e as Error).message });
    }
  },
);

router.post(
  "/projects/:projectName/git-config/push",
  requireProjectOrgAccess((req) => paramString(req.params.projectName)),
  requireAdmin,
  async (req, res): Promise<void> => {
    const projectName = paramString(req.params.projectName);
    if (!(await enforceProjectOrgAccess(req, res, projectName))) return;
    const parsed = PushProjectGitConfigBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const cfg = await getGitConfig(projectName);
    try {
      const result = await getContainer().useCases.gitConfig.pushProject(
        projectName,
        parsed.data.commitMessage,
        req.user!.id,
      );
      if (!result.ok) {
        await recordAudit({
          user: req.user!,
          project: projectName,
          action: "project_git_push",
          details: {
            repoUrl: cfg.repoUrl,
            branch: cfg.branch,
            error: result.code,
          },
        });
        res.status(400).json(
          PushProjectGitConfigResponse.parse({
            ok: false,
            errorCode: result.code,
            message: result.message,
          }),
        );
        return;
      }
      await recordAudit({
        user: req.user!,
        project: projectName,
        action: "project_git_push",
        details: {
          repoUrl: cfg.repoUrl,
          branch: cfg.branch,
          commitSha: result.commitSha,
          nothingToCommit: result.nothingToCommit,
          commitMessage: parsed.data.commitMessage,
        },
      });
      res.json(
        PushProjectGitConfigResponse.parse({
          ok: true,
          commitSha: result.commitSha,
          nothingToCommit: result.nothingToCommit,
        }),
      );
    } catch (e) {
      req.log.error({ err: e }, "Push failed");
      res.status(500).json({ error: (e as Error).message });
    }
  },
);

router.get(
  "/projects/:projectName/branches",
  requireAdmin,
  async (req, res): Promise<void> => {
    const projectName = paramString(req.params.projectName);
    if (!(await enforceProjectOrgAccess(req, res, projectName))) return;
    const result = await getContainer().useCases.gitConfig.listBranches(projectName);
    res.json(ListProjectBranchesResponse.parse(result));
  },
);

router.post(
  "/projects/:projectName/branches",
  requireAdmin,
  async (req, res): Promise<void> => {
    const projectName = paramString(req.params.projectName);
    if (!(await enforceProjectOrgAccess(req, res, projectName))) return;
    const parsed = CreateProjectBranchBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    try {
      const result = await getContainer().useCases.gitConfig.createBranch(projectName, parsed.data.name, {
        checkout: parsed.data.checkout !== false,
      });
      await recordAudit({
        user: req.user!,
        project: projectName,
        action: "project_git_branch_create",
        details: {
          name: parsed.data.name,
          checkout: parsed.data.checkout !== false,
          ok: result.ok,
          errorCode: result.ok ? null : result.code,
        },
      });
      const body = CreateProjectBranchResponse.parse(
        result.ok
          ? {
              ok: true,
              current: result.current,
              errorCode: null,
              message: null,
            }
          : {
              ok: false,
              current: result.current,
              errorCode: result.code,
              message: result.message,
            },
      );
      // Domain failures (dirty_working_copy, invalid_name, etc.) are
      // returned as HTTP 200 with `{ok:false, errorCode, message}` so
      // the React client gets the structured payload through
      // `mutateAsync` instead of having `customFetch` throw on a 4xx.
      // The UI relies on `result.errorCode === "dirty_working_copy"`
      // to trigger the confirmation dialog.
      res.status(200).json(body);
    } catch (e) {
      req.log.error({ err: e }, "Create branch failed");
      res.status(500).json({ error: (e as Error).message });
    }
  },
);

router.post(
  "/projects/:projectName/branches/checkout",
  requireAdmin,
  async (req, res): Promise<void> => {
    const projectName = paramString(req.params.projectName);
    if (!(await enforceProjectOrgAccess(req, res, projectName))) return;
    const parsed = CheckoutProjectBranchBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    try {
      const result = await getContainer().useCases.gitConfig.checkoutBranch(projectName, parsed.data.name, {
        force: parsed.data.force === true,
      });
      await recordAudit({
        user: req.user!,
        project: projectName,
        action: "project_git_branch_checkout",
        details: {
          name: parsed.data.name,
          force: parsed.data.force === true,
          ok: result.ok,
          errorCode: result.ok ? null : result.code,
        },
      });
      const body = CheckoutProjectBranchResponse.parse(
        result.ok
          ? {
              ok: true,
              current: result.current,
              errorCode: null,
              message: null,
            }
          : {
              ok: false,
              current: result.current,
              errorCode: result.code,
              message: result.message,
            },
      );
      // Domain failures returned as HTTP 200 + structured payload —
      // see create-branch route comment.
      res.status(200).json(body);
    } catch (e) {
      req.log.error({ err: e }, "Checkout branch failed");
      res.status(500).json({ error: (e as Error).message });
    }
  },
);

export default router;
