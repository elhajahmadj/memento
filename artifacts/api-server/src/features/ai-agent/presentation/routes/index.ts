import { Router, type IRouter } from "express";
import orgConfigRouter from "./orgConfig";
import projectConfigRouter from "./projectConfig";
import catalogRouter from "./catalog";
import runsRouter from "./runs";
import keysRouter from "./keys";
import keyActionsRouter from "./keyActions";
import aiAssistsRouter from "./aiAssists";

// Aggregator for the AI Agent feature's HTTP surface. Each resource
// lives in its own file so this index stays a thin mount-point list;
// see the per-resource files for request/response parsing.
const router: IRouter = Router();

router.use(orgConfigRouter);
router.use(projectConfigRouter);
router.use(catalogRouter);
router.use(runsRouter);
router.use(keysRouter);
router.use(keyActionsRouter);
router.use(aiAssistsRouter);

export default router;
