import http from "node:http";
import { WebSocketServer } from "ws";
import { eq } from "drizzle-orm";
import app from "@/app";
import { logger } from "@/shared/logger";
import { attachSocket } from "@/features/recording/infrastructure/recordingService";
import { attachJmxSocket } from "@/features/jmx/infrastructure/jmxScreencast";
import { attachValidationSocket } from "@/features/validation/infrastructure/replayService";
import { startValidationTraceCleanupSchedule } from "@/features/validation/infrastructure/validationTraceCleanup";
import { startGuestReaperSchedule } from "@/features/guest/infrastructure/guestSessionService";
import { seedUsers } from "@/features/auth/infrastructure/seed";
import { logSsoStartupStatus } from "@/features/auth/infrastructure/oidcConfig";
import {
  isIdpProvisioningEnabled,
  setIdpUserProvisioner,
} from "@/features/users/infrastructure/idpProvisioner";
import {
  NexusIdpUserProvisioner,
  getNexusIdpConfig,
  getMissingNexusIdpEnvVars,
} from "@/features/users/infrastructure/nexusIdpProvisioner";
import { resolveApiKeyForOrg } from "@/features/nexus-config/infrastructure/nexusOrgConfigService";
import { buildSessionMiddleware } from "@/shared/middlewares/session";
import { db, validationRunsTable, usersTable } from "@workspace/db";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import { getCurrentSessionOwner } from "@/features/recording/infrastructure/recordingService";
import {
  describeAllowedOrigins,
  isOriginAllowed,
} from "@/shared/security/origins";
import { assertEncryptionKeyOnBoot } from "@/features/projects/infrastructure/gitConfigService";
import { assertRepoPatsEncryptionKeyOnBoot } from "@/features/repo-pats/infrastructure/repoPatService";
import { backfillLegacyOrgKeysOnBoot } from "@/features/ai-agent/infrastructure/aiKeyService";
import { backfillPerOrgRolesOnBoot } from "@/features/auth/infrastructure/perOrgRoleBackfill";
import { assertUserProjectForksEncryptionKeyOnBoot } from "@/features/projects/infrastructure/userProjectForkService";
import { assertAuthStatesEncryptionKeyOnBoot } from "@/features/auth-states/infrastructure/authStateService";
import { setSsoDenialNotificationSender } from "@/features/sso-denials/infrastructure/ssoDenialNotifier";
import {
  createSmtpSender,
  readSmtpConfigFromEnv,
} from "@/features/sso-denials/infrastructure/smtpSender";

const sessionMiddleware = buildSessionMiddleware();

/**
 * Build a response shim for the upgrade path. express-session expects a
 * full ServerResponse — it wraps `res.end` / `res.writeHead` and may call
 * `setHeader` / `getHeader` / `removeHeader` to attach Set-Cookie. On a
 * WS upgrade we have no response to write to, so we install no-op
 * implementations of every method express-session can reach. Because
 * the session is read-only here (we never mutate it), the wrapped `end`
 * is never invoked, so no Set-Cookie is actually emitted — the shim
 * just keeps the middleware from throwing if it touches `res`.
 */
function buildUpgradeResponseShim(): http.ServerResponse {
  const headers: Record<string, string | string[] | number> = {};
  const noop = () => undefined;
  const shim = {
    setHeader: (name: string, value: string | string[] | number) => {
      headers[name.toLowerCase()] = value;
      return shim;
    },
    getHeader: (name: string) => headers[name.toLowerCase()],
    removeHeader: (name: string) => {
      delete headers[name.toLowerCase()];
    },
    hasHeader: (name: string) => name.toLowerCase() in headers,
    getHeaderNames: () => Object.keys(headers),
    getHeaders: () => ({ ...headers }),
    writeHead: () => shim,
    write: () => true,
    end: noop,
    on: () => shim,
    once: () => shim,
    emit: () => false,
    headersSent: false,
    statusCode: 200,
    statusMessage: "OK",
  };
  return shim as unknown as http.ServerResponse;
}

async function resolveSessionUser(
  request: http.IncomingMessage,
): Promise<{ id: string; role: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val: { id: string; role: string } | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    try {
      sessionMiddleware(
        request as unknown as Parameters<typeof sessionMiddleware>[0],
        buildUpgradeResponseShim() as unknown as Parameters<
          typeof sessionMiddleware
        >[1],
        async (err) => {
          if (err) return done(null);
          try {
            const sessionUserId = (
              request as unknown as { session?: { userId?: string } }
            ).session?.userId;
            if (!sessionUserId) return done(null);
            const [u] = await db
              .select({ id: usersTable.id, role: usersTable.role })
              .from(usersTable)
              .where(eq(usersTable.id, sessionUserId))
              .limit(1);
            done(u ? { id: u.id, role: u.role } : null);
          } catch (lookupErr) {
            logger.error({ err: lookupErr }, "ws session user lookup failed");
            done(null);
          }
        },
      );
    } catch (err) {
      logger.error({ err }, "ws session middleware threw");
      done(null);
    }
  });
}

/**
 * The validation WS streams sensitive replay output (steps, logs,
 * URLs). Be conservative: only the user who triggered the run, or a
 * full admin (whose route middleware also already permits everything),
 * can attach. limited_admin needs an assignment re-check to be safe and
 * we don't have one here on the upgrade path, so they only get to
 * stream their own runs. Admins viewing other users' runs can still
 * use the REST endpoints.
 */
async function isAuthorizedForValidationRun(
  request: http.IncomingMessage,
  runId: string,
): Promise<boolean> {
  const user = await resolveSessionUser(request);
  if (!user) return false;
  const [row] = await db
    .select({
      projectName: validationRunsTable.projectName,
      triggeredByUserId: validationRunsTable.triggeredByUserId,
    })
    .from(validationRunsTable)
    .where(eq(validationRunsTable.id, runId))
    .limit(1);
  if (!row) return false;
  if (row.triggeredByUserId === user.id) return true;
  if (user.role !== "admin") return false;
  // Admins can stream any run that targets a project they currently
  // have loaded — same shape of check the HTTP route uses.
  const project = getCurrentProject(user.id);
  return Boolean(project && project.solutionName === row.projectName);
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

/** Reject an upgrade with an HTTP status line, then close the socket. */
function denyUpgrade(
  socket: import("node:stream").Duplex,
  status: 401 | 403 | 400,
  reason: string,
): void {
  const text =
    status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Bad Request";
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
  logger.warn({ status, reason }, "ws upgrade denied");
}

server.on("upgrade", (request, socket, head) => {
  const url = request.url ?? "";

  // H-1: WebSockets are not covered by the same-origin policy — the
  // browser attaches cookies and lets the connection proceed, so it is
  // the server's job to check `Origin`. Without this, a page the victim
  // visits can open an authenticated socket and read the stream
  // (cross-site WebSocket hijacking). Applies to every route below.
  if (!isOriginAllowed(request.headers.origin, request.headers.host)) {
    denyUpgrade(socket, 403, "origin not allowed");
    return;
  }

  if (url.startsWith("/ws/recording")) {
    // C-2: this branch used to attach with no authentication at all,
    // while its two siblings below authenticated properly. Anyone who
    // could reach the port received the live recording feed — recorded
    // selectors and the literal values typed into the target app,
    // including credentials — and could send the 22 inbound control
    // messages, which drive a server-side Chromium (`page.goto` is an
    // SSRF primitive) and mutate the recording that gets written to
    // project files.
    //
    // The session is a process-wide singleton, so "authenticated" is
    // not enough: we also require the caller to be the session's owner.
    resolveSessionUser(request)
      .then((user) => {
        if (!user) {
          denyUpgrade(socket, 401, "recording ws: no session");
          return;
        }
        const owner = getCurrentSessionOwner();
        if (!owner) {
          denyUpgrade(socket, 403, "recording ws: no active session");
          return;
        }
        if (owner.userId !== user.id) {
          // 403 rather than 404: the caller is authenticated, and the
          // existence of *a* recording is not sensitive — whose it is,
          // and its contents, are.
          denyUpgrade(socket, 403, "recording ws: not the session owner");
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          attachSocket(ws, user.id);
        });
      })
      .catch((err) => {
        logger.error({ err }, "recording ws auth failed");
        socket.destroy();
      });
  } else if (url.startsWith("/ws/jmx-recording")) {
    // Auth: must be a logged-in user, and the sessionId in the query
    // must be a JMX session they own. We re-check ownership inside
    // `attachJmxSocket` against the registered user — here we just
    // make sure no anonymous attach can reach an active JMX page.
    resolveSessionUser(request)
      .then((user) => {
        if (!user) {
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n",
          );
          socket.destroy();
          return;
        }
        const qs = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
        const params = new URLSearchParams(qs);
        const sessionId = params.get("sessionId") ?? "";
        if (!sessionId) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          attachJmxSocket(sessionId, ws, user.id);
        });
      })
      .catch((err) => {
        logger.error({ err }, "jmx ws auth failed");
        socket.destroy();
      });
  } else if (url.startsWith("/ws/validation/")) {
    const runId = url.slice("/ws/validation/".length).split("?")[0] ?? "";
    if (!runId) {
      socket.destroy();
      return;
    }
    // Authenticate + authorize before completing the upgrade so an
    // attacker who guesses a runId can't tap into the live event
    // stream of a validation they don't own.
    isAuthorizedForValidationRun(request, runId)
      .then((ok) => {
        if (!ok) {
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n",
          );
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          attachValidationSocket(ws, runId);
        });
      })
      .catch((err) => {
        logger.error({ err }, "validation ws auth failed");
        socket.destroy();
      });
  } else {
    socket.destroy();
  }
});

await assertEncryptionKeyOnBoot().catch((err) => {
  logger.fatal(
    { err },
    "PROJECT_SECRETS_KEY check failed at boot — refusing to start. Set the correct key and restart.",
  );
  process.exit(1);
});

await assertRepoPatsEncryptionKeyOnBoot().catch((err) => {
  logger.fatal(
    { err },
    "PROJECT_SECRETS_KEY check failed for repo_pats at boot — refusing to start. Set the correct key and restart.",
  );
  process.exit(1);
});

await assertUserProjectForksEncryptionKeyOnBoot().catch((err) => {
  logger.fatal(
    { err },
    "PROJECT_SECRETS_KEY check failed for user_project_forks at boot — refusing to start. Set the correct key and restart.",
  );
  process.exit(1);
});

// H-2: captured Playwright auth states are now encrypted at rest too.
// Reports rather than exits: an unreadable auth state costs the user a
// re-capture, which is not worth taking the deployment down for (unlike
// an unreadable PAT, which breaks Git integration outright).
await assertAuthStatesEncryptionKeyOnBoot().catch((err) => {
  logger.warn({ err }, "auth-state encryption check failed at boot");
});

// One-shot migration: copy the legacy single-key columns on
// `ai_agent_org_configs` into `ai_agent_keys` (as the org default).
// Idempotent and best-effort — failures are logged but do not block
// boot, so a half-migrated state can still serve traffic.
await backfillLegacyOrgKeysOnBoot().catch((err) => {
  logger.warn(
    { err },
    "AI key library backfill failed at boot — continuing without it",
  );
});

// Per-org roles foundation (task #35). Idempotent best-effort pass:
// fills in `user_organizations.role` for legacy rows still sitting at
// the post-migration default, mapping from `idp_role` when available
// or falling back to `users.role`. Failures log and continue so a
// half-migrated state can still serve traffic.
await backfillPerOrgRolesOnBoot().catch((err) => {
  logger.warn(
    { err },
    "Per-org role backfill failed at boot — continuing without it",
  );
});

// Install the SMTP-backed admin notifier for SSO denials when the
// minimum SMTP env vars are set; otherwise the default sender keeps
// emitting structured log lines so denials remain visible to ops.
const smtpConfig = readSmtpConfigFromEnv();
if (smtpConfig) {
  try {
    setSsoDenialNotificationSender(createSmtpSender(smtpConfig));
    logger.info(
      { host: smtpConfig.host, port: smtpConfig.port, from: smtpConfig.from },
      "SSO denial notifier: SMTP sender installed",
    );
  } catch (err) {
    logger.warn(
      { err },
      "SSO denial notifier: failed to install SMTP sender — falling back to log-only delivery",
    );
  }
} else {
  logger.info(
    "SSO denial notifier: SMTP env vars not set — using log-only delivery (set SMTP_HOST and SMTP_FROM to enable email)",
  );
}

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  logSsoStartupStatus();
  // Make the cross-origin policy visible at boot: a misconfigured
  // allow-list is otherwise only discovered as a broken browser client.
  logger.info(describeAllowedOrigins());
  // Boot warning parity with the IDP provisioner: when Nexus isn't
  // configured the `POST /api/auth/password-reset` route will respond
  // with 503 instead of triggering a reset email. Log once at startup
  // so operators see why the new Profile → Password tab won't work.
  if (!process.env.NEXUS_API_BASE_URL?.trim() && !process.env.NEXUS_FORGOT_PASSWORD_URL?.trim()) {
    logger.warn(
      "Password reset (POST /api/auth/password-reset) is not configured: " +
        "NEXUS_API_BASE_URL is not set. The Profile → Password tab will " +
        "return HTTP 503 until it (or NEXUS_FORGOT_PASSWORD_URL) is set.",
    );
  }
  // Wire the Nexus IDP adapter when IDP provisioning is enabled and
  // every required Nexus env var is present. Otherwise leave the stub
  // installed and log a single warning so operators see why the
  // "Provision in identity provider" toggle is inert.
  // E2E support (dev-only): when `IDP_E2E_FAKE=1`, install a fake
  // IDP provisioner that always succeeds without contacting Nexus.
  // Lets Playwright exercise the `POST /api/users/invite` success path
  // end-to-end (after `?sso=1` dev-login + `?org=…` selection) without
  // standing up a real Nexus deployment. Gated on `APP_ENVIRONMENT in
  // {local, development}` so a production accidentally toggling the
  // flag does not silently mint Nexus-shaped responses for real users.
  const appEnv = (process.env.APP_ENVIRONMENT ?? "").toLowerCase();
  const fakeIdpFlag = process.env.IDP_E2E_FAKE?.trim().toLowerCase();
  if (
    (appEnv === "local" || appEnv === "development") &&
    (fakeIdpFlag === "1" || fakeIdpFlag === "true" || fakeIdpFlag === "yes")
  ) {
    setIdpUserProvisioner({
      async createUser(input) {
        return {
          externalId: `e2e-fake-${Date.now()}`,
          email: input.email.toLowerCase(),
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
        };
      },
      async inviteUser(input) {
        return {
          email: input.email.toLowerCase(),
          invitationCode: `nvi_e2e_${Date.now()}`,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        };
      },
      async resendWelcome() {
        return {
          message: "fake welcome email resent",
          resendCount: 1,
          lastResentAt: new Date().toISOString(),
        };
      },
      async findUserByEmail() {
        return null;
      },
      async addUserToOrganization() {
        return { alreadyMember: false };
      },
    });
    logger.warn(
      "IDP_E2E_FAKE=1 — fake IDP provisioner installed; /api/users/invite " +
        "will not call Nexus. Do NOT enable in production.",
    );
  } else if (isIdpProvisioningEnabled()) {
    const nexus = getNexusIdpConfig();
    if (nexus) {
      // Per-org Nexus partner keys: resolve the key from
      // `nexus_org_configs` for the calling memento org, falling back
      // to the deployment-wide NEXUS_API_KEY env var when no per-org
      // row exists. The resolver is invoked on every Nexus call.
      setIdpUserProvisioner(
        new NexusIdpUserProvisioner({
          baseUrl: nexus.baseUrl,
          keyResolver: (mementoOrgId) => resolveApiKeyForOrg(mementoOrgId),
        }),
      );
      logger.info(
        { baseUrl: nexus.baseUrl },
        "IDP provisioning enabled; Nexus adapter installed (per-org keys)",
      );
    } else {
      const missing = getMissingNexusIdpEnvVars().join(", ");
      logger.warn(
        { missing },
        "IDP_PROVISIONING_ENABLED is on but the Nexus adapter is not " +
          "wired up because NEXUS_API_BASE_URL is missing. Set it on " +
          "this server, then either configure per-org keys in " +
          "Settings → Admin → Nexus keys or set the NEXUS_API_KEY env " +
          "var as a fallback.",
      );
    }
  }
  seedUsers().catch((err) => {
    logger.error({ err }, "Failed to seed users");
  });
  // Sweep stale validation traces / screenshots on boot, then on a
  // recurring interval. Files older than 7 days are deleted and any
  // matching traceRef columns are nulled out.
  startValidationTraceCleanupSchedule();
  // Hard-delete expired guest trials (workspace directory, browser
  // session rows, and the throwaway user row) on boot and every few
  // minutes thereafter. Also releases their slot against the
  // deployment-wide guest cap.
  startGuestReaperSchedule();
});

