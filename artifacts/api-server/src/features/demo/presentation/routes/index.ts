/**
 * `/projects/demo` endpoint that scaffolds + seeds the `MementoDemo`
 * sample project on demand from the home page "Try the demo" card.
 */
import { Router, type IRouter } from "express";
import type { DemoProjectResponse } from "@workspace/api-zod";
import { ensureDemoProject } from "@/features/demo/infrastructure/demoService";

const router: IRouter = Router();

router.post("/projects/demo", async (req, res): Promise<void> => {
  try {
    const result = await ensureDemoProject({ userId: req.user!.id });
    const body: DemoProjectResponse = {
      slnPath: result.project.slnPath,
      solutionName: result.project.solutionName,
      seededTestMethods: result.seededTestMethods,
      seededMocks: result.seededMocks,
    };
    res.status(201).json(body);
  } catch (e) {
    req.log.error({ err: e }, "Failed to scaffold demo project");
    res.status(400).json({ error: (e as Error).message });
  }
});

export default router;
