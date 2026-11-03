import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  teamInvitationsTable,
  organizationsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateTeamInvitationBody,
  CreateTeamAccessRequestBody,
} from "@workspace/api-zod";
import { requireAdmin } from "@/shared/middlewares/requireRole";
import { logger } from "@/shared/logger";

const router: IRouter = Router();

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type InvitationRow = typeof teamInvitationsTable.$inferSelect;

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

function absoluteAcceptUrl(req: import("express").Request, token: string) {
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(protoHeader)
    ? protoHeader[0]
    : protoHeader ?? req.protocol;
  const host = req.get("host") ?? "localhost";
  return `${proto}://${host}/accept-invite?token=${encodeURIComponent(token)}`;
}

async function toDto(
  row: InvitationRow,
  opts: { includeAcceptUrl?: string; orgName?: string | null; createdByUsername?: string | null } = {},
) {
  return {
    id: row.id,
    email: row.email,
    role: row.role as "memento_admin" | "admin" | "limited_admin" | "limited",
    organizationId: row.organizationId,
    organizationName: opts.orgName ?? null,
    deliveryMethod: row.deliveryMethod as "email" | "copy_link" | "idp",
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status as "pending" | "accepted" | "revoked" | "expired",
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    createdByUsername: opts.createdByUsername ?? null,
    acceptUrl: opts.includeAcceptUrl ?? null,
  };
}

async function loadDecorations(rows: InvitationRow[]) {
  const orgIds = Array.from(
    new Set(rows.map((r) => r.organizationId).filter((v): v is string => !!v)),
  );
  const userIds = Array.from(
    new Set(
      rows.map((r) => r.createdByUserId).filter((v): v is string => !!v),
    ),
  );
  const orgs = orgIds.length
    ? await db
        .select({ id: organizationsTable.id, name: organizationsTable.displayName })
        .from(organizationsTable)
        .where(inArray(organizationsTable.id, orgIds))
    : [];
  const users = userIds.length
    ? await db
        .select({ id: usersTable.id, username: usersTable.username })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds))
    : [];
  return {
    orgsById: new Map(orgs.map((o) => [o.id, o.name])),
    usersById: new Map(users.map((u) => [u.id, u.username])),
  };
}

/**
 * True when the caller is allowed to read/mutate `row`. Memento Admin
 * sees every invitation; every other admin is scoped to invitations
 * stamped with their active org. Invitations with no org (local-user
 * invites) are visible only to the admin who created them.
 */
function callerCanAccess(
  row: InvitationRow,
  caller: { id: string; role: string },
  activeOrgId: string | null,
): boolean {
  if (caller.role === "memento_admin") return true;
  if (row.organizationId) return row.organizationId === activeOrgId;
  return row.createdByUserId === caller.id;
}

router.get("/team/invitations", requireAdmin, async (req, res) => {
  const caller = req.user!;
  const activeOrgId = req.session?.activeOrgId ?? null;
  // Memento Admin sees every pending invitation; other admins are
  // scoped to invitations created against their active org (or with no
  // org for local-user invites the caller created).
  const where =
    caller.role === "memento_admin"
      ? eq(teamInvitationsTable.status, "pending")
      : and(
          eq(teamInvitationsTable.status, "pending"),
          activeOrgId
            ? eq(teamInvitationsTable.organizationId, activeOrgId)
            : eq(teamInvitationsTable.createdByUserId, caller.id),
        );
  const rows = await db
    .select()
    .from(teamInvitationsTable)
    .where(where);
  const { orgsById, usersById } = await loadDecorations(rows);
  const dtos = await Promise.all(
    rows.map((r) =>
      toDto(r, {
        orgName: r.organizationId ? orgsById.get(r.organizationId) ?? null : null,
        createdByUsername: r.createdByUserId
          ? usersById.get(r.createdByUserId) ?? null
          : null,
      }),
    ),
  );
  res.json(dtos);
});

router.post("/team/invitations", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateTeamInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const { email: rawEmail, role, deliveryMethod, firstName, lastName } = parsed.data;
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }

  const caller = req.user!;
  if (role === "memento_admin" && caller.role !== "memento_admin") {
    res.status(403).json({
      error: "Only a Memento Admin can invite someone as a Memento Admin.",
    });
    return;
  }

  const activeOrgId = req.session?.activeOrgId ?? null;

  // Conflict: existing pending invitation for the same email/org.
  const [conflict] = await db
    .select({ id: teamInvitationsTable.id })
    .from(teamInvitationsTable)
    .where(
      and(
        eq(teamInvitationsTable.email, email),
        eq(teamInvitationsTable.status, "pending"),
      ),
    )
    .limit(1);
  if (conflict) {
    res.status(409).json({
      error:
        "An active invitation already exists for this email. Resend or revoke it before sending a new one.",
    });
    return;
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [created] = await db
    .insert(teamInvitationsTable)
    .values({
      email,
      role,
      organizationId: activeOrgId ?? null,
      deliveryMethod,
      firstName: firstName?.trim() || null,
      lastName: lastName?.trim() || null,
      token,
      status: "pending",
      expiresAt,
      createdByUserId: caller.id,
    })
    .returning();

  const acceptUrl = absoluteAcceptUrl(req, token);

  if (deliveryMethod === "email") {
    logger.info(
      { email, role, deliveryMethod, acceptUrl },
      "Team invitation email queued (logger sender)",
    );
  }

  logger.info(
    { invitationId: created.id, email, role, deliveryMethod, callerId: caller.id },
    "Team invitation created",
  );

  const { orgsById, usersById } = await loadDecorations([created]);
  res.status(201).json({
    invitation: await toDto(created, {
      includeAcceptUrl: acceptUrl,
      orgName: created.organizationId
        ? orgsById.get(created.organizationId) ?? null
        : null,
      createdByUsername: created.createdByUserId
        ? usersById.get(created.createdByUserId) ?? null
        : null,
    }),
  });
});

router.post(
  "/team/invitations/:id/resend",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = String(req.params.id ?? "");
    const [existing] = await db
      .select()
      .from(teamInvitationsTable)
      .where(eq(teamInvitationsTable.id, id))
      .limit(1);
    if (!existing || existing.status !== "pending") {
      res.status(404).json({ error: "Invitation not found." });
      return;
    }
    const activeOrgId = req.session?.activeOrgId ?? null;
    if (!callerCanAccess(existing, req.user!, activeOrgId)) {
      res.status(404).json({ error: "Invitation not found." });
      return;
    }
    const token = newToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const [updated] = await db
      .update(teamInvitationsTable)
      .set({ token, expiresAt, updatedAt: new Date() })
      .where(eq(teamInvitationsTable.id, id))
      .returning();
    const acceptUrl = absoluteAcceptUrl(req, token);
    if (updated.deliveryMethod === "email") {
      logger.info(
        { email: updated.email, acceptUrl },
        "Team invitation email re-queued (logger sender)",
      );
    }
    const { orgsById, usersById } = await loadDecorations([updated]);
    res.json({
      invitation: await toDto(updated, {
        includeAcceptUrl: acceptUrl,
        orgName: updated.organizationId
          ? orgsById.get(updated.organizationId) ?? null
          : null,
        createdByUsername: updated.createdByUserId
          ? usersById.get(updated.createdByUserId) ?? null
          : null,
      }),
    });
  },
);

router.delete(
  "/team/invitations/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = String(req.params.id ?? "");
    const [existing] = await db
      .select()
      .from(teamInvitationsTable)
      .where(eq(teamInvitationsTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Invitation not found." });
      return;
    }
    const activeOrgId = req.session?.activeOrgId ?? null;
    if (!callerCanAccess(existing, req.user!, activeOrgId)) {
      res.status(404).json({ error: "Invitation not found." });
      return;
    }
    if (existing.status === "pending") {
      await db
        .update(teamInvitationsTable)
        .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(teamInvitationsTable.id, id));
    }
    logger.info(
      { invitationId: id, email: existing.email, callerId: req.user!.id },
      "Team invitation revoked",
    );
    res.status(204).end();
  },
);

router.post("/team/access-requests", async (req, res): Promise<void> => {
  const parsed = CreateTeamAccessRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const caller = req.user;
  // Emit a structured warn-level line so the existing log-based
  // admin alerting pipeline (the same one SSO denials hook into when
  // SMTP isn't configured) picks it up and notifies admins. When SMTP
  // *is* configured a future task will swap in a real nodemailer
  // delivery; this log line is the durable contract.
  logger.warn(
    {
      event: "team_access_request",
      requesterId: caller?.id ?? null,
      requesterUsername: caller?.username ?? null,
      requesterEmail: caller?.email ?? null,
      requestedRole: parsed.data.requestedRole,
      reason: parsed.data.reason ?? null,
      activeOrgId: req.session?.activeOrgId ?? null,
    },
    "Team access request — notify admins",
  );
  res.status(202).json({ ok: true });
});

export default router;
