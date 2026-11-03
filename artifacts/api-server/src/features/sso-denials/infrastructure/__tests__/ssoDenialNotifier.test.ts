import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  userOrganizationsTable,
} from "@workspace/db";
import { deleteUserByUsername, provisionUser } from "@/shared/test-helpers";
import {
  isSsoDenialNotificationsEnabled,
  notifyAdminsOfSsoDenial,
  resetSsoDenialNotificationDebounceCache,
  resolveSsoDenialRecipients,
  setSsoDenialNotificationDebounceMs,
  setSsoDenialNotificationSender,
  type SsoDenialNotificationPayload,
} from "@/features/sso-denials/infrastructure/ssoDenialNotifier";

const ORG_KEY = "vitest-ssodenial-org";
const ORG_ADMIN_USERNAME = "vitest-ssodenial-orgadmin";
const ORG_ADMIN_NOEMAIL_USERNAME = "vitest-ssodenial-orgadmin-noemail";
const MEMENTO_ADMIN_USERNAME = "vitest-ssodenial-mementoadmin";

let orgId = "";
let orgAdminUserId = "";

async function purgeOrg(): Promise<void> {
  const rows = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(eq(organizationsTable.externalKey, ORG_KEY));
  for (const r of rows) {
    await db
      .delete(userOrganizationsTable)
      .where(eq(userOrganizationsTable.organizationId, r.id));
    await db.delete(organizationsTable).where(eq(organizationsTable.id, r.id));
  }
}

beforeAll(async () => {
  await purgeOrg();
  const orgAdmin = await provisionUser({
    username: ORG_ADMIN_USERNAME,
    role: "admin",
    firstName: "Ora",
    lastName: "Admin",
    email: "ora.admin@example.com",
  });
  orgAdminUserId = orgAdmin.id;
  await provisionUser({
    username: ORG_ADMIN_NOEMAIL_USERNAME,
    role: "admin",
    // No email — should be filtered out.
  });
  await provisionUser({
    username: MEMENTO_ADMIN_USERNAME,
    role: "memento_admin",
    firstName: "Memo",
    lastName: "Admin",
    email: "memo.admin@example.com",
  });
  const [org] = await db
    .insert(organizationsTable)
    .values({ externalKey: ORG_KEY, displayName: "Vitest Org" })
    .returning();
  orgId = org!.id;
  await db.insert(userOrganizationsTable).values({
    userId: orgAdminUserId,
    organizationId: orgId,
  });
});

afterAll(async () => {
  await purgeOrg();
  await deleteUserByUsername(ORG_ADMIN_USERNAME);
  await deleteUserByUsername(ORG_ADMIN_NOEMAIL_USERNAME);
  await deleteUserByUsername(MEMENTO_ADMIN_USERNAME);
});

beforeEach(() => {
  resetSsoDenialNotificationDebounceCache();
  setSsoDenialNotificationDebounceMs(60 * 60 * 1000);
  setSsoDenialNotificationSender(null);
  delete process.env.SSO_DENIAL_NOTIFICATIONS_ENABLED;
});

describe("resolveSsoDenialRecipients", () => {
  it("returns admins of the bound org when orgKey is set", async () => {
    const { recipients, orgDisplayName } = await resolveSsoDenialRecipients({
      orgKey: ORG_KEY,
    });
    expect(orgDisplayName).toBe("Vitest Org");
    expect(recipients.map((r) => r.email)).toEqual(["ora.admin@example.com"]);
    expect(recipients[0]!.scope).toBe("org_admin");
    expect(recipients[0]!.displayName).toBe("Ora Admin");
  });

  it("falls back to memento admins when orgKey is missing", async () => {
    const { recipients, orgDisplayName } = await resolveSsoDenialRecipients({
      orgKey: null,
    });
    expect(orgDisplayName).toBeNull();
    const ours = recipients.find((r) => r.email === "memo.admin@example.com");
    expect(ours).toBeDefined();
    expect(ours!.scope).toBe("memento_admin");
  });

  it("falls back to memento admins when the bound org has no admin emails", async () => {
    const { recipients } = await resolveSsoDenialRecipients({
      orgKey: "vitest-ssodenial-unknown-org",
    });
    const ours = recipients.find((r) => r.email === "memo.admin@example.com");
    expect(ours).toBeDefined();
    expect(ours!.scope).toBe("memento_admin");
  });
});

describe("notifyAdminsOfSsoDenial", () => {
  it("invokes the sender with a built subject + body and the resolved recipients", async () => {
    const captured: SsoDenialNotificationPayload[] = [];
    setSsoDenialNotificationSender((p) => {
      captured.push(p);
    });

    const result = await notifyAdminsOfSsoDenial({
      subject: "sub-001",
      email: "denied@example.com",
      gate: "no_memento_access",
      orgKey: ORG_KEY,
    });

    expect(result.delivered).toBe(true);
    expect(captured).toHaveLength(1);
    const p = captured[0]!;
    expect(p.subjectLine).toBe(
      "[memento] SSO sign-in blocked for denied@example.com",
    );
    expect(p.recipients.map((r) => r.email)).toEqual(["ora.admin@example.com"]);
    expect(p.body).toContain("denied@example.com");
    expect(p.body).toContain("sub-001");
    expect(p.body).toContain("Org not authorized for memento");
    expect(p.body).toContain("Vitest Org");
  });

  it("debounces repeats of the same (subject, gate) inside the window", async () => {
    let calls = 0;
    setSsoDenialNotificationSender(() => {
      calls += 1;
    });
    const input = {
      subject: "sub-debounce",
      email: "d@example.com",
      gate: "no_memento_user" as const,
      orgKey: ORG_KEY,
    };
    const a = await notifyAdminsOfSsoDenial(input);
    const b = await notifyAdminsOfSsoDenial(input);
    expect(a).toEqual({ delivered: true });
    expect(b.delivered).toBe(false);
    expect(b.reason).toBe("debounced");
    expect(calls).toBe(1);
  });

  it("does not debounce a different gate for the same subject", async () => {
    let calls = 0;
    setSsoDenialNotificationSender(() => {
      calls += 1;
    });
    await notifyAdminsOfSsoDenial({
      subject: "sub-multigate",
      email: null,
      gate: "no_memento_user",
      orgKey: null,
    });
    const second = await notifyAdminsOfSsoDenial({
      subject: "sub-multigate",
      email: null,
      gate: "no_memento_access",
      orgKey: ORG_KEY,
    });
    expect(second.delivered).toBe(true);
    expect(calls).toBe(2);
  });

  it("re-sends after the debounce window expires", async () => {
    setSsoDenialNotificationDebounceMs(0);
    let calls = 0;
    setSsoDenialNotificationSender(() => {
      calls += 1;
    });
    const input = {
      subject: "sub-window",
      email: null,
      gate: "no_org" as const,
      orgKey: null,
    };
    await notifyAdminsOfSsoDenial(input);
    await notifyAdminsOfSsoDenial(input);
    expect(calls).toBe(2);
  });

  it("skips delivery when the env-var toggle is off", async () => {
    let calls = 0;
    setSsoDenialNotificationSender(() => {
      calls += 1;
    });
    process.env.SSO_DENIAL_NOTIFICATIONS_ENABLED = "0";
    expect(isSsoDenialNotificationsEnabled()).toBe(false);
    const result = await notifyAdminsOfSsoDenial({
      subject: "sub-disabled",
      email: null,
      gate: "no_memento_user",
      orgKey: ORG_KEY,
    });
    expect(result).toEqual({ delivered: false, reason: "disabled" });
    expect(calls).toBe(0);
  });

  it("treats the env var as on by default and accepts 'false'/'off' as off", async () => {
    expect(isSsoDenialNotificationsEnabled()).toBe(true);
    process.env.SSO_DENIAL_NOTIFICATIONS_ENABLED = "false";
    expect(isSsoDenialNotificationsEnabled()).toBe(false);
    process.env.SSO_DENIAL_NOTIFICATIONS_ENABLED = "OFF";
    expect(isSsoDenialNotificationsEnabled()).toBe(false);
    process.env.SSO_DENIAL_NOTIFICATIONS_ENABLED = "1";
    expect(isSsoDenialNotificationsEnabled()).toBe(true);
  });

  it("renders the body with '(no email on the token)' when the IDP didn't supply one", async () => {
    const captured: SsoDenialNotificationPayload[] = [];
    setSsoDenialNotificationSender((p) => {
      captured.push(p);
    });
    await notifyAdminsOfSsoDenial({
      subject: "sub-no-email",
      email: null,
      gate: "no_memento_user",
      orgKey: ORG_KEY,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.body).toContain("(no email on the token)");
    expect(captured[0]!.subjectLine).toBe(
      "[memento] SSO sign-in blocked for sub-no-email",
    );
  });
});
