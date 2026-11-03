import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  getStatus,
  getCurrentSessionOwner,
} from "@/features/recording/infrastructure/recordingService";

export function statusRoutes(): IRouter {
  const router = Router();

  router.get("/recording/status", async (req, res) => {
    const base = getStatus();
    // Admin / limited-admin viewers also get owner identity for the active
    // session so the workbench can show "recording in progress by X" plus
    // a Force Discard affordance when another user holds the global
    // session. Non-admin viewers only see the legacy fields. The owner
    // username is looked up from the users table on demand so we don't
    // have to keep a denormalized copy on the in-memory session.
    const role = req.user?.role;
    const isAdminViewer = role === "admin" || role === "limited_admin";
    if (!isAdminViewer) {
      res.json(base);
      return;
    }
    const owner = getCurrentSessionOwner();
    if (!owner) {
      res.json(base);
      return;
    }
    let ownerUsername: string | null = null;
    try {
      const rows = await db
        .select({ username: usersTable.username })
        .from(usersTable)
        .where(eq(usersTable.id, owner.userId))
        .limit(1);
      ownerUsername = rows[0]?.username ?? null;
    } catch {
      ownerUsername = null;
    }
    res.json({
      ...base,
      ownerUserId: owner.userId,
      ownerUsername,
      ownerProjectName: owner.projectName,
      isOwnedByOther: req.user?.id ? owner.userId !== req.user.id : false,
    });
  });

  return router;
}
