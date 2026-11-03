import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  ListSsoDenialsResponse,
  UpdateSsoDenialBody,
} from "@workspace/api-zod";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import { assertResponseShape } from "@/shared/assertResponseShape";
import { isDevEnvironment } from "@/features/auth/infrastructure/devEnvironment";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import {
  listRecentSsoDenials,
  recordSsoDenial,
  setSsoDenialHandled,
  type SsoDenialGate,
} from "@/features/sso-denials/infrastructure/ssoDenialService";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

const IdParam = z.object({ id: z.string().uuid() });

router.get("/sso-denials", requireAdmin, async (req, res) => {
  const includeHandled = req.query.includeHandled === "true";
  const rows = await listRecentSsoDenials({ includeHandled });
  res.json(
    assertResponseShape(ListSsoDenialsResponse, rows, "GET /sso-denials"),
  );
});

/**
 * Toggle the handled state of a denial. Admin-only. The action is
 * captured in the audit log so we know who cleared what.
 */
router.patch(
  "/sso-denials/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsedParams = IdParam.safeParse(req.params);
    if (!parsedParams.success) {
      respondValidationError(res, parsedParams.error);
      return;
    }
    const parsedBody = UpdateSsoDenialBody.safeParse(req.body);
    if (!parsedBody.success) {
      respondValidationError(res, parsedBody.error);
      return;
    }
    const adminUserId = req.user!.id;
    const updated = await setSsoDenialHandled({
      id: parsedParams.data.id,
      handled: parsedBody.data.handled,
      adminUserId,
    });
    if (!updated) {
      res.status(404).json({ error: "SSO denial not found" });
      return;
    }
    await recordAudit({
      user: { id: adminUserId },
      action: parsedBody.data.handled
        ? "sso_denial_dismiss"
        : "sso_denial_unhandle",
      details: {
        ssoDenialId: updated.id,
        subject: updated.subject,
        gate: updated.gate,
        orgKey: updated.orgKey,
      },
    });
    res.json(updated);
  },
);

/**
 * Dev-only seed endpoint used by the e2e spec to write a denial row
 * without needing a real OIDC provider. Returns 404 outside
 * `local` / `development` environments so it never ships in prod.
 */
router.post("/sso-denials/dev-seed", async (req, res): Promise<void> => {
  if (!isDevEnvironment()) {
    res.status(404).end();
    return;
  }
  const body = req.body as {
    subject?: unknown;
    email?: unknown;
    gate?: unknown;
    orgKey?: unknown;
  };
  const subject = typeof body.subject === "string" ? body.subject : "";
  const gateRaw = typeof body.gate === "string" ? body.gate : "";
  const validGates: readonly SsoDenialGate[] = [
    "no_memento_user",
    "no_memento_access",
    "no_org",
  ];
  if (!subject || !(validGates as readonly string[]).includes(gateRaw)) {
    res
      .status(400)
      .json({ error: "subject and a valid gate are required" });
    return;
  }
  await recordSsoDenial({
    subject,
    email: typeof body.email === "string" ? body.email : null,
    gate: gateRaw as SsoDenialGate,
    orgKey: typeof body.orgKey === "string" ? body.orgKey : null,
  });
  res.status(204).end();
});

export default router;
