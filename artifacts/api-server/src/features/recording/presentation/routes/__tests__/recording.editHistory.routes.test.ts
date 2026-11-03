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

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedAdminCookie: string;
let limitedCookie: string;
let adminUserId = "";

const ADMIN_USERNAME = "vitest-edithist-admin";
const LIMITED_ADMIN_USERNAME = "vitest-edithist-ladmin";
const LIMITED_USERNAME = "vitest-edithist-limited";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  await provisionUser({
    username: LIMITED_ADMIN_USERNAME,
    role: "limited_admin",
  });
  await provisionUser({ username: LIMITED_USERNAME, role: "limited" });
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedAdminCookie = await login(baseUrl, LIMITED_ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
});

afterAll(async () => {
  // Cascade-cleanup of any audit rows the suite happens to write.
  await db
    .delete(auditEventsTable)
    .where(eq(auditEventsTable.userId, adminUserId));
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await close();
});

afterEach(async () => {
  await db
    .delete(auditEventsTable)
    .where(eq(auditEventsTable.userId, adminUserId));
});

describe("GET /api/recording/edit-history", () => {
  it("returns 401 without a session", async () => {
    const res = await fetch(`${baseUrl}/api/recording/edit-history`);
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin (limited) user with 403", async () => {
    const res = await fetch(`${baseUrl}/api/recording/edit-history`, {
      headers: withCookie(limitedCookie),
    });
    expect(res.status).toBe(403);
  });

  it("returns an empty payload to an admin without an active session", async () => {
    const res = await fetch(`${baseUrl}/api/recording/edit-history`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionToken: string | null;
      events: unknown[];
    };
    // Without a live session the route deliberately short-circuits to
    // an empty list / null token instead of leaking another user's
    // history. The HistoryPanel relies on this shape.
    expect(body.sessionToken).toBeNull();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(0);
  });

  it("also returns an empty payload to a limited admin without an active session", async () => {
    // limited_admin is included in `requireAnyAdmin` so the gate must
    // let them through; with no session they get the same empty body.
    const res = await fetch(`${baseUrl}/api/recording/edit-history`, {
      headers: withCookie(limitedAdminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionToken: string | null;
      events: unknown[];
    };
    expect(body.sessionToken).toBeNull();
    expect(body.events).toHaveLength(0);
  });
});
