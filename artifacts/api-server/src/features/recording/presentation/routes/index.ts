import { Router, type IRouter } from "express";
import { statusRoutes } from "./status.routes";
import { infoRoutes } from "./info.routes";
import { startRoutes } from "./start.routes";
import { openBrowserRoutes } from "./openBrowser.routes";
import { prewarmRoutes } from "./prewarm.routes";
import { attachRoutes } from "./attach.routes";
import { stopRoutes } from "./stop.routes";
import { finalizeRoutes } from "./finalize.routes";
import { historyRoutes } from "./history.routes";
import { devFixtureRoutes } from "./devFixture.routes";

const router: IRouter = Router();

router.use(statusRoutes());
router.use(devFixtureRoutes());
router.use(infoRoutes());
router.use(startRoutes());
router.use(openBrowserRoutes());
router.use(prewarmRoutes());
router.use(attachRoutes());
router.use(stopRoutes());
router.use(finalizeRoutes());
router.use(historyRoutes());

export default router;
