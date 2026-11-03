import { Router, type IRouter } from "express";
import {
  GetMyProjectForkResponse,
  PutMyProjectForkBody,
} from "@workspace/api-zod";
import { requireRole } from "@/shared/middlewares/requireRole";
import {
  getMyFork,
  upsertMyFork,
  deleteMyFork,
} from "@/features/projects/infrastructure/userProjectForkService";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

function paramString(v: unknown): string {
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

// Any signed-in user may read/write/clear *their own* personal fork
// for a project. The userId is taken from the session — never from
// the request body — so users cannot read or write another user's
// fork through this route.
const requireSignedIn = requireRole(
  "memento_admin",
  "admin",
  "limited_admin",
  "limited",
);

router.get(
  "/projects/:projectName/my-fork",
  requireSignedIn,
  async (req, res): Promise<void> => {
    const projectName = paramString(req.params.projectName);
    const fork = await getMyFork(req.user!.id, projectName);
    res.json(GetMyProjectForkResponse.parse(fork));
  },
);

router.put(
  "/projects/:projectName/my-fork",
  requireSignedIn,
  async (req, res): Promise<void> => {
    const projectName = paramString(req.params.projectName);
    const parsed = PutMyProjectForkBody.safeParse(req.body);
    if (!parsed.success) {
      respondValidationError(res, parsed.error);
      return;
    }
    try {
      const fork = await upsertMyFork({
        userId: req.user!.id,
        projectName,
        provider: parsed.data.provider,
        repoUrl: parsed.data.repoUrl,
        pat: parsed.data.pat ?? null,
      });
      res.json(GetMyProjectForkResponse.parse(fork));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.delete(
  "/projects/:projectName/my-fork",
  requireSignedIn,
  async (req, res): Promise<void> => {
    const projectName = paramString(req.params.projectName);
    await deleteMyFork(req.user!.id, projectName);
    res.status(204).end();
  },
);

export default router;
