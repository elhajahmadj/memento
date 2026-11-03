import { Router, type IRouter } from "express";
import { guestRateLimit } from "@/shared/middlewares/rateLimit";
import { eq } from "drizzle-orm";
import { db, isProfileComplete, usersTable, type User } from "@workspace/db";
import { logger } from "@/shared/logger";
import {
  createGuestSession,
  findActiveGuestSession,
} from "@/features/guest/infrastructure/guestSessionService";
import { MAX_CONCURRENT_GUESTS } from "@/features/guest/domain/types";

const router: IRouter = Router();

/**
 * Copy shown on the login card when every slot is taken. Kept here (not
 * in the SPA) so the server is the single source of truth for the
 * refusal reason and a direct API caller sees the same wording.
 */
const AT_CAPACITY_MESSAGE =
  "Max guest sessions in use for the day. Please try again later.";

/**
 * Wire shape for a guest, matching `AuthUser` in the OpenAPI spec.
 * `effectiveRole` is always the raw role: guests have no organizations,
 * so there is no per-org resolution to do.
 */
function toGuestAuthUser(user: User, expiresAt: Date) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    effectiveRole: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    title: user.title,
    email: user.email,
    profileComplete: isProfileComplete(user),
    authSource: user.authSource,
    guestExpiresAt: expiresAt.toISOString(),
  };
}

async function findUserById(id: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  return user ?? null;
}

/**
 * `POST /auth/guest` — mint a throwaway trial identity.
 *
 * Unauthenticated (allow-listed in `requireAuth`). Deliberately does
 * NOT reuse the login use case: guests have no credentials to verify,
 * and the interesting work is slot acquisition, which lives in the
 * guest service.
 *
 * Responses:
 *  - `200` `{ user, expiresAt }` — signed in as a guest
 *  - `429` `{ error, code: "GUEST_CAPACITY" }` — all slots are taken
 */
router.post("/auth/guest", guestRateLimit, async (req, res): Promise<void> => {
  // Already signed in as a guest? Hand back the existing session
  // rather than burning a second slot. This makes the button
  // idempotent against double-clicks and back-button replays.
  const existingUserId = req.session.userId;
  if (existingUserId) {
    const existing = await findActiveGuestSession(existingUserId);
    if (existing) {
      const user = await findUserById(existingUserId);
      if (user) {
        res.json({
          user: toGuestAuthUser(user, existing.expiresAt),
          expiresAt: existing.expiresAt.toISOString(),
        });
        return;
      }
    }
  }

  let outcome;
  try {
    outcome = await createGuestSession();
  } catch (err) {
    req.log.error({ err }, "Failed to create guest session");
    res.status(500).json({ error: "Failed to start a guest session." });
    return;
  }

  if (outcome.kind === "at_capacity") {
    logger.info(
      { cap: MAX_CONCURRENT_GUESTS },
      "guest sign-in refused: all slots in use",
    );
    res
      .status(429)
      .json({ error: AT_CAPACITY_MESSAGE, code: "GUEST_CAPACITY" });
    return;
  }

  const user = await findUserById(outcome.userId);
  if (!user) {
    res.status(500).json({ error: "Failed to start a guest session." });
    return;
  }

  // Regenerate before writing `userId` so a pre-existing (possibly
  // attacker-fixed) session id can never be promoted to an
  // authenticated one. A regenerate failure is non-fatal — we still
  // want the guest signed in — but it is worth a warning.
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  ).catch((err: unknown) => {
    req.log.warn({ err }, "guest session regenerate failed");
  });
  req.session.userId = user.id;
  req.session.activeOrgId = null;
  await new Promise<void>((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );

  logger.info(
    { guestUserId: user.id, expiresAt: outcome.expiresAt.toISOString() },
    "guest session started",
  );

  res.json({
    user: toGuestAuthUser(user, outcome.expiresAt),
    expiresAt: outcome.expiresAt.toISOString(),
  });
});

export default router;
