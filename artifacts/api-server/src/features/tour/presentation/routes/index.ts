/**
 * `/users/me/tour-state` + `/users/me/tour-seen` endpoints powering the
 * 5-step onboarding coachmark tour.
 */
import { Router, type IRouter } from "express";
import {
  GetTourStateResponse,
  SetTourSeenBody,
  SetTourSeenResponse,
} from "@workspace/api-zod";
import {
  getTourState,
  setTourSeen,
} from "@/features/tour/infrastructure/tourService";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

router.get("/users/me/tour-state", async (req, res): Promise<void> => {
  const hasSeenTour = await getTourState(req.user!.id);
  res.json(GetTourStateResponse.parse({ hasSeenTour }));
});

router.post("/users/me/tour-seen", async (req, res): Promise<void> => {
  const parsed = SetTourSeenBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  const hasSeenTour = await setTourSeen({
    userId: req.user!.id,
    hasSeenTour: parsed.data.hasSeenTour,
  });
  res.json(SetTourSeenResponse.parse({ hasSeenTour }));
});

export default router;
