import { Router, type IRouter } from "express";
import {
  GenerateTestClassBody,
  GenerateTestMethodBody,
} from "@workspace/api-zod";
import {
  addTestMethod,
  generateTestClass,
} from "@/features/codegen/infrastructure/codegen";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import { requireAdminOrAssignedToCurrentProject } from "@/shared/middlewares/requireRole";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

router.post("/codegen/test-class", requireAdminOrAssignedToCurrentProject, async (req, res): Promise<void> => {
  const project = getCurrentProject(req.user?.id);
  if (!project) {
    res.status(404).json({ error: "No project loaded" });
    return;
  }
  const parsed = GenerateTestClassBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    const filePath = await generateTestClass(project, parsed.data.className);
    res.status(201).json({ ok: true, message: filePath });
  } catch (e) {
    res.status(400).json({ ok: false, message: (e as Error).message });
  }
});

router.post("/codegen/test-method", requireAdminOrAssignedToCurrentProject, async (req, res): Promise<void> => {
  const project = getCurrentProject(req.user?.id);
  if (!project) {
    res.status(404).json({ error: "No project loaded" });
    return;
  }
  const parsed = GenerateTestMethodBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    const result = await addTestMethod(
      project,
      parsed.data.filePath,
      parsed.data.methodName,
    );
    if (result.renamed) {
      res.json({
        ok: true,
        message:
          `A method named "${result.requestedName}" already exists in this ` +
          `class; added "${result.methodName}" instead to avoid a duplicate ` +
          `that would fail to compile.`,
      });
    } else {
      res.json({ ok: true });
    }
  } catch (e) {
    res.status(400).json({ ok: false, message: (e as Error).message });
  }
});

export default router;
