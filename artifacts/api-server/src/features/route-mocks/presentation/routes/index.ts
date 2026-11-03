/**
 * Express router for the Tier 3 route-mocks feature. Mounts at the
 * shared `/api` prefix; auth + role middleware is wired upstream in
 * `routes.ts` so any signed-in user can manage their own mocks.
 */
import { Router, type IRouter } from "express";
import {
  CreateRouteMockBody,
  ListRouteMocksResponse,
  UpdateRouteMockBody,
} from "@workspace/api-zod";
import type { RouteMock } from "@workspace/api-zod";
import {
  createRouteMock,
  deleteRouteMock,
  listRouteMocks,
  updateRouteMock,
} from "@/features/route-mocks/infrastructure/routeMockService";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

function serialize(
  row: Awaited<ReturnType<typeof listRouteMocks>>[number],
) {
  return {
    id: row.id,
    userId: row.userId,
    projectName: row.projectName,
    name: row.name,
    method: row.method,
    urlPattern: row.urlPattern,
    status: row.status,
    bodyJson: (row.bodyJson ?? null) as
      | Record<string, unknown>
      | unknown[]
      | null,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/route-mocks", async (req, res): Promise<void> => {
  const projectName = String(req.query.projectName ?? "").trim();
  if (!projectName) {
    res.status(400).json({ error: "projectName query parameter is required" });
    return;
  }
  const mocks = await listRouteMocks({
    userId: req.user!.id,
    projectName,
  });
  res.json(ListRouteMocksResponse.parse({ mocks: mocks.map(serialize) }));
});

router.post("/route-mocks", async (req, res): Promise<void> => {
  const parsed = CreateRouteMockBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    const created = await createRouteMock({
      userId: req.user!.id,
      projectName: parsed.data.projectName,
      name: parsed.data.name,
      method: parsed.data.method ?? "GET",
      urlPattern: parsed.data.urlPattern,
      status: parsed.data.status ?? 200,
      bodyJson: parsed.data.bodyJson ?? null,
      enabled: parsed.data.enabled ?? true,
    });
    const body: RouteMock = serialize(created) as unknown as RouteMock;
    res.status(201).json(body);
  } catch (e) {
    req.log.error({ err: e }, "Failed to create route mock");
    res.status(400).json({ error: (e as Error).message });
  }
});

router.patch("/route-mocks/:id", async (req, res): Promise<void> => {
  const parsed = UpdateRouteMockBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  const updated = await updateRouteMock({
    id: req.params.id!,
    userId: req.user!.id,
    patch: parsed.data,
  });
  if (!updated) {
    res.status(404).json({ error: "Route mock not found" });
    return;
  }
  const body: RouteMock = serialize(updated) as unknown as RouteMock;
  res.json(body);
});

router.delete("/route-mocks/:id", async (req, res): Promise<void> => {
  const removed = await deleteRouteMock({
    id: req.params.id!,
    userId: req.user!.id,
  });
  if (!removed) {
    res.status(404).json({ error: "Route mock not found" });
    return;
  }
  res.status(204).send();
});

export default router;
