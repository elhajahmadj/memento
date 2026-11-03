import { Router, type IRouter } from "express";
import {
  AttachToOpenBrowserBody,
  AttachToOpenBrowserResponse,
} from "@workspace/api-zod";
import { assertResponseShape } from "@/shared/assertResponseShape";
import {
  attachToOpenBrowser,
  AttachExistingSuiteMissingError,
} from "@/features/recording/infrastructure/recordingService";
import { requireAdminOrAssignedToCurrentProjectOrOwner } from "@/shared/middlewares/requireRole";
import { respondValidationError } from "@/shared/validationError";

export function attachRoutes(): IRouter {
  const router = Router();

  router.post(
    "/recording/attach-to-open-browser",
    requireAdminOrAssignedToCurrentProjectOrOwner,
    async (req, res): Promise<void> => {
      // Attach forces suite mode = `existing` and target = `testMethod`.
      // These checks read directly from the raw request body — the
      // generated schema deliberately doesn't expose `suiteMode` /
      // `target` (they're pinned server-side) and zod's default
      // behavior would strip them silently. We need to surface the
      // mismatch as a structured 400 instead so the UI never drifts
      // into the wrong mode after attach.
      const rawBody = (req.body ?? {}) as {
        suiteMode?: unknown;
        target?: unknown;
        startUrl?: unknown;
        urlName?: unknown;
        newTestClassName?: unknown;
      };
      if (rawBody.suiteMode !== undefined && rawBody.suiteMode !== "existing") {
        res.status(400).json({
          error: "attach-to-open-browser requires suiteMode='existing'",
        });
        return;
      }
      if (rawBody.target !== undefined && rawBody.target !== "testMethod") {
        res.status(400).json({
          error: "attach-to-open-browser requires target='testMethod'",
        });
        return;
      }
      // Explicitly reject fields that would either change the base URL the
      // browser is already pointed at (`startUrl`, `urlName`) or create a
      // new suite (`newTestClassName`). Zod would silently strip these; we
      // surface them as a structured 400 so the UI can't drift after
      // attach.
      if (rawBody.startUrl !== undefined) {
        res.status(400).json({
          error:
            "attach-to-open-browser cannot accept startUrl — the URL is fixed by /recording/open-browser",
        });
        return;
      }
      if (rawBody.urlName !== undefined) {
        res.status(400).json({
          error:
            "attach-to-open-browser cannot accept urlName — open-browser sessions skip the named-URL store",
        });
        return;
      }
      if (rawBody.newTestClassName !== undefined) {
        res.status(400).json({
          error:
            "attach-to-open-browser cannot accept newTestClassName — suiteMode is pinned to 'existing'",
        });
        return;
      }
      const parsed = AttachToOpenBrowserBody.safeParse(req.body);
      if (!parsed.success) {
        respondValidationError(res, parsed.error);
        return;
      }
      const data = parsed.data;
      const existingPath = data.existingTestClassPath?.trim() ?? "";
      if (!existingPath) {
        res.status(400).json({ error: "existingTestClassPath is required" });
        return;
      }
      const methodName = data.methodName?.trim() ?? "";
      if (!methodName) {
        res.status(400).json({ error: "methodName is required" });
        return;
      }
      // Test Categories: both-or-neither (mirrors /recording/start). Half-
      // supplied pairs are rejected here so downstream codegens can rely
      // on the invariant.
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
      const ignoreReasonRaw =
        typeof data.ignoreReason === "string" ? data.ignoreReason.trim() : "";
      const ignoreReason = ignoreReasonRaw.length > 0 ? ignoreReasonRaw : null;
      if (!req.user?.id) {
        res.status(401).json({ active: false, message: "Unauthorized" });
        return;
      }
      try {
        const status = await attachToOpenBrowser({
          userId: req.user.id,
          existingTestClassPath: existingPath,
          methodName,
          overwriteExistingMethod: data.overwriteExistingMethod === true,
          ignoreReason,
          categoryConstantName,
          categoryValue,
          keepBrowserOpen: data.keepBrowserOpen === true,
        });
        res.json(
          assertResponseShape(
            AttachToOpenBrowserResponse,
            status,
            "POST /recording/attach-to-open-browser",
          ),
        );
      } catch (e) {
        if (e instanceof AttachExistingSuiteMissingError) {
          res.status(404).json({ error: e.message });
          return;
        }
        res.status(400).json({ active: false, message: (e as Error).message });
      }
    },
  );

  return router;
}
