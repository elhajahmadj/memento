import { Router, type IRouter } from "express";
import { emailTriggerRateLimit } from "@/shared/middlewares/rateLimit";
import {
  ListSsoAccessRequestsResponse,
  RequestSsoAccessBody,
  UpdateSsoAccessRequestBody,
  UpdateSsoAccessRequestResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import { assertResponseShape } from "@/shared/assertResponseShape";
import {
  getSsoAccessRequestById,
  listRecentSsoAccessRequests,
  recordSsoAccessRequest,
  updateSsoAccessRequestResolution,
} from "@/features/sso-access-requests/infrastructure/ssoAccessRequestService";

const router: IRouter = Router();

/**
 * Unauthenticated submission from the SSO deny banner on `/login`.
 * Allow-listed in `requireAuth` so anonymous callers can POST here.
 */
router.post("/auth/sso/request-access", emailTriggerRateLimit, async (req, res): Promise<void> => {
  const parsed = RequestSsoAccessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const email = parsed.data.email.trim();
  // Belt-and-braces email shape check — the OpenAPI string type only
  // bounds length, so reject obviously-malformed values here so admins
  // don't see junk in the queue.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }
  const message = parsed.data.message?.trim() || null;
  const orgKey = parsed.data.orgKey?.trim() || null;
  await recordSsoAccessRequest({
    email,
    gate: parsed.data.gate,
    orgKey,
    message,
  });
  req.log.info(
    { gate: parsed.data.gate, orgKey },
    "Recorded in-app SSO access request",
  );
  res.status(204).end();
});

router.get("/sso-access-requests", requireAdmin, async (req, res) => {
  const includeResolved = req.query.includeResolved === "true";
  const rows = await listRecentSsoAccessRequests({ includeResolved });
  res.json(
    assertResponseShape(
      ListSsoAccessRequestsResponse,
      rows,
      "GET /sso-access-requests",
    ),
  );
});

router.patch(
  "/sso-access-requests/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = String(req.params.id ?? "");
    const existing = await getSsoAccessRequestById(id);
    if (!existing) {
      res.status(404).json({ error: "Access request not found" });
      return;
    }
    const parsed = UpdateSsoAccessRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const updated = await updateSsoAccessRequestResolution({
      id,
      resolution: parsed.data.resolution,
      adminUserId: req.user!.id,
    });
    if (!updated) {
      res.status(404).json({ error: "Access request not found" });
      return;
    }
    req.log.info(
      {
        ssoAccessRequestId: id,
        resolution: parsed.data.resolution,
        adminUserId: req.user!.id,
      },
      "Updated SSO access request resolution",
    );
    res.json(
      assertResponseShape(
        UpdateSsoAccessRequestResponse,
        updated,
        "PATCH /sso-access-requests/:id",
      ),
    );
  },
);

export default router;
