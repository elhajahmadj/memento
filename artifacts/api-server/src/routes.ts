import { Router, type IRouter } from "express";
import healthRouter from "@/shared/routes/health";
import uxFixtureRouter from "@/shared/routes/uxFixture";
import authRouter from "@/features/auth/presentation/routes";
import projectsRouter from "@/features/projects/presentation/routes";
import filesRouter from "@/features/files/presentation/routes";
import codegenRouter from "@/features/codegen/presentation/routes";
import recordingRouter from "@/features/recording/presentation/routes";
import architecturesRouter from "@/features/architectures/presentation/routes";
import usersRouter from "@/features/users/presentation/routes";
import auditRouter from "@/features/audit/presentation/routes";
import forksRouter from "@/features/forks/presentation/routes";
import approvalsRouter from "@/features/approvals/presentation/routes";
import settingsRouter from "@/features/settings/presentation/routes";
import projectAssignmentsRouter from "@/features/assignments/presentation/routes";
import projectAccessRequestsRouter from "@/features/access-requests/presentation/routes";
import validationRouter from "@/features/validation/presentation/routes";
import adminRouter from "@/features/admin/presentation/routes";
import routeMocksRouter from "@/features/route-mocks/presentation/routes";
import demoRouter from "@/features/demo/presentation/routes";
import tourRouter from "@/features/tour/presentation/routes";
import authStatesRouter from "@/features/auth-states/presentation/routes";
import sharedStepsRouter from "@/features/shared-steps/presentation/routes";
import selectorHealRouter from "@/features/selector-heal/presentation/routes";
import testsDiscoveryRouter from "@/features/tests-discovery/presentation/routes";
import aiAgentRouter from "@/features/ai-agent/presentation/routes";
import dashboardRouter from "@/features/dashboard/presentation/routes";
import repoPatsRouter from "@/features/repo-pats/presentation/routes";
import ssoDenialsRouter from "@/features/sso-denials/presentation/routes";
import ssoAccessRequestsRouter from "@/features/sso-access-requests/presentation/routes";
import jmxRouter from "@/features/jmx/presentation/routes";
import nexusConfigRouter from "@/features/nexus-config/presentation/routes";
import teamRouter from "@/features/team/presentation/routes";
import guestRouter from "@/features/guest/presentation/routes";
import { requireAuth } from "@/shared/middlewares/requireAuth";
import { bearerAuth } from "@/shared/middlewares/bearerAuth";
import { guestAllowlist } from "@/shared/middlewares/guestAllowlist";

const router: IRouter = Router();

router.use(healthRouter);
router.use(uxFixtureRouter);
// Bearer-token authentication for machine-to-machine and Nexus-token
// callers. Runs before `requireAuth` so a valid token short-circuits
// the session check. A *missing* `Authorization: Bearer` header is a
// no-op (lets cookie-based session auth proceed), but a *present*
// token that fails verification (bad sig, expired, wrong audience, or
// /userinfo rejection) returns 401 immediately — we never silently
// fall back to the session for a tampered token. This guard runs on
// every `/api` route, including allowlisted ones like `/auth/me`, so
// invalid bearer headers are rejected uniformly.
router.use(bearerAuth);
router.use(requireAuth);
// Guest ("Continue as guest") trial identities get a deny-by-default
// API surface. This is a no-op for every other role, and it must run
// after `requireAuth` because it keys off the resolved `req.user.role`.
router.use(guestAllowlist);

// Auth and admin user-management endpoints sit alongside the rest of the
// protected routes — every signed-in user can hit them, with role gating
// applied per-route as needed.
router.use(authRouter);
router.use(usersRouter);
router.use(projectsRouter);
router.use(filesRouter);
router.use(codegenRouter);
router.use(recordingRouter);
router.use(architecturesRouter);
router.use(auditRouter);
router.use(forksRouter);
router.use(approvalsRouter);
router.use(settingsRouter);
router.use(projectAssignmentsRouter);
router.use(projectAccessRequestsRouter);
router.use(validationRouter);
router.use(adminRouter);
router.use(routeMocksRouter);
router.use(demoRouter);
router.use(tourRouter);
router.use(authStatesRouter);
router.use(sharedStepsRouter);
router.use(selectorHealRouter);
router.use(testsDiscoveryRouter);
router.use(aiAgentRouter);
router.use(dashboardRouter);
router.use(repoPatsRouter);
router.use(ssoDenialsRouter);
router.use(ssoAccessRequestsRouter);
router.use(jmxRouter);
router.use(nexusConfigRouter);
router.use(teamRouter);
router.use(guestRouter);

export default router;
