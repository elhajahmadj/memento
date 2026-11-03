import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { eq } from "drizzle-orm";
import { db, ssoDenialsTable } from "@workspace/db";
import { deleteUserByUsername, provisionUser } from "@/shared/test-helpers";
import { recordSsoDenial } from "@/features/sso-denials/infrastructure/ssoDenialService";
import {
  resetSsoDenialNotificationDebounceCache,
  setSsoDenialNotificationSender,
  type SsoDenialNotificationPayload,
} from "@/features/sso-denials/infrastructure/ssoDenialNotifier";

const MEMENTO_ADMIN_USERNAME = "vitest-ssodenial-svc-mementoadmin";
const SUBJECT = "vitest-svc-sub-001";

beforeAll(async () => {
  await provisionUser({
    username: MEMENTO_ADMIN_USERNAME,
    role: "memento_admin",
    email: "svc.memo@example.com",
  });
});

afterAll(async () => {
  await db
    .delete(ssoDenialsTable)
    .where(eq(ssoDenialsTable.subject, SUBJECT));
  await deleteUserByUsername(MEMENTO_ADMIN_USERNAME);
});

beforeEach(async () => {
  resetSsoDenialNotificationDebounceCache();
  setSsoDenialNotificationSender(null);
  await db
    .delete(ssoDenialsTable)
    .where(eq(ssoDenialsTable.subject, SUBJECT));
});

describe("recordSsoDenial -> notifier integration", () => {
  it("dispatches a notification after a denial row is written", async () => {
    const captured: SsoDenialNotificationPayload[] = [];
    setSsoDenialNotificationSender(async (p) => {
      captured.push(p);
    });

    await recordSsoDenial({
      subject: SUBJECT,
      email: "denied@example.com",
      gate: "no_org",
      orgKey: null,
    });

    // The notifier is fire-and-forget so the row insert and the
    // sender invocation race. Poll briefly for the sender to fire.
    for (let i = 0; i < 50 && captured.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(captured).toHaveLength(1);
    expect(captured[0]!.input.subject).toBe(SUBJECT);
    expect(captured[0]!.recipients.some((r) => r.email === "svc.memo@example.com")).toBe(true);

    const rows = await db
      .select()
      .from(ssoDenialsTable)
      .where(eq(ssoDenialsTable.subject, SUBJECT));
    expect(rows).toHaveLength(1);
  });
});
