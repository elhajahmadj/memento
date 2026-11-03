import { Router, type IRouter } from "express";
import archiver from "archiver";
import {
  CreateProjectBody,
  GetCurrentProjectResponse,
  LoadProjectBody,
  LoadProjectResponse,
  ListAvailableProjectsResponse,
  GetProjectTreeResponse,
  ListApiBaseUrlsResponse,
  ListTestClassesResponse,
  SetProjectDisabledBody,
  SetProjectDisabledResponse,
  DeleteProjectBody,
  ClearProjectFilesBody,
  DownloadProjectZipQueryParams,
  BuildApiTestBody,
} from "@workspace/api-zod";
import {
  getApiTestCodegen,
  ApiTestNotImplementedError,
} from "@/features/codegen/infrastructure/apiTestCodegenRegistry";
import fs from "node:fs/promises";
import {
  createProject,
  getCurrentProject,
  setCurrentProject,
  getProjectTree,
  listAvailableProjects,
  listApiBaseUrls,
  listTestClasses,
  loadProject,
  setProjectDisabled,
  deleteProject,
  clearProjectFiles,
  detectProjectInfo,
  solutionNameFromMainProjectPath,
  type Project,
} from "@/features/projects/infrastructure/projectService";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  requireAdmin,
  requireAdminOrAssignedToCurrentProjectOrOwner,
  requireRole,
} from "@/shared/middlewares/requireRole";
import { listForksForUser } from "@/features/forks/infrastructure/forkService";
import {
  getAssignedProjectNames,
  isAdminOrAssigned,
  isAssigned,
} from "@/features/assignments/infrastructure/assignmentService";
import { listAccessRequestsForUser } from "@/features/access-requests/infrastructure/accessRequestService";
import path from "node:path";
import pipelineFileRouter from "./pipelineFile";
import gitConfigRouter from "./gitConfig";
import myForkRouter from "./myFork";
import lifecycleRouter from "./lifecycle";
import {
  createDeleteRequest,
  createClearFilesRequest,
  getPendingDeleteRequestForProject,
  getPendingDeleteRequestsForProjects,
  getPendingClearFilesRequestForProject,
  getPendingClearFilesRequestsForProjects,
} from "@/features/projects/infrastructure/lifecycleRequestService";
import { getApprovalContext } from "@/features/projects/infrastructure/approvalBypass";
import { db, projectOrganizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  enforceProjectOrgAccess,
  filterVisibleProjectNames,
  resolveScopePolicy,
} from "@/features/auth/infrastructure/orgScope";
import { getEffectiveRole } from "@/shared/middlewares/effectiveRole";
import {
  createPendingCreateRequest,
  listPendingCreateProjectNames,
  listLifecycleRequestsForUser,
} from "@/features/projects/infrastructure/projectLifecycleRequestService";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import {
  attachProjectToGuest,
  detachProjectFromGuest,
} from "@/features/guest/infrastructure/guestSessionService";
import { suggestFreeSolutionName } from "@/features/projects/domain/naming";
import { serializeLifecycleRequest } from "./_serializer";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();
router.use(pipelineFileRouter);
router.use(gitConfigRouter);
router.use(myForkRouter);
router.use(lifecycleRouter);

router.get("/projects/current", async (req, res) => {
  const project = getCurrentProject(req.user?.id);
  // If the user switched org since loading the project, the cached
  // current-project may now belong to a different org. Hide it (return
  // null) instead of leaking the cross-org name. Local users (policy
  // "all") are unaffected.
  if (project && req.user) {
    const policy = await resolveScopePolicy(req);
    if (policy.kind !== "all") {
      // Route every bounded policy through `filterVisibleProjectNames`.
      // This used to read `policy.kind === "org" ? … : false`, which
      // meant a guest's own loaded project was always treated as
      // invisible — the workstation came up empty right after they
      // created it.
      const visible = (
        await filterVisibleProjectNames(policy, [project.solutionName])
      ).has(project.solutionName);
      if (!visible) {
        res.json(GetCurrentProjectResponse.parse({ project: null }));
        return;
      }
    }
  }
  res.json(GetCurrentProjectResponse.parse({ project }));
});

router.post("/projects", async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  const policy = await resolveScopePolicy(req);
  const activeOrgId = req.session.activeOrgId ?? null;
  if (policy.kind === "none") {
    res.status(400).json({
      error:
        "Select an active organization before creating a project. SSO users must have an active org for new projects to be tenant-scoped.",
    });
    return;
  }
  if (policy.kind === "org" && !activeOrgId) {
    res.status(400).json({ error: "No active organization on session" });
    return;
  }
  // Guests get exactly one project and are never org-stamped or routed
  // through the approval flow — there is no admin who could approve
  // them. Handled as a self-contained branch rather than threaded
  // through the org logic below, which assumes a tenant.
  if (policy.kind === "guest") {
    if (policy.projectName !== null) {
      res.status(409).json({
        error:
          "Guest sessions are limited to one project. Sign in with an " +
          "account to create more.",
        code: "GUEST_PROJECT_LIMIT",
      });
      return;
    }
    // Guests share the flat `workspace/<SolutionName>/` namespace with
    // real projects, so a name collision would let a guest overwrite
    // (or silently adopt) someone else's work. Refuse rather than
    // scaffold over it.
    //
    // The awkward part: a guest cannot SEE the colliding project, so a
    // bare "already exists" reads as a bug. Suggest a free name instead
    // of making them guess — without disclosing what else is on disk.
    const existingNames = new Set(
      (await listAvailableProjects()).map((p) => p.solutionName),
    );
    if (existingNames.has(parsed.data.solutionName)) {
      const suggestion = suggestFreeSolutionName(
        parsed.data.solutionName,
        existingNames,
      );
      res.status(409).json({
        error:
          `The name "${parsed.data.solutionName}" is already taken on this ` +
          `server. Try "${suggestion}" instead, or pick another name.`,
        code: "PROJECT_NAME_TAKEN",
        suggestion,
      });
      return;
    }
    // Claim the name BEFORE scaffolding so two concurrent requests from
    // the same guest can't both pass the limit check. `attachProject`
    // is a conditional update on `project_name IS NULL`, so the loser
    // gets `false`.
    const claimed = await attachProjectToGuest(
      user.id,
      parsed.data.solutionName,
    );
    if (!claimed) {
      res.status(409).json({
        error:
          "Guest sessions are limited to one project. Sign in with an " +
          "account to create more.",
        code: "GUEST_PROJECT_LIMIT",
      });
      return;
    }
    try {
      const project = await createProject({
        ...parsed.data,
        architectureId:
          (parsed.data.architectureId ?? undefined) || undefined,
        targetUrl: parsed.data.targetUrl ?? undefined,
        jwtAuth: parsed.data.jwtAuth ?? undefined,
        bff: parsed.data.bff ?? undefined,
        // M-4: cache the new project as *this* user's active project.
        // Previously the use case wrote it to a process-wide shared slot.
        ownerUserId: user.id,
      });
      setCurrentProject(project, user.id);
      res.status(201).json(project);
    } catch (e) {
      // Scaffolding failed — release the reservation so the guest isn't
      // stranded holding a slot that points at nothing.
      await detachProjectFromGuest(user.id);
      req.log.error({ err: e }, "Failed to create guest project");
      res.status(400).json({ error: (e as Error).message });
    }
    return;
  }
  // Authorize on the *effective* (per-org) role — task #36. Pre-task
  // this read `users.role` globally; SSO admins now carry that column
  // as `limited`, so we must consult the resolver to see their true
  // authority in the current active org. `policy.kind === "none"` above
  // already short-circuits SSO callers with no resolvable org.
  const effective = (await getEffectiveRole(req)) ?? user.role;
  const isElevated =
    effective === "admin" || effective === "memento_admin";
  // Local users (policy "all"): only admins/memento-admins may create
  // projects — pre-existing behavior is preserved. The new
  // pending-approval flow is org-scoped only.
  if (!isElevated && policy.kind === "all") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const requiresApproval = !isElevated && policy.kind === "org";
  try {
    const project = await createProject({
      ...parsed.data,
      architectureId:
        (parsed.data.architectureId ?? undefined) || undefined,
      targetUrl: parsed.data.targetUrl ?? undefined,
      jwtAuth: parsed.data.jwtAuth ?? undefined,
      bff: parsed.data.bff ?? undefined,
      // M-4: cache the new project as *this* user's active project.
      // Previously the use case wrote it to a process-wide shared slot.
      ownerUserId: user.id,
    });
    if (policy.kind === "org") {
      try {
        await db
          .insert(projectOrganizationsTable)
          .values({
            projectName: project.solutionName,
            organizationId: policy.orgId,
          })
          .onConflictDoNothing();
      } catch (stampErr) {
        req.log.warn(
          { err: stampErr, project: project.solutionName },
          "Failed to stamp new project with org",
        );
      }
    }
    if (requiresApproval) {
      // Reserve the project on disk + org stamp, then record a pending
      // lifecycle request. Don't set as current — the requester won't
      // be able to load it until an admin approves. Limited admins
      // also get an assignment row so once approved they can open it
      // without an extra access request.
      const request = await createPendingCreateRequest({
        projectName: project.solutionName,
        requestedByUserId: user.id,
        // Persist the *effective* role for the active org (task #36)
        // so approval-time logic (which materializes an assignment
        // for limited_admin/limited requesters) reflects what the
        // caller could actually do in this org, not their global
        // `users.role` column (which is `limited` for SSO users).
        requestedByRole: effective,
        organizationId: activeOrgId,
        language: parsed.data.language ?? null,
        solutionType: parsed.data.solutionType ?? null,
      });
      // Don't create an assignment yet — requester must not be able
      // to load/edit the project until an admin approves it. The
      // assignment is materialized on approval (see lifecycle.ts).
      await recordAudit({
        user: { id: user.id },
        project: project.solutionName,
        action: "project_create_requested",
        details: { requestId: request.id, requestedByRole: effective },
      });
      res.status(202).json({
        pending: true,
        request: serializeLifecycleRequest(request),
      });
      return;
    }
    setCurrentProject(project, req.user?.id);
    res.status(201).json(project);
  } catch (e) {
    req.log.error({ err: e }, "Failed to create project");
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/projects/load", async (req, res): Promise<void> => {
  const parsed = LoadProjectBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    const user = req.user!;
    let slnPath = parsed.data.slnPath;
    // Guests load their own single project directly from the main tree.
    // Handled up front because the non-admin path below resolves the
    // caller's *fork*, and a guest has none — "Open" would 404 for them.
    {
      const guestPolicy = await resolveScopePolicy(req);
      if (guestPolicy.kind === "guest") {
        const baseName = solutionNameFromMainProjectPath(slnPath);
        if (!baseName || baseName !== guestPolicy.projectName) {
          // 404 (not 403) so a guest cannot probe which project names
          // exist in the shared workspace.
          res.status(404).json({ error: "Project not found" });
          return;
        }
        const project = await loadProject(slnPath, user.id);
        res.json(LoadProjectResponse.parse(project));
        return;
      }
    }
    // Authorize on the *effective* (per-org) role — task #36. SSO
    // users post-foundation carry `users.role = 'limited'` globally,
    // so the previous reads of `user.role` here routed SSO admins
    // down the fork-only branch and broke main-project load.
    const effective = (await getEffectiveRole(req)) ?? user.role;
    // Org scoping (admin / limited_admin): an IDP user must not be
    // able to load a project belonging to another org. We respond
    // 404 — not 403 — so cross-org existence isn't observable.
    if (
      effective === "admin" ||
      effective === "limited_admin" ||
      effective === "memento_admin"
    ) {
      const policy = await resolveScopePolicy(req);
      if (policy.kind !== "all") {
        // Use the canonical (language-agnostic) solution name —
        // `path.basename(p, ".sln")` would return "pyproject.toml" /
        // "package.json" / "pom.xml" for non-C# projects and silently
        // deny org users access to their own projects.
        const baseName = solutionNameFromMainProjectPath(slnPath);
        if (!baseName) {
          res.status(404).json({ error: "Project not found" });
          return;
        }
        const visible = await filterVisibleProjectNames(policy, [baseName]);
        if (!visible.has(baseName)) {
          res.status(404).json({ error: "Project not found" });
          return;
        }
      }
    }
    // Pending-approval guard: even the requester (and full admins)
    // cannot load a project that is still awaiting an admin's
    // decision. The project tree may have been scaffolded but it is
    // not yet considered part of the workspace. This runs AFTER the
    // org-scope check above so cross-org callers still get 404 (not
    // a 403 oracle leaking pending-project existence to other orgs).
    {
      const baseName = solutionNameFromMainProjectPath(slnPath);
      if (baseName) {
        const policy = await resolveScopePolicy(req);
        const pending = await listPendingCreateProjectNames(
          policy.kind === "org"
            ? { orgScope: { orgId: policy.orgId } }
            : undefined,
        );
        if (pending.has(baseName)) {
          res.status(403).json({
            error:
              "This project is awaiting admin approval and cannot be loaded yet.",
          });
          return;
        }
      }
    }
    // For limited (User) callers, honor an explicit project_assignments
    // row (granted on approved create requests) before falling through
    // to the fork-only path below.
    let limitedAssignedToMain = false;
    if (effective === "limited") {
      const resolved = path.resolve(slnPath);
      const baseName = solutionNameFromMainProjectPath(resolved);
      if (baseName && (await isAssigned(user.id, baseName))) {
        slnPath = resolved;
        limitedAssignedToMain = true;
      }
    }
    if (effective === "limited_admin") {
      // Limited admins load the main project tree (like full admins) but
      // only for projects they have an explicit assignment to.
      const resolved = path.resolve(slnPath);
      // Derive project name from the canonical directory layout (works
      // for all languages, not just C#).
      const baseName = solutionNameFromMainProjectPath(resolved);
      if (!baseName) {
        res.status(403).json({
          error:
            "You are not assigned to this project. Request access from the home page.",
        });
        return;
      }
      const assigned = await isAdminOrAssigned(
        { id: user.id, role: effective },
        baseName,
      );
      if (!assigned) {
        res.status(403).json({
          error:
            "You are not assigned to this project. Request access from the home page.",
        });
        return;
      }
      slnPath = resolved;
    } else if (
      effective !== "admin" &&
      effective !== "memento_admin" &&
      !limitedAssignedToMain
    ) {
      // Limited users may only load .sln files that match an active fork
      // they own. We resolve the requested path against their fork list to
      // prevent loading the main project (or another user's fork).
      const forks = await listForksForUser(user.id);
      const resolved = path.resolve(slnPath);
      const owned = forks.find(
        (f) =>
          f.status === "active" &&
          path.resolve(f.forkPath, `${f.projectName}.sln`) === resolved,
      );
      if (!owned) {
        res.status(403).json({
          error:
            "You do not have an active fork for this project. Request a fork from the home page.",
        });
        return;
      }
      // Org scope: if the limited user switched active orgs since the
      // fork was created, the fork's underlying project may no longer
      // be visible to them. 404 hides existence so a stale fork from a
      // different org cannot be loaded post-switch.
      const policy = await resolveScopePolicy(req);
      if (policy.kind === "none") {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (policy.kind === "org") {
        const visible = await filterVisibleProjectNames(policy, [
          owned.projectName,
        ]);
        if (!visible.has(owned.projectName)) {
          res.status(404).json({ error: "Project not found" });
          return;
        }
      }
      slnPath = path.resolve(owned.forkPath, `${owned.projectName}.sln`);
    }
    const project = await loadProject(slnPath, user.id);
    res.json(LoadProjectResponse.parse(project));
  } catch (e) {
    req.log.error({ err: e }, "Failed to load project");
    res.status(400).json({ error: (e as Error).message });
  }
});

router.get("/projects/available", async (req, res) => {
  // Admins see all main solutions in workspace. Limited admins see all
  // main solutions but only the assigned ones are loadable; the rest are
  // shown so they can request access from the home page. Limited users
  // see nothing here — they use /forks/available-projects.
  const user = req.user;
  if (!user) {
    res.json(ListAvailableProjectsResponse.parse([]));
    return;
  }
  // Org scoping: local users (no IDP membership) keep the pre-org
  // global view; IDP users only see projects stamped with their
  // active org. IDP users without an active org see nothing.
  const policy = await resolveScopePolicy(req);
  // Pending-approval gate: projects awaiting an admin's decision are
  // hidden from everyone except (a) admins (who manage the queue) and
  // (b) the user who filed the request (so they can see their own
  // pending tile with a badge).
  const pendingNames = await listPendingCreateProjectNames(
    policy.kind === "org" ? { orgScope: { orgId: policy.orgId } } : undefined,
  );
  const myPending = new Set(
    (await listLifecycleRequestsForUser(user.id))
      .filter((r) => r.status === "pending" && r.kind === "create")
      .map((r) => r.projectName),
  );
  // Guests own exactly one project and have no assignments, forks, or
  // access requests. Handled before the role branches below: without
  // this they fall through to the limited-user tail, which returns []
  // whenever the caller has no assignment rows — so a guest could never
  // see the project they had just created.
  if (policy.kind === "guest") {
    if (policy.projectName === null) {
      res.json(ListAvailableProjectsResponse.parse([]));
      return;
    }
    const items = await listAvailableProjects();
    const mine = items
      .filter((p) => p.solutionName === policy.projectName)
      .map((p) => ({ ...p, hasAccess: true }));
    res.json(ListAvailableProjectsResponse.parse(mine));
    return;
  }
  // Authorize on the *effective* (per-org) role — task #36.
  const effective = (await getEffectiveRole(req)) ?? user.role;
  const isElevated =
    effective === "admin" || effective === "memento_admin";
  if (isElevated) {
    const items = await listAvailableProjects();
    const visible = await filterVisibleProjectNames(
      policy,
      items.map((p) => p.solutionName),
    );
    // Pending-create projects don't belong in the regular project list —
    // admins manage them via the lifecycle-requests queue endpoint.
    // Pending-delete projects DO remain (loadable until the approver
    // decides) and are enriched with `pendingDeletion` so the UI can
    // render a badge.
    const filtered = items
      .filter((p) => visible.has(p.solutionName))
      .filter((p) => !pendingNames.has(p.solutionName));
    const names = filtered.map((p) => p.solutionName);
    const pendingByName = await getPendingDeleteRequestsForProjects(names);
    const pendingClearByName =
      await getPendingClearFilesRequestsForProjects(names);
    const enriched = filtered.map((p) => {
      const pd = pendingByName.get(p.solutionName);
      const pc = pendingClearByName.get(p.solutionName);
      const out: typeof p = { ...p };
      if (pd) {
        (out as Record<string, unknown>).pendingDeletion = {
          requestId: pd.id,
          requestedByUserId: pd.requestedByUserId,
          requestedByUsername: pd.requestedByUsername,
          requestedAt: pd.requestedAt,
          isOwnRequest: pd.requestedByUserId === user.id,
        };
      }
      if (pc) {
        (out as Record<string, unknown>).pendingClearFiles = {
          requestId: pc.id,
          requestedByUserId: pc.requestedByUserId,
          requestedByUsername: pc.requestedByUsername,
          requestedAt: pc.requestedAt,
          isOwnRequest: pc.requestedByUserId === user.id,
        };
      }
      return out;
    });
    res.json(ListAvailableProjectsResponse.parse(enriched));
    return;
  }
  if (effective === "limited_admin") {
    const items = await listAvailableProjects();
    const visible = await filterVisibleProjectNames(
      policy,
      items.map((p) => p.solutionName),
    );
    const filtered = items
      .filter((p) => visible.has(p.solutionName))
      .filter((p) => !pendingNames.has(p.solutionName) || myPending.has(p.solutionName));
    const assigned = new Set(await getAssignedProjectNames(user.id));
    const pendingRequests = (
      await listAccessRequestsForUser(user.id)
    ).filter((r) => r.status === "pending");
    const pending = new Set(pendingRequests.map((r) => r.projectName));
    const names = filtered.map((p) => p.solutionName);
    const pendingByName = await getPendingDeleteRequestsForProjects(names);
    const pendingClearByName =
      await getPendingClearFilesRequestsForProjects(names);
    res.json(
      filtered.map((p) => {
        const pd = pendingByName.get(p.solutionName);
        const pc = pendingClearByName.get(p.solutionName);
        return {
          ...p,
          hasAccess: assigned.has(p.solutionName),
          hasPendingRequest: pending.has(p.solutionName),
          pendingApproval: myPending.has(p.solutionName),
          ...(pd
            ? {
                pendingDeletion: {
                  requestId: pd.id,
                  requestedByUserId: pd.requestedByUserId,
                  requestedByUsername: pd.requestedByUsername,
                  requestedAt: pd.requestedAt,
                  isOwnRequest: pd.requestedByUserId === user.id,
                },
              }
            : {}),
          ...(pc
            ? {
                pendingClearFiles: {
                  requestId: pc.id,
                  requestedByUserId: pc.requestedByUserId,
                  requestedByUsername: pc.requestedByUsername,
                  requestedAt: pc.requestedAt,
                  isOwnRequest: pc.requestedByUserId === user.id,
                },
              }
            : {}),
        };
      }),
    );
    return;
  }
  // Limited users: see (a) their own pending create requests (so
  // they can cancel) and (b) any projects they have been granted
  // direct access to via an approved create request (assignment row).
  const assigned = new Set(await getAssignedProjectNames(user.id));
  if (myPending.size === 0 && assigned.size === 0) {
    res.json(ListAvailableProjectsResponse.parse([]));
    return;
  }
  const items = await listAvailableProjects();
  const visible = await filterVisibleProjectNames(
    policy,
    items.map((p) => p.solutionName),
  );
  const mine = items
    .filter(
      (p) =>
        visible.has(p.solutionName) &&
        (myPending.has(p.solutionName) || assigned.has(p.solutionName)),
    )
    .map((p) => ({
      ...p,
      hasAccess: assigned.has(p.solutionName),
      pendingApproval: myPending.has(p.solutionName),
    }));
  res.json(mine);
});

router.post("/projects/disable", async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = SetProjectDisabledBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  // Project-scoped: limited admins may toggle disabled state on assigned
  // projects only. Full admins are unrestricted within their org scope.
  // Use the canonical solution name so non-C# projects (Python/Node/Java)
  // are authorized correctly.
  const baseName = solutionNameFromMainProjectPath(parsed.data.slnPath);
  if (!baseName) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  // Org scope: cross-org IDP callers see 404 (existence not observable).
  if (!(await enforceProjectOrgAccess(req, res, baseName))) return;
  // Authorize on the *effective* (per-org) role — task #36.
  const effective = (await getEffectiveRole(req)) ?? user.role;
  if (
    effective !== "admin" &&
    effective !== "memento_admin" &&
    !(await isAdminOrAssigned({ id: user.id, role: effective }, baseName))
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const updated = await setProjectDisabled(
      parsed.data.slnPath,
      parsed.data.disabled,
    );
    res.json(SetProjectDisabledResponse.parse(updated));
  } catch (e) {
    req.log.error({ err: e }, "Failed to update disabled state");
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post(
  "/projects/delete",
  requireRole("admin", "limited_admin"),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const parsed = DeleteProjectBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    // Org scope: an IDP admin can only delete projects within their org.
    // Cross-org → 404 (matches read-side existence semantics). Use the
    // canonical solution name (works for all languages, not just C#).
    const baseName = solutionNameFromMainProjectPath(parsed.data.slnPath);
    if (!baseName) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!(await enforceProjectOrgAccess(req, res, baseName))) return;

    // Block duplicate concurrent delete requests against the same project.
    const existing = await getPendingDeleteRequestForProject(baseName);
    if (existing) {
      res.status(409).json({
        error: "A pending delete request already exists for this project",
        requestId: existing.id,
      });
      return;
    }

    const { bypass, orgId } = await getApprovalContext(req, user, baseName);
    if (bypass) {
      if (!parsed.data.acknowledgeIrreversible) {
        res.status(400).json({
          error:
            "acknowledgeIrreversible must be true when deleting as the sole admin",
        });
        return;
      }
      try {
        await deleteProject(parsed.data.slnPath);
        await db
          .delete(projectOrganizationsTable)
          .where(eq(projectOrganizationsTable.projectName, baseName));
        await recordAudit({
          user,
          project: baseName,
          action: "project_delete_executed",
          details: { via: "sole_admin_bypass" },
        });
        res.status(200).json({ status: "deleted", requestId: null });
      } catch (e) {
        req.log.error({ err: e }, "Failed to delete project");
        res.status(400).json({ error: (e as Error).message });
      }
      return;
    }

    // Otherwise file a pending request — leave files and DB rows alone.
    // Persist the *effective* (per-org) role — task #36.
    const effective = (await getEffectiveRole(req)) ?? user.role;
    const created = await createDeleteRequest({
      projectName: baseName,
      organizationId: orgId,
      requestedByUserId: user.id,
      requestedByRole: effective,
    });
    await recordAudit({
      user,
      project: baseName,
      action: "project_delete_requested",
      details: { requestId: created.id },
    });
    res.status(200).json({ status: "pending", requestId: created.id });
  },
);

router.post(
  "/projects/clear-files",
  requireRole("admin", "limited_admin"),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const parsed = ClearProjectFilesBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const baseName = solutionNameFromMainProjectPath(parsed.data.slnPath);
    if (!baseName) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!(await enforceProjectOrgAccess(req, res, baseName))) return;

    // Block duplicate concurrent clear-files requests on the same project.
    const existing = await getPendingClearFilesRequestForProject(baseName);
    if (existing) {
      res.status(409).json({
        error:
          "A pending clear-files request already exists for this project",
        requestId: existing.id,
      });
      return;
    }

    const { bypass, orgId } = await getApprovalContext(req, user, baseName);
    if (bypass) {
      if (!parsed.data.acknowledgeIrreversible) {
        res.status(400).json({
          error:
            "acknowledgeIrreversible must be true when clearing as the sole admin",
        });
        return;
      }
      try {
        await clearProjectFiles(parsed.data.slnPath);
        await recordAudit({
          user,
          project: baseName,
          action: "project_clear_files_executed",
          details: { via: "sole_admin_bypass" },
        });
        res.status(200).json({ status: "cleared", requestId: null });
      } catch (e) {
        req.log.error({ err: e }, "Failed to clear project files");
        res.status(400).json({ error: (e as Error).message });
      }
      return;
    }

    // Persist the *effective* (per-org) role — task #36.
    const effective = (await getEffectiveRole(req)) ?? user.role;
    const created = await createClearFilesRequest({
      projectName: baseName,
      organizationId: orgId,
      requestedByUserId: user.id,
      requestedByRole: effective,
    });
    await recordAudit({
      user,
      project: baseName,
      action: "project_clear_files_requested",
      details: { requestId: created.id },
    });
    res.status(200).json({ status: "pending", requestId: created.id });
  },
);

router.get("/projects/tree", requireAdminOrAssignedToCurrentProjectOrOwner, async (req, res): Promise<void> => {
  const project = getCurrentProject(req.user?.id);
  if (!project) {
    res.status(404).json({ error: "No project loaded" });
    return;
  }
  try {
    const tree = await getProjectTree(project);
    res.json(GetProjectTreeResponse.parse(tree));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      setCurrentProject(null, req.user?.id);
      res.status(404).json({
        error: "Project directory no longer exists; cleared current project",
      });
      return;
    }
    throw e;
  }
});

router.get("/tests", requireAdminOrAssignedToCurrentProjectOrOwner, async (req, res): Promise<void> => {
  const project = getCurrentProject(req.user?.id);
  if (!project) {
    res.status(404).json({ error: "No project loaded" });
    return;
  }
  const items = await listTestClasses(project);
  res.json(ListTestClassesResponse.parse(items));
});

router.get(
  "/projects/api-base-urls",
  requireAdminOrAssignedToCurrentProjectOrOwner,
  async (req, res): Promise<void> => {
    const project = getCurrentProject(req.user?.id);
    if (!project) {
      res.status(404).json({ error: "No project loaded" });
      return;
    }
    const items = await listApiBaseUrls(project);
    res.json(ListApiBaseUrlsResponse.parse(items));
  },
);

router.get("/projects/zip", async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = DownloadProjectZipQueryParams.safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  const requestedSlnPath = parsed.data.slnPath;

  // Resolve the target project. When slnPath is provided we authorize
  // by matching the requested path against a *canonical* project record
  // (admins/limited_admins → main projects from `listAvailableProjects`;
  // limited users → active forks they own) so authorization can never
  // be tricked by a path/name spoof. We never trust a name derived from
  // an attacker-controlled `slnPath` for permission checks. Falling back
  // to the currently-loaded project preserves the original behavior.
  let project: Project | null = null;
  if (requestedSlnPath) {
    const abs = path.resolve(requestedSlnPath);
    const wsRoot = path.resolve(recorderConfig.workspaceDir);
    if (!abs.startsWith(wsRoot + path.sep)) {
      res.status(400).json({
        error: "Project must live inside the workspace folder",
      });
      return;
    }
    // Defense in depth: confirm the marker file actually exists before
    // touching anything else. Combined with the canonical-record match
    // below, this prevents zipping arbitrary directories by passing a
    // path whose dirname holds unrelated files.
    try {
      await fs.access(abs);
    } catch {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Authorize on the *effective* (per-org) role — task #36.
    const effective = (await getEffectiveRole(req)) ?? user.role;
    if (
      effective === "admin" ||
      effective === "limited_admin" ||
      effective === "memento_admin"
    ) {
      // Authorization for main workspace projects must use the
      // *directory name* — that's the canonical project identity that
      // `createProject` writes (`<workspaceDir>/<solutionName>/`) and
      // the same key that `createAssignment` stores. Trusting the .sln
      // basename instead would let an attacker drop a crafted
      // `<workspaceDir>/secret-other-project/AssignedName.sln` and
      // exfiltrate the unrelated `secret-other-project/` directory by
      // passing the limited admin's assignment check.
      const projectDir = path.dirname(abs);
      // Enforce the one-level-deep convention: the project marker must
      // live at `<wsRoot>/<solutionDirName>/<marker>` exactly. Reject
      // anything nested deeper (e.g. inside `forks/<user>/<proj>/`)
      // before doing anything else.
      if (path.resolve(path.dirname(projectDir)) !== wsRoot) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const dirName = path.basename(projectDir);
      // Defense in depth: also confirm the project is one we discover
      // via `listAvailableProjects` so we never zip dotfiles, the
      // reserved `forks/` subdir, or a directory whose marker file
      // can't actually be detected.
      const available = await listAvailableProjects();
      const canonical = available.find(
        (p) => path.resolve(p.slnPath) === abs,
      );
      if (!canonical) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      // Org scope: cross-org IDP admin/limited_admin → 404.
      if (!(await enforceProjectOrgAccess(req, res, dirName))) return;
      if (
        effective === "limited_admin" &&
        !(await isAdminOrAssigned(
          { id: user.id, role: effective },
          dirName,
        ))
      ) {
        res.status(403).json({
          error: "You are not assigned to this project.",
        });
        return;
      }
      try {
        project = await detectProjectInfo(abs);
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
        return;
      }
    } else {
      // Limited users may only export an active fork they own. We match
      // the requested sln path against the user's fork list (using the
      // same resolution loadProject uses) before authorizing.
      const forks = await listForksForUser(user.id);
      const owned = forks.find(
        (f) =>
          f.status === "active" &&
          path.resolve(f.forkPath, `${f.projectName}.sln`) === abs,
      );
      if (!owned) {
        res.status(403).json({
          error:
            "You do not have an active fork for this project.",
        });
        return;
      }
      try {
        project = await detectProjectInfo(abs);
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
        return;
      }
    }
  } else {
    project = getCurrentProject(user.id);
    if (!project) {
      res.status(404).json({ error: "No project loaded" });
      return;
    }
    // Authorize on the *effective* (per-org) role — task #36.
    const effective = (await getEffectiveRole(req)) ?? user.role;
    if (
      (effective === "admin" ||
        effective === "limited_admin" ||
        effective === "memento_admin") &&
      !(await enforceProjectOrgAccess(req, res, project.solutionName))
    ) {
      return;
    }
    if (effective === "limited_admin") {
      if (
        !(await isAdminOrAssigned(
          { id: user.id, role: effective },
          project.solutionName,
        ))
      ) {
        res.status(403).json({
          error: "You are not assigned to this project.",
        });
        return;
      }
    }
  }
  const filename = `${project.solutionName}.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    req.log.error({ err }, "Zip error");
    res.status(500).end();
  });
  archive.pipe(res);
  archive.glob("**/*", {
    cwd: project.rootPath,
    ignore: Array.from(recorderConfig.ignoreDirs).flatMap((d) => [
      `**/${d}/**`,
      `${d}/**`,
    ]),
    dot: true,
  });
  await archive.finalize();
});

router.post(
  "/api-tests/build",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = BuildApiTestBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    const { solutionName, ...spec } = parsed.data;
    const current = getCurrentProject(req.user?.id);
    if (!current || current.solutionName !== solutionName) {
      res.status(404).json({ error: "Project not loaded" });
      return;
    }
    const solutionType = current.solutionType ?? "playwright";
    if (solutionType !== "api") {
      res.status(400).json({
        error:
          "Build Test is only available for projects with solutionType=api",
      });
      return;
    }
    // Validate test class discriminator before reaching the planner.
    if (spec.testClass.mode === "new" && !spec.testClass.className) {
      res.status(400).json({ error: "testClass.className is required when mode=new" });
      return;
    }
    if (spec.testClass.mode === "existing" && !spec.testClass.path) {
      res.status(400).json({ error: "testClass.path is required when mode=existing" });
      return;
    }
    const normalizedSpec = {
      ...spec,
      endpointSection: spec.endpointSection ?? null,
      testClass:
        spec.testClass.mode === "new"
          ? { mode: "new" as const, className: spec.testClass.className! }
          : { mode: "existing" as const, path: spec.testClass.path! },
    };
    // Per-language registry: csharp runs the real planner, every other
    // language returns a typed `ApiTestNotImplementedError` translated
    // here into HTTP 501 so the Build Test dialog can surface a clear
    // "not implemented yet" message.
    const language = current.language ?? "csharp";
    const codegen = getApiTestCodegen(language);
    if (!codegen.isImplemented) {
      res.status(501).json({
        error: `API test build for ${language} is not implemented yet`,
      });
      return;
    }
    try {
      const result = await codegen.planAndCommit(
        {
          rootPath: current.rootPath,
          solutionName: current.solutionName,
          namespace: current.namespace,
        },
        normalizedSpec,
      );
      res.status(200).json({
        files: result.files.map((f) => ({
          path: f.relPath,
          created: f.created,
        })),
      });
    } catch (e) {
      if (e instanceof ApiTestNotImplementedError) {
        res.status(501).json({ error: e.message });
        return;
      }
      req.log.warn({ err: e }, "Build Test failed");
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

export default router;
