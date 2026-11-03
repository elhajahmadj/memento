/**
 * `/users/me/preferences` GET + PUT — per-user UI preferences. Today
 * just the primary-nav layout (top bar vs side nav). The route only
 * ever reads/writes the calling user's own row.
 */
import { Router, type IRouter } from "express";
import {
  GetUserPreferencesResponse,
  UpdateUserPreferencesBody,
  UpdateUserPreferencesResponse,
} from "@workspace/api-zod";
import {
  getUserPreferences,
  updateUserPreferences,
} from "@/features/users/infrastructure/preferencesService";
import { assertResponseShape } from "@/shared/assertResponseShape";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

router.get("/users/me/preferences", async (req, res): Promise<void> => {
  const prefs = await getUserPreferences(req.user!.id);
  res.json(
    assertResponseShape(
      GetUserPreferencesResponse,
      prefs,
      "GET /users/me/preferences",
    ),
  );
});

router.put("/users/me/preferences", async (req, res): Promise<void> => {
  const parsed = UpdateUserPreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  const prefs = await updateUserPreferences(req.user!.id, {
    navLayout: parsed.data.navLayout,
  });
  res.json(
    assertResponseShape(
      UpdateUserPreferencesResponse,
      prefs,
      "PUT /users/me/preferences",
    ),
  );
});

export default router;
