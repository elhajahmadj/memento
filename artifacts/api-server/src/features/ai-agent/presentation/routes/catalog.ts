import { Router, type IRouter } from "express";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import {
  listCatalogMethods,
  listCatalogSelectors,
  listCatalogCategories,
  upsertCatalogMethod,
  upsertCatalogSelector,
  upsertCatalogCategory,
  deleteCatalogMethod,
  deleteCatalogSelector,
  deleteCatalogCategory,
  renameCatalogMethod,
  renameCatalogSelector,
} from "@/features/ai-agent/infrastructure/aiAgentService";
import { paramString } from "./_shared";

const router: IRouter = Router();

router.get(
  "/ai-agent/projects/:projectName/catalog",
  requireAdmin,
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const [methods, selectors, categories] = await Promise.all([
      listCatalogMethods(projectName),
      listCatalogSelectors(projectName),
      listCatalogCategories(projectName),
    ]);
    res.json({
      methods: methods.map((m) => ({
        id: m.id,
        name: m.name,
        params: (m.params as string[] | null) ?? [],
        description: m.description,
        source: m.source,
        confidence: m.confidence,
        createdInRunId: m.createdInRunId,
        createdAt: m.createdAt.toISOString(),
      })),
      selectors: selectors.map((s) => ({
        id: s.id,
        name: s.name,
        selector: s.selector,
        source: s.source,
        confidence: s.confidence,
        createdInRunId: s.createdInRunId,
        createdAt: s.createdAt.toISOString(),
      })),
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        source: c.source,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  },
);

router.post(
  "/ai-agent/projects/:projectName/catalog/methods",
  requireAdmin,
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const body = req.body as { name?: string; params?: string[] };
    if (!body.name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const r = await upsertCatalogMethod({
      projectName,
      name: body.name,
      params: body.params,
      source: "user",
    });
    res.json({ id: r.row.id, name: r.row.name, created: r.created });
  },
);

router.post(
  "/ai-agent/projects/:projectName/catalog/selectors",
  requireAdmin,
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const body = req.body as { name?: string; selector?: string };
    if (!body.name || !body.selector) {
      res.status(400).json({ error: "name and selector required" });
      return;
    }
    const r = await upsertCatalogSelector({
      projectName,
      name: body.name,
      selector: body.selector,
      source: "user",
    });
    res.json({
      id: r.row.id,
      name: r.row.name,
      selector: r.row.selector,
      created: r.created,
    });
  },
);

router.post(
  "/ai-agent/projects/:projectName/catalog/categories",
  requireAdmin,
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const body = req.body as { name?: string };
    if (!body.name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const r = await upsertCatalogCategory({
      projectName,
      name: body.name,
      source: "user",
    });
    res.json({ id: r.row.id, name: r.row.name, created: r.created });
  },
);

router.patch(
  "/ai-agent/projects/:projectName/catalog/methods/:id",
  requireAdmin,
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const id = paramString(req.params.id);
    const body = req.body as { name?: string };
    if (!body.name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const row = await renameCatalogMethod(id, projectName, body.name);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ id: row.id, name: row.name });
  },
);

router.patch(
  "/ai-agent/projects/:projectName/catalog/selectors/:id",
  requireAdmin,
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const id = paramString(req.params.id);
    const body = req.body as { name?: string };
    if (!body.name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const row = await renameCatalogSelector(id, projectName, body.name);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ id: row.id, name: row.name });
  },
);

router.delete(
  "/ai-agent/projects/:projectName/catalog/methods/:id",
  requireAdmin,
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const id = paramString(req.params.id);
    await deleteCatalogMethod(id, projectName);
    res.status(204).end();
  },
);

router.delete(
  "/ai-agent/projects/:projectName/catalog/selectors/:id",
  requireAdmin,
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const id = paramString(req.params.id);
    await deleteCatalogSelector(id, projectName);
    res.status(204).end();
  },
);

router.delete(
  "/ai-agent/projects/:projectName/catalog/categories/:id",
  requireAdmin,
  async (req, res) => {
    const projectName = paramString(req.params.projectName);
    const id = paramString(req.params.id);
    await deleteCatalogCategory(id, projectName);
    res.status(204).end();
  },
);

export default router;
