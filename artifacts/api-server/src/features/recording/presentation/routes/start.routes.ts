import { Router, type IRouter } from "express";
import {
  StartRecordingBody,
  StartRecordingResponse,
} from "@workspace/api-zod";
import { assertResponseShape } from "@/shared/assertResponseShape";
import { start } from "@/features/recording/infrastructure/recordingService";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import { requireAdminOrAssignedToCurrentProjectOrOwner } from "@/shared/middlewares/requireRole";
import { respondValidationError } from "@/shared/validationError";

export function startRoutes(): IRouter {
  const router = Router();

  router.post(
    "/recording/start",
    requireAdminOrAssignedToCurrentProjectOrOwner,
    async (req, res): Promise<void> => {
      const parsed = StartRecordingBody.safeParse(req.body);
      if (!parsed.success) {
        respondValidationError(res, parsed.error);
        return;
      }
      const data = parsed.data;
      const target = data.target;
      const methodName = (data.methodName ?? "").trim();
      if (target === "testMethod" && !methodName) {
        res.status(400).json({ error: "methodName is required for testMethod target" });
        return;
      }
      const startUrlRaw = data.startUrl?.trim() ?? "";
      if (!startUrlRaw) {
        res.status(400).json({ error: "startUrl is required" });
        return;
      }
      const startUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(startUrlRaw)
        ? startUrlRaw
        : `https://${startUrlRaw}`;
      try {
        new URL(startUrl);
      } catch {
        res.status(400).json({ error: "startUrl must be a valid URL" });
        return;
      }
      const urlName = data.urlName?.trim() ?? "";
      if (!urlName) {
        res.status(400).json({ error: "urlName is required" });
        return;
      }
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(urlName)) {
        res.status(400).json({
          error:
            "urlName must start with a letter and contain only letters, digits, or underscores",
        });
        return;
      }
      const hasExisting = !!data.existingTestClassPath?.trim();
      const hasNew = !!data.newTestClassName?.trim();
      if (hasExisting === hasNew) {
        res.status(400).json({
          error:
            "Provide exactly one of existingTestClassPath or newTestClassName",
        });
        return;
      }
      let viewport: { width: number; height: number } | undefined;
      if (data.viewport) {
        const w = Math.round(Number(data.viewport.width));
        const h = Math.round(Number(data.viewport.height));
        if (
          !Number.isFinite(w) ||
          !Number.isFinite(h) ||
          w < 320 ||
          w > 3840 ||
          h < 240 ||
          h > 2160
        ) {
          res.status(400).json({
            error:
              "viewport.width must be 320-3840 and viewport.height must be 240-2160",
          });
          return;
        }
        viewport = { width: w, height: h };
      }
      // Recorder suite metadata (Ignore Test + Test Categories). All three
      // fields are optional and default to `null`; `categoryConstantName`
      // and `categoryValue` are both-or-neither — half-supplied pairs are
      // rejected here so downstream codegens can rely on the invariant.
      const ignoreReasonRaw =
        typeof data.ignoreReason === "string" ? data.ignoreReason.trim() : "";
      const ignoreReason = ignoreReasonRaw.length > 0 ? ignoreReasonRaw : null;
      const categoryConstantNameRaw =
        typeof data.categoryConstantName === "string"
          ? data.categoryConstantName.trim()
          : "";
      const categoryValueRaw =
        typeof data.categoryValue === "string" ? data.categoryValue.trim() : "";
      const hasCategoryName = categoryConstantNameRaw.length > 0;
      const hasCategoryValue = categoryValueRaw.length > 0;
      if (hasCategoryName !== hasCategoryValue) {
        res.status(400).json({
          error:
            "categoryConstantName and categoryValue must be provided together (both filled or both empty)",
        });
        return;
      }
      const categoryConstantName = hasCategoryName ? categoryConstantNameRaw : null;
      const categoryValue = hasCategoryValue ? categoryValueRaw : null;
      if (!req.user?.id) {
        res.status(401).json({ active: false, message: "Unauthorized" });
        return;
      }
      try {
        const status = await start(
          {
            startUrl,
            urlName,
            target,
            methodName,
            existingTestClassPath: data.existingTestClassPath ?? null,
            newTestClassName: data.newTestClassName ?? null,
            overwriteExistingMethod:
              target === "testMethod" && data.overwriteExistingMethod === true,
            viewport,
            // T002 — forward the saved-login + capture-mode flags into the
            // recorder. Missing forwarding here previously meant the
            // checkbox was a no-op and capture sessions could leak cookies
            // or login steps into generated test code on finalize.
            useSavedLogin: data.useSavedLogin === true,
            // Omitted means replay (see the OpenAPI description): only an
            // explicit false opts out.
            replaySetup: data.replaySetup !== false,
            captureMode: data.captureMode === true,
            ignoreReason,
            categoryConstantName,
            categoryValue,
            keepBrowserOpen: data.keepBrowserOpen === true,
          },
          req.user.id,
          getCurrentProject(req.user.id),
        );
        res.json(
          assertResponseShape(StartRecordingResponse, status, "POST /recording/start"),
        );
      } catch (e) {
        res.status(400).json({ active: false, message: (e as Error).message });
      }
    },
  );

  return router;
}
