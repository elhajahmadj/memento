/**
 * Specs for `/api/users/me/preferences` (GET + PUT).
 *
 * Covers:
 *  - unauthenticated → 401 on both methods
 *  - signed-in fresh user → GET returns the default `top` layout
 *  - PUT happy path → updates only the caller's row, response echoes
 *    the new value, subsequent GET returns the persisted value
 *  - PUT with an unknown layout value → 400
 *  - a second user's row is not modified by another user's PUT
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";

let baseUrl: string;
let close: () => Promise<void>;

const USER_A = "vitest-prefs-userA";
const USER_B = "vitest-prefs-userB";
let cookieA: string;
let _cookieB: string;
let userAId: string;
let userBId: string;

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const a = await provisionUser({ username: USER_A, role: "limited" });
  const b = await provisionUser({ username: USER_B, role: "limited" });
  userAId = a.id;
  userBId = b.id;
  cookieA = await login(baseUrl, USER_A);
  _cookieB = await login(baseUrl, USER_B);
  void _cookieB;
});

afterAll(async () => {
  await deleteUserByUsername(USER_A);
  await deleteUserByUsername(USER_B);
  await close();
});

beforeEach(async () => {
  // Reset both users back to the schema default before each test so the
  // order tests run in does not matter.
  await db
    .update(usersTable)
    .set({ navLayout: "top" })
    .where(eq(usersTable.id, userAId));
  await db
    .update(usersTable)
    .set({ navLayout: "top" })
    .where(eq(usersTable.id, userBId));
});

describe("GET /api/users/me/preferences", () => {
  it("returns 401 when the caller is not signed in", async () => {
    const res = await fetch(`${baseUrl}/api/users/me/preferences`);
    expect(res.status).toBe(401);
  });

  it("returns the default 'top' nav layout for a fresh user", async () => {
    const res = await fetch(`${baseUrl}/api/users/me/preferences`, {
      headers: withCookie(cookieA),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { navLayout: string };
    expect(body).toEqual({ navLayout: "top" });
  });

  it("returns the persisted value after a PUT", async () => {
    const put = await fetch(`${baseUrl}/api/users/me/preferences`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({ navLayout: "side" }),
    });
    expect(put.status).toBe(200);
    const get = await fetch(`${baseUrl}/api/users/me/preferences`, {
      headers: withCookie(cookieA),
    });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ navLayout: "side" });
  });
});

describe("PUT /api/users/me/preferences", () => {
  it("returns 401 when the caller is not signed in", async () => {
    const res = await fetch(`${baseUrl}/api/users/me/preferences`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ navLayout: "side" }),
    });
    expect(res.status).toBe(401);
  });

  it("updates the caller's row and echoes the new value", async () => {
    const res = await fetch(`${baseUrl}/api/users/me/preferences`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({ navLayout: "side" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ navLayout: "side" });

    const [row] = await db
      .select({ navLayout: usersTable.navLayout })
      .from(usersTable)
      .where(eq(usersTable.id, userAId))
      .limit(1);
    expect(row?.navLayout).toBe("side");
  });

  it("does not touch any other user's row", async () => {
    const res = await fetch(`${baseUrl}/api/users/me/preferences`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({ navLayout: "side" }),
    });
    expect(res.status).toBe(200);

    const [other] = await db
      .select({ navLayout: usersTable.navLayout })
      .from(usersTable)
      .where(eq(usersTable.id, userBId))
      .limit(1);
    expect(other?.navLayout).toBe("top");
  });

  it("returns 400 for an unknown layout value", async () => {
    const res = await fetch(`${baseUrl}/api/users/me/preferences`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({ navLayout: "diagonal" }),
    });
    expect(res.status).toBe(400);
    // The caller's stored value must NOT have changed.
    const [row] = await db
      .select({ navLayout: usersTable.navLayout })
      .from(usersTable)
      .where(eq(usersTable.id, userAId))
      .limit(1);
    expect(row?.navLayout).toBe("top");
  });

  it("returns 400 when the navLayout field is missing entirely", async () => {
    const res = await fetch(`${baseUrl}/api/users/me/preferences`, {
      method: "PUT",
      headers: withCookie(cookieA, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
