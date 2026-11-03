import { Router, type IRouter } from "express";
import {
  GetHookBackupRetentionResponse,
  SetHookBackupRetentionBody,
  GetValidationTraceRetentionResponse,
  SetValidationTraceRetentionBody,
} from "@workspace/api-zod";
import {
  getHookBackupRetention,
  setHookBackupRetention,
  getValidationTraceRetentionDays,
  setValidationTraceRetentionDays,
} from "@/features/settings/infrastructure/settings";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

router.get("/settings/hook-backup-retention", async (_req, res) => {
  const retention = await getHookBackupRetention();
  res.json(GetHookBackupRetentionResponse.parse({ retention }));
});

router.put(
  "/settings/hook-backup-retention",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = SetHookBackupRetentionBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    try {
      const retention = await setHookBackupRetention(parsed.data.retention);
      res.json(GetHookBackupRetentionResponse.parse({ retention }));
    } catch (e) {
      req.log.error({ err: e }, "Failed to update hook backup retention");
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.get("/settings/validation-trace-retention", async (_req, res) => {
  const retentionDays = await getValidationTraceRetentionDays();
  res.json(GetValidationTraceRetentionResponse.parse({ retentionDays }));
});

router.put(
  "/settings/validation-trace-retention",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = SetValidationTraceRetentionBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    try {
      const retentionDays = await setValidationTraceRetentionDays(
        parsed.data.retentionDays,
      );
      res.json(GetValidationTraceRetentionResponse.parse({ retentionDays }));
    } catch (e) {
      req.log.error(
        { err: e },
        "Failed to update validation trace retention",
      );
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

export default router;
