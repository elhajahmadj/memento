import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { eq } from "drizzle-orm";
import { db, auditEventsTable } from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedCookie: string;
const ADMIN_USERNAME = "vitest-audit-admin";
const LIMITED_USERNAME = "vitest-audit-limited";
const PROJECT_NAME = "vitest-audit-proj";
let adminUserId = "";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  await provisionUser({ username: LIMITED_USERNAME, role: "limited" });
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
});

afterAll(async () => {
  // Removing the user cascades the audit row(s) we wrote during the suite.
  await db.delete(auditEventsTable).where(eq(auditEventsTable.project, PROJECT_NAME));
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await close();
});

afterEach(async () => {
  // Belt-and-braces cleanup so the count doesn't drift across tests.
  await db.delete(auditEventsTable).where(eq(auditEventsTable.project, PROJECT_NAME));
});

describe("GET /api/audit", () => {
  it("returns events to an admin and includes a row we just wrote", async () => {
    await recordAudit({
      user: { id: adminUserId },
      project: PROJECT_NAME,
      action: "file_save",
      file: "Tests/Foo.cs",
      details: { bytes: 12 },
    });
    const res = await fetch(
      `${baseUrl}/api/audit?project=${encodeURIComponent(PROJECT_NAME)}`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<{ project: string; action: string; filePath: string | null }>;
      page: number;
      pageSize: number;
      total: number;
    };
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    expect(body.events[0]?.project).toBe(PROJECT_NAME);
    expect(body.events[0]?.action).toBe("file_save");
    expect(body.events[0]?.filePath).toBe("Tests/Foo.cs");
    expect(body.page).toBe(1);
    expect(body.pageSize).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("rejects an unknown action filter with 400", async () => {
    const res = await fetch(
      `${baseUrl}/api/audit?action=not_a_real_action`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a limited (non-admin) user with 403", async () => {
    const res = await fetch(`${baseUrl}/api/audit`, {
      headers: withCookie(limitedCookie),
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    const res = await fetch(`${baseUrl}/api/audit`);
    expect(res.status).toBe(401);
  });

  it("returns an empty events list when filtering by an unknown username", async () => {
    const res = await fetch(
      `${baseUrl}/api/audit?user=${encodeURIComponent("does-not-exist-" + Date.now())}`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[]; total: number };
    expect(body.events).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
