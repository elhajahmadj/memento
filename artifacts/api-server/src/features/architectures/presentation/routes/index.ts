import { Router, type IRouter } from "express";
import { DeleteArchitectureBody } from "@workspace/api-zod";
import { ArchitectureSchema } from "@/features/architectures/domain/schemas";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import { getContainer } from "@/composition/container";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

router.get("/architectures", async (_req, res) => {
  const result = await getContainer().useCases.architectures.list.execute();
  if (result.kind === "err") {
    res.status(500).json({ error: result.error.message });
    return;
  }
  res.json(result.value);
});

router.get("/architectures/:id", async (req, res): Promise<void> => {
  const result = await getContainer().useCases.architectures.get.execute(
    req.params.id,
  );
  if (result.kind === "err") {
    if (result.error.kind === "not_found") {
      res.status(404).json({ error: "Architecture not found" });
      return;
    }
    res.status(500).json({ error: result.error.message });
    return;
  }
  res.json(result.value);
});

router.post("/architectures", requireAdmin, async (req, res): Promise<void> => {
  // Use the hand-written, fully recursive schema instead of the generated
  // one (Orval emits a non-recursive zod shape for self-referential types).
  const parsed = ArchitectureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? parsed.error.message });
    return;
  }
  const result = await getContainer().useCases.architectures.upsert.execute(
    parsed.data,
  );
  if (result.kind === "err") {
    req.log.error({ err: result.error }, "Failed to save architecture");
    res.status(400).json({ error: result.error.message });
    return;
  }
  res.json(result.value);
});

router.post("/architectures/delete", requireAdmin, async (req, res): Promise<void> => {
  const parsed = DeleteArchitectureBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  const result = await getContainer().useCases.architectures.delete.execute(
    parsed.data.id,
  );
  if (result.kind === "err") {
    req.log.error({ err: result.error }, "Failed to delete architecture");
    res.status(400).json({ error: result.error.message });
    return;
  }
  res.status(204).end();
});

export default router;
