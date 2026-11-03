import { and, eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  userOrganizationsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "@/shared/logger";
import type { SsoDenialGate } from "./ssoDenialTypes";

export interface SsoDenialNotificationInput {
  subject: string;
  email: string | null;
  gate: SsoDenialGate;
  orgKey: string | null;
}

export interface SsoDenialNotificationRecipient {
  email: string;
  displayName: string;
  scope: "org_admin" | "memento_admin";
}

export interface SsoDenialNotificationPayload {
  input: SsoDenialNotificationInput;
  recipients: SsoDenialNotificationRecipient[];
  orgDisplayName: string | null;
  subjectLine: string;
  body: string;
  sentAt: string;
}

export interface SsoDenialNotificationSender {
  (payload: SsoDenialNotificationPayload): Promise<void> | void;
}

const GATE_LABEL: Record<SsoDenialGate, string> = {
  no_memento_user: "Missing memento user claim",
  no_memento_access: "Org not authorized for memento",
  no_org: "No organization on account",
};

const DEFAULT_DEBOUNCE_MS = 60 * 60 * 1000; // 1 hour
const debounceCache = new Map<string, number>();

let sender: SsoDenialNotificationSender = defaultLoggerSender;
let debounceMs = DEFAULT_DEBOUNCE_MS;

/**
 * Default sender: emit a structured `warn` log line so operators who pipe
 * pino output to an email/paging pipeline get a notification with the
 * recipient list, gate, and identity already resolved. Production
 * deployments can override this with `setSsoDenialNotificationSender`
 * to plug in SMTP, a webhook, or any other transport.
 */
function defaultLoggerSender(payload: SsoDenialNotificationPayload): void {
  logger.warn(
    {
      gate: payload.input.gate,
      subject: payload.input.subject,
      email: payload.input.email,
      orgKey: payload.input.orgKey,
      orgDisplayName: payload.orgDisplayName,
      recipientCount: payload.recipients.length,
      recipients: payload.recipients.map((r) => ({
        email: r.email,
        scope: r.scope,
      })),
      subjectLine: payload.subjectLine,
    },
    "SSO denial notification",
  );
}

/** Test/runtime hook to replace the default sender (e.g. with an SMTP adapter). */
export function setSsoDenialNotificationSender(
  next: SsoDenialNotificationSender | null,
): void {
  sender = next ?? defaultLoggerSender;
}

/** Test hook so suites can collapse the 1-hour debounce window. */
export function setSsoDenialNotificationDebounceMs(ms: number): void {
  debounceMs = ms;
}

/** Test hook to reset the in-process debounce cache between cases. */
export function resetSsoDenialNotificationDebounceCache(): void {
  debounceCache.clear();
}

/**
 * Whether the in-process notifier is enabled. Defaults to ON so the
 * feature is visible out of the box; set
 * `SSO_DENIAL_NOTIFICATIONS_ENABLED=0` (or `false`) to silence it
 * without removing the wiring.
 */
export function isSsoDenialNotificationsEnabled(): boolean {
  const raw = (process.env.SSO_DENIAL_NOTIFICATIONS_ENABLED ?? "1").trim();
  if (!raw) return true;
  return raw !== "0" && raw.toLowerCase() !== "false" && raw.toLowerCase() !== "off";
}

/**
 * Look up admin recipients for a denial. When `orgKey` is set we email
 * admins of that bound org (matching the IDP `externalKey`); when it
 * isn't, or when the bound org has no admins with an email on file, we
 * fall back to Memento Admins so the denial isn't dropped on the floor.
 */
export async function resolveSsoDenialRecipients(
  input: Pick<SsoDenialNotificationInput, "orgKey">,
): Promise<{
  recipients: SsoDenialNotificationRecipient[];
  orgDisplayName: string | null;
}> {
  let orgDisplayName: string | null = null;
  const seen = new Set<string>();
  const recipients: SsoDenialNotificationRecipient[] = [];

  if (input.orgKey) {
    const [orgRow] = await db
      .select({
        id: organizationsTable.id,
        displayName: organizationsTable.displayName,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.externalKey, input.orgKey))
      .limit(1);
    if (orgRow) {
      orgDisplayName = orgRow.displayName;
      const orgAdmins = await db
        .select({
          email: usersTable.email,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
          username: usersTable.username,
        })
        .from(usersTable)
        .innerJoin(
          userOrganizationsTable,
          eq(userOrganizationsTable.userId, usersTable.id),
        )
        .where(
          and(
            eq(userOrganizationsTable.organizationId, orgRow.id),
            eq(usersTable.role, "admin"),
          ),
        )
        .orderBy(usersTable.username);
      for (const r of orgAdmins) {
        const email = (r.email ?? "").trim();
        if (!email) continue;
        const key = email.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        recipients.push({
          email,
          displayName: renderName(r),
          scope: "org_admin",
        });
      }
    }
  }

  if (recipients.length === 0) {
    const mementoAdmins = await db
      .select({
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        username: usersTable.username,
      })
      .from(usersTable)
      .where(eq(usersTable.role, "memento_admin"))
      .orderBy(usersTable.username);
    for (const r of mementoAdmins) {
      const email = (r.email ?? "").trim();
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({
        email,
        displayName: renderName(r),
        scope: "memento_admin",
      });
    }
  }

  return { recipients, orgDisplayName };
}

function renderName(r: {
  firstName: string | null;
  lastName: string | null;
  username: string;
}): string {
  const name = [r.firstName ?? "", r.lastName ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
  return name || r.username;
}

function buildSubjectLine(input: SsoDenialNotificationInput): string {
  const who = input.email ?? input.subject;
  return `[memento] SSO sign-in blocked for ${who}`;
}

function buildBody(
  input: SsoDenialNotificationInput,
  orgDisplayName: string | null,
): string {
  const lines = [
    `An SSO sign-in was just blocked by memento's claim gates.`,
    ``,
    `User: ${input.email ?? "(no email on the token)"}`,
    `IDP subject: ${input.subject}`,
    `Gate: ${GATE_LABEL[input.gate]}`,
  ];
  if (input.orgKey) {
    lines.push(
      `Organization: ${orgDisplayName ?? input.orgKey} (${input.orgKey})`,
    );
  }
  lines.push(
    ``,
    `Review and grant access from Admin → Source control → SSO denials,`,
    `then update the user's claims in your identity provider.`,
  );
  return lines.join("\n");
}

/**
 * Send a notification for a freshly recorded denial. Best-effort:
 * failures are logged and swallowed so they never block the SSO
 * callback. Skips when the feature is disabled via env var or when the
 * (subject + gate) pair has already triggered a notification within
 * the debounce window — that prevents a single user retrying ten
 * times from paging every admin ten times.
 */
export async function notifyAdminsOfSsoDenial(
  input: SsoDenialNotificationInput,
): Promise<{ delivered: boolean; reason?: string }> {
  if (!isSsoDenialNotificationsEnabled()) {
    return { delivered: false, reason: "disabled" };
  }
  const debounceKey = `${input.subject}::${input.gate}`;
  const now = Date.now();
  const last = debounceCache.get(debounceKey);
  if (last !== undefined && now - last < debounceMs) {
    return { delivered: false, reason: "debounced" };
  }
  // Mark BEFORE the async work so concurrent denials in the same tick
  // can't both slip past the gate.
  debounceCache.set(debounceKey, now);
  // Lazy GC so the map doesn't grow without bound on a long-lived process.
  if (debounceCache.size > 1000) {
    for (const [k, t] of debounceCache) {
      if (now - t >= debounceMs) debounceCache.delete(k);
    }
  }

  try {
    const { recipients, orgDisplayName } = await resolveSsoDenialRecipients(
      input,
    );
    if (recipients.length === 0) {
      logger.warn(
        { gate: input.gate, subject: input.subject, orgKey: input.orgKey },
        "SSO denial notification skipped: no admin recipients found",
      );
      return { delivered: false, reason: "no_recipients" };
    }
    const payload: SsoDenialNotificationPayload = {
      input,
      recipients,
      orgDisplayName,
      subjectLine: buildSubjectLine(input),
      body: buildBody(input, orgDisplayName),
      sentAt: new Date(now).toISOString(),
    };
    await sender(payload);
    return { delivered: true };
  } catch (err) {
    logger.warn(
      { err, gate: input.gate, subject: input.subject },
      "SSO denial notification failed",
    );
    return { delivered: false, reason: "error" };
  }
}
