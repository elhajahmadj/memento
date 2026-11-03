import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  aiRunsTable,
  validationRunsTable,
  projectAssignmentsTable,
  projectOrganizationsTable,
  organizationsTable,
  usersTable,
  projectGitConfigsTable,
  auditEventsTable,
} from "@workspace/db";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { assertResponseShape } from "@/shared/assertResponseShape";
import {
  resolveScopePolicy,
  scopedProjectNames,
} from "@/features/auth/infrastructure/orgScope";

const router: IRouter = Router();

type WindowKey = "today" | "7d" | "30d";

function windowSince(window: WindowKey): Date {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (window === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (window === "30d") return new Date(now - 30 * day);
  return new Date(now - 7 * day);
}

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const windowParam =
    req.query.window === "today" || req.query.window === "30d"
      ? (req.query.window as WindowKey)
      : ("7d" as WindowKey);
  const since = windowSince(windowParam);

  const scope = await resolveScopePolicy(req);
  // Delegates to the shared resolver so a newly-added ScopePolicy
  // variant can't silently land in the `return null` ("see everything")
  // fall-through. That is exactly what happened with `guest`: the
  // dashboard is the page guests land on, and an unhandled kind meant
  // their widgets were computed across every project in the workspace.
  const orgScopedProjects = (): Promise<string[] | null> =>
    scopedProjectNames(scope);

  // --- Base user-level widgets ---------------------------------------
  const myRecentRunsRows = await db
    .select({
      id: validationRunsTable.id,
      projectName: validationRunsTable.projectName,
      status: validationRunsTable.status,
      queuedAt: validationRunsTable.queuedAt,
    })
    .from(validationRunsTable)
    .where(eq(validationRunsTable.triggeredByUserId, user.id))
    .orderBy(desc(validationRunsTable.queuedAt))
    .limit(5);

  const myRecentRuns = myRecentRunsRows.map((r) => ({
    id: r.id,
    projectName: r.projectName,
    status: r.status,
    queuedAt: r.queuedAt.toISOString(),
    href: `/tools/test-runs?project=${encodeURIComponent(r.projectName)}`,
  }));

  // "My projects" — recently touched projects the user can see
  const myProjectNamesRows = await db
    .select({
      projectName: validationRunsTable.projectName,
      lastActivityAt: sql<Date>`max(${validationRunsTable.queuedAt})`,
    })
    .from(validationRunsTable)
    .where(eq(validationRunsTable.triggeredByUserId, user.id))
    .groupBy(validationRunsTable.projectName)
    .orderBy(desc(sql`max(${validationRunsTable.queuedAt})`))
    .limit(6);

  const visibleProjects = await orgScopedProjects();
  const myProjects = myProjectNamesRows
    .filter(
      (r) => visibleProjects === null || visibleProjects.includes(r.projectName),
    )
    .map((r) => ({
      projectName: r.projectName,
      href: `/?project=${encodeURIComponent(r.projectName)}`,
      lastActivityAt: r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : null,
    }));

  // Drafts: AI runs the user owns still pending/running
  const draftRows = await db
    .select({
      id: aiRunsTable.id,
      projectName: aiRunsTable.projectName,
      suiteName: aiRunsTable.suiteName,
    })
    .from(aiRunsTable)
    .where(
      and(
        eq(aiRunsTable.triggeredByUserId, user.id),
        inArray(aiRunsTable.status, ["pending", "running"]),
      ),
    )
    .orderBy(desc(aiRunsTable.startedAt))
    .limit(5);

  const draftsInProgress = draftRows.map((r) => ({
    id: r.id,
    title: r.suiteName,
    projectName: r.projectName,
    href: `/workbench/ai-runs/${encodeURIComponent(r.projectName)}/${r.id}`,
    kind: "ai-run" as const,
  }));

  // Onboarding: incomplete profile or skipped tour
  const profileComplete = Boolean(
    user.firstName && user.lastName && user.title && user.email,
  );
  const onboarding = profileComplete
    ? null
    : { href: "/profile/complete", label: "Complete your profile" };

  // --- Limited Admin and above --------------------------------------
  const isAnyAdmin =
    user.role === "admin" ||
    user.role === "limited_admin" ||
    user.role === "memento_admin";

  let adminProjectsCount: number | null = null;
  let recentActivityInMyProjects: typeof myRecentRuns | null = null;
  if (isAnyAdmin) {
    if (user.role === "limited_admin") {
      const rows = await db
        .select({ p: projectAssignmentsTable.projectName })
        .from(projectAssignmentsTable)
        .where(eq(projectAssignmentsTable.userId, user.id));
      adminProjectsCount = rows.length;
      const projectNames = rows.map((r) => r.p);
      if (projectNames.length > 0) {
        const recent = await db
          .select({
            id: validationRunsTable.id,
            projectName: validationRunsTable.projectName,
            status: validationRunsTable.status,
            queuedAt: validationRunsTable.queuedAt,
          })
          .from(validationRunsTable)
          .where(inArray(validationRunsTable.projectName, projectNames))
          .orderBy(desc(validationRunsTable.queuedAt))
          .limit(5);
        recentActivityInMyProjects = recent.map((r) => ({
          id: r.id,
          projectName: r.projectName,
          status: r.status,
          queuedAt: r.queuedAt.toISOString(),
          href: `/tools/test-runs?project=${encodeURIComponent(r.projectName)}`,
        }));
      } else {
        recentActivityInMyProjects = [];
      }
    } else {
      // admin / memento_admin: all visible
      const names = visibleProjects;
      const recentQuery = db
        .select({
          id: validationRunsTable.id,
          projectName: validationRunsTable.projectName,
          status: validationRunsTable.status,
          queuedAt: validationRunsTable.queuedAt,
        })
        .from(validationRunsTable);
      const recent =
        names === null
          ? await recentQuery
              .orderBy(desc(validationRunsTable.queuedAt))
              .limit(5)
          : names.length === 0
            ? []
            : await recentQuery
                .where(inArray(validationRunsTable.projectName, names))
                .orderBy(desc(validationRunsTable.queuedAt))
                .limit(5);
      recentActivityInMyProjects = recent.map((r) => ({
        id: r.id,
        projectName: r.projectName,
        status: r.status,
        queuedAt: r.queuedAt.toISOString(),
        href: `/tools/test-runs?project=${encodeURIComponent(r.projectName)}`,
      }));
      if (names === null) {
        const [c] = await db
          .select({ n: sql<number>`count(*)` })
          .from(projectOrganizationsTable);
        adminProjectsCount = Number(c?.n ?? 0);
      } else {
        adminProjectsCount = names.length;
      }
    }
  }

  // --- Admin (org-scoped) and above ---------------------------------
  const isFullAdmin = user.role === "admin" || user.role === "memento_admin";
  let orgHealth: ReturnType<typeof toOrgHealth> | null = null;
  let failingTests: Array<{
    projectName: string;
    recordingFilePath: string | null;
    failures: number;
    href: string;
  }> | null = null;
  let usersStat: {
    activeThisWeek: number;
    newThisWindow: number;
    href: string;
  } | null = null;
  let projectsStat: {
    total: number;
    stale: number;
    href: string;
  } | null = null;
  let integrations: {
    ssoUsers: number;
    localUsers: number;
    gitReposWithPat: number;
    usersHref: string;
    gitReposHref: string;
  } | null = null;

  function toOrgHealth(totalRuns: number, passed: number) {
    return {
      totalRuns,
      passRate: totalRuns === 0 ? 0 : passed / totalRuns,
      href: "/tools/test-runs",
    };
  }

  if (isFullAdmin) {
    const names = visibleProjects;
    const baseFilter =
      names === null
        ? gte(validationRunsTable.queuedAt, since)
        : names.length === 0
          ? sql`false`
          : and(
              gte(validationRunsTable.queuedAt, since),
              inArray(validationRunsTable.projectName, names),
            );

    const [counts] = await db
      .select({
        total: sql<number>`count(*)`,
        passed: sql<number>`sum(case when ${validationRunsTable.status} = 'passed' then 1 else 0 end)`,
      })
      .from(validationRunsTable)
      .where(baseFilter);

    orgHealth = toOrgHealth(
      Number(counts?.total ?? 0),
      Number(counts?.passed ?? 0),
    );

    const failingRows = await db
      .select({
        projectName: validationRunsTable.projectName,
        recordingFilePath: validationRunsTable.recordingFilePath,
        failures: sql<number>`count(*)`,
      })
      .from(validationRunsTable)
      .where(
        and(
          baseFilter,
          inArray(validationRunsTable.status, ["failed", "error"]),
        ),
      )
      .groupBy(
        validationRunsTable.projectName,
        validationRunsTable.recordingFilePath,
      )
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    failingTests = failingRows.map((r) => ({
      projectName: r.projectName,
      recordingFilePath: r.recordingFilePath,
      failures: Number(r.failures),
      href: `/tools/test-runs?project=${encodeURIComponent(r.projectName)}`,
    }));

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [activeUsers] = await db
      .select({ n: sql<number>`count(*)` })
      .from(usersTable)
      .where(gte(usersTable.lastLoginAt, weekAgo));
    const [newUsers] = await db
      .select({ n: sql<number>`count(*)` })
      .from(usersTable)
      .where(gte(usersTable.createdAt, since));
    usersStat = {
      activeThisWeek: Number(activeUsers?.n ?? 0),
      newThisWindow: Number(newUsers?.n ?? 0),
      href: "/admin#users",
    };

    const totalProjectsQuery =
      names === null
        ? db.select({ n: sql<number>`count(*)` }).from(projectOrganizationsTable)
        : db
            .select({ n: sql<number>`count(*)` })
            .from(projectOrganizationsTable)
            .where(eq(projectOrganizationsTable.organizationId, (scope as { orgId: string }).orgId));
    const [totalProjects] = await totalProjectsQuery;

    const staleSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const activeProjectsRows = await db
      .selectDistinct({ p: validationRunsTable.projectName })
      .from(validationRunsTable)
      .where(gte(validationRunsTable.queuedAt, staleSince));
    const activeNames = new Set(activeProjectsRows.map((r) => r.p));
    let totalForStale = Number(totalProjects?.n ?? 0);
    let staleCount = totalForStale;
    if (names && names.length > 0) {
      staleCount = names.filter((n) => !activeNames.has(n)).length;
      totalForStale = names.length;
    } else if (names === null) {
      // Count any project_organizations not active
      const allProjRows = await db
        .select({ p: projectOrganizationsTable.projectName })
        .from(projectOrganizationsTable);
      staleCount = allProjRows.filter((r) => !activeNames.has(r.p)).length;
    } else {
      staleCount = 0;
    }
    projectsStat = {
      total: totalForStale,
      stale: staleCount,
      href: "/projects",
    };

    const [ssoCount] = await db
      .select({ n: sql<number>`count(*)` })
      .from(usersTable)
      .where(eq(usersTable.authSource, "oidc"));
    const [localCount] = await db
      .select({ n: sql<number>`count(*)` })
      .from(usersTable)
      .where(eq(usersTable.authSource, "local"));
    const [patCount] = await db
      .select({ n: sql<number>`count(*)` })
      .from(projectGitConfigsTable);
    integrations = {
      ssoUsers: Number(ssoCount?.n ?? 0),
      localUsers: Number(localCount?.n ?? 0),
      gitReposWithPat: Number(patCount?.n ?? 0),
      usersHref: "/admin#users",
      gitReposHref: "/admin#git-repos",
    };
  }

  // --- Memento Admin only -------------------------------------------
  let orgs:
    | {
        total: number;
        leaderboard: Array<{
          organizationId: string;
          displayName: string;
          runs: number;
          href: string;
        }>;
      }
    | null = null;
  let systemHealth: {
    apiErrorRate: number | null;
    recentAdminActions: number;
    href: string;
  } | null = null;

  if (user.role === "memento_admin") {
    const orgRows = await db
      .select({
        id: organizationsTable.id,
        displayName: organizationsTable.displayName,
      })
      .from(organizationsTable);

    const leaderRows = await db
      .select({
        organizationId: projectOrganizationsTable.organizationId,
        runs: sql<number>`count(*)`,
      })
      .from(validationRunsTable)
      .innerJoin(
        projectOrganizationsTable,
        eq(projectOrganizationsTable.projectName, validationRunsTable.projectName),
      )
      .where(gte(validationRunsTable.queuedAt, since))
      .groupBy(projectOrganizationsTable.organizationId)
      .orderBy(desc(sql`count(*)`))
      .limit(5);
    const orgMap = new Map(orgRows.map((o) => [o.id, o.displayName]));
    orgs = {
      total: orgRows.length,
      leaderboard: leaderRows.map((r) => ({
        organizationId: r.organizationId,
        displayName: orgMap.get(r.organizationId) ?? r.organizationId,
        runs: Number(r.runs),
        href: `/projects?org=${encodeURIComponent(r.organizationId)}`,
      })),
    };

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recentAdmin] = await db
      .select({ n: sql<number>`count(*)` })
      .from(auditEventsTable)
      .where(gte(auditEventsTable.createdAt, dayAgo));
    systemHealth = {
      apiErrorRate: null,
      recentAdminActions: Number(recentAdmin?.n ?? 0),
      href: "/admin",
    };
  }

  const body = assertResponseShape(
    GetDashboardSummaryResponse,
    {
      role: user.role,
      window: windowParam,
      onboarding,
      myRecentRuns,
      myProjects,
      draftsInProgress,
      adminProjectsCount,
      recentActivityInMyProjects,
      orgHealth,
      failingTests,
      users: usersStat,
      projects: projectsStat,
      integrations,
      orgs,
      systemHealth,
    },
    "GET /dashboard/summary",
  );

  res.json(body);
});

export default router;
