import { Router, type IRouter } from "express";
import { z } from "zod/v4";

import { requireAdmin } from "@/shared/middlewares/requireRole";
import {
  getCurrentRun,
  getRun,
  isInternalTestRunnerEnabled,
  startRun,
  subscribeToRun,
  INTERNAL_TEST_SUITES,
  InternalTestRunInProgressError,
  InternalTestRunnerDisabledError,
  type InternalTestSuiteKey,
} from "@/features/internal-tests/infrastructure/internalTestRunService";

const router: IRouter = Router();

const suiteKeys = INTERNAL_TEST_SUITES.map((s) => s.key) as [
  InternalTestSuiteKey,
  ...InternalTestSuiteKey[],
];

const startRunBodySchema = z.object({
  suiteKey: z.enum(suiteKeys),
});

router.get(
  "/admin/internal-tests/suites",
  requireAdmin,
  (_req, res): void => {
    res.json({
      enabled: isInternalTestRunnerEnabled(),
      suites: INTERNAL_TEST_SUITES.map((s) => ({
        key: s.key,
        name: s.name,
        description: s.description,
        files: s.files,
      })),
      current: getCurrentRun(),
    });
  },
);

router.post(
  "/admin/internal-tests/runs",
  requireAdmin,
  (req, res): void => {
    const parsed = startRunBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.format() });
      return;
    }
    const user = req.user!;
    try {
      const run = startRun({ suiteKey: parsed.data.suiteKey, user });
      res.status(201).json({ run });
    } catch (err) {
      if (err instanceof InternalTestRunInProgressError) {
        res.status(409).json({
          error: "A test run is already in progress.",
          run: err.run,
        });
        return;
      }
      if (err instanceof InternalTestRunnerDisabledError) {
        res.status(503).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

router.get(
  "/admin/internal-tests/runs/:id",
  requireAdmin,
  (req, res): void => {
    const id = String(req.params.id);
    const found = getRun(id);
    if (!found) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ run: found.run, log: found.log });
  },
);

router.get(
  "/admin/internal-tests/runs/:id/stream",
  requireAdmin,
  (req, res): void => {
    const id = String(req.params.id);
    // Verify the run exists *before* writing any SSE headers so unknown
    // ids can return a real 404 (and not a misleading 200 text/event-stream).
    if (!getRun(id)) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Heartbeat keeps proxies from closing the connection while a long
    // suite is running silently. Comment lines are ignored by EventSource.
    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 15_000);

    let unsubscribe: (() => void) | null = null;
    let ended = false;
    const cleanup = (): void => {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);

    // Subscribe AFTER `cleanup` is initialised — `subscribeToRun` may
    // invoke `onEvent({ type: "done" })` synchronously if the run has
    // already finished by the time we connect.
    unsubscribe = subscribeToRun(id, {
      onBacklog: (lines) => {
        for (const line of lines) {
          send("log", { line });
        }
      },
      onEvent: (event) => {
        if (event.type === "log") {
          send("log", { line: event.line });
        } else if (event.type === "done") {
          send("done", { run: event.run });
          cleanup();
          res.end();
        }
      },
    });
  },
);

export default router;
