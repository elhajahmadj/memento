import { Router, type IRouter } from "express";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import {
  getLastValidationTraceCleanupRun,
  getValidationTraceDirStats,
  VALIDATION_TRACE_MAX_AGE_MS,
} from "@/features/validation/infrastructure/validationTraceCleanup";
import internalTestsRouter from "@/features/admin/presentation/routes/internalTests";

const router: IRouter = Router();

router.use(internalTestsRouter);

router.get(
  "/admin/validation-traces",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const stats = await getValidationTraceDirStats();
    const last = getLastValidationTraceCleanupRun();
    res.json({
      dir: stats.dir,
      fileCount: stats.fileCount,
      totalBytes: stats.totalBytes,
      maxAgeMs: VALIDATION_TRACE_MAX_AGE_MS,
      lastCleanup: last
        ? {
            finishedAt: new Date(last.finishedAt).toISOString(),
            filesDeleted: last.filesDeleted,
            rowsCleared: last.rowsCleared,
          }
        : null,
    });
  },
);

export default router;
