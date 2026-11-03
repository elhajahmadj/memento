import { Router, type IRouter } from "express";
import {
  ListRepoPatsResponse,
  ListRepoPatsResponseItem,
  UpdateRepoPatResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import { assertResponseShape } from "@/shared/assertResponseShape";
import {
  listRepoPats,
  createRepoPat,
  updateRepoPat,
  deleteRepoPat,
  getRepoPat,
} from "@/features/repo-pats/infrastructure/repoPatService";

const router: IRouter = Router();

function paramString(v: unknown): string {
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

router.get("/repo-pats", requireAdmin, async (_req, res) => {
  const rows = await listRepoPats();
  res.json(assertResponseShape(ListRepoPatsResponse, rows, "GET /repo-pats"));
});

router.post("/repo-pats", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body as {
    provider?: string;
    name?: string;
    pat?: string;
  };
  if (!body.provider || !body.name || !body.pat) {
    res
      .status(400)
      .json({ error: "provider, name, and pat are required" });
    return;
  }
  try {
    const created = await createRepoPat({
      provider: body.provider,
      name: body.name,
      pat: body.pat,
      userId: req.user!.id,
    });
    res
      .status(201)
      .json(
        assertResponseShape(
          ListRepoPatsResponseItem,
          created,
          "POST /repo-pats",
        ),
      );
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.patch(
  "/repo-pats/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = paramString(req.params.id);
    const existing = await getRepoPat(id);
    if (!existing) {
      res.status(404).json({ error: "Repo PAT not found" });
      return;
    }
    const body = req.body as {
      provider?: string;
      name?: string;
      pat?: string | null;
    };
    if (!body.provider || !body.name) {
      res.status(400).json({ error: "provider and name are required" });
      return;
    }
    try {
      const updated = await updateRepoPat({
        id,
        provider: body.provider,
        name: body.name,
        pat: body.pat ?? null,
        userId: req.user!.id,
      });
      res.json(
        assertResponseShape(
          UpdateRepoPatResponse,
          updated,
          "PATCH /repo-pats/:id",
        ),
      );
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

router.delete(
  "/repo-pats/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = paramString(req.params.id);
    const existing = await getRepoPat(id);
    if (!existing) {
      res.status(404).json({ error: "Repo PAT not found" });
      return;
    }
    const result = await deleteRepoPat(id);
    if (!result.deleted) {
      res.status(409).json({
        error: `This PAT is in use by ${result.boundProjects.length} project(s): ${result.boundProjects.join(", ")}. Unbind it from those projects before deleting.`,
        boundProjects: result.boundProjects,
      });
      return;
    }
    res.status(204).end();
  },
);

export default router;
