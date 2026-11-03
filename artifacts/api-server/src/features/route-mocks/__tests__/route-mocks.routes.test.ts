import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, routeMocksTable } from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";

let baseUrl: string;
let close: () => Promise<void>;
let cookie: string;
let otherCookie: string;
let userId: string;

const USERNAME = "vitest-route-mocks-owner";
const OTHER_USERNAME = "vitest-route-mocks-other";
const PROJECT = "RouteMocksTestProj";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const owner = await provisionUser({ username: USERNAME, role: "admin" });
  await provisionUser({ username: OTHER_USERNAME, role: "admin" });
  userId = owner.id;
  cookie = await login(baseUrl, USERNAME);
  otherCookie = await login(baseUrl, OTHER_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(USERNAME);
  await deleteUserByUsername(OTHER_USERNAME);
  await close();
});

afterEach(async () => {
  await db
    .delete(routeMocksTable)
    .where(
      and(
        eq(routeMocksTable.userId, userId),
        eq(routeMocksTable.projectName, PROJECT),
      ),
    );
});

describe("route-mocks CRUD routes", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${baseUrl}/api/route-mocks?projectName=${PROJECT}`);
    expect(res.status).toBe(401);
  });

  it("returns an empty list for a fresh project", async () => {
    const res = await fetch(
      `${baseUrl}/api/route-mocks?projectName=${PROJECT}`,
      { headers: withCookie(cookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mocks: unknown[] };
    expect(body.mocks).toEqual([]);
  });

  it("400s when projectName query parameter is missing", async () => {
    const res = await fetch(`${baseUrl}/api/route-mocks`, {
      headers: withCookie(cookie),
    });
    expect(res.status).toBe(400);
  });

  it("creates, lists, updates, and deletes a mock", async () => {
    const createRes = await fetch(`${baseUrl}/api/route-mocks`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        projectName: PROJECT,
        name: "stub /api/me",
        method: "GET",
        urlPattern: "**/api/users/me",
        status: 200,
        bodyJson: { id: "u1", username: "alice" },
        enabled: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string };
    expect(created.name).toBe("stub /api/me");
    expect(typeof created.id).toBe("string");

    const listRes = await fetch(
      `${baseUrl}/api/route-mocks?projectName=${PROJECT}`,
      { headers: withCookie(cookie) },
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { mocks: { id: string; status: number }[] };
    expect(list.mocks).toHaveLength(1);
    expect(list.mocks[0]!.id).toBe(created.id);
    expect(list.mocks[0]!.status).toBe(200);

    const patchRes = await fetch(`${baseUrl}/api/route-mocks/${created.id}`, {
      method: "PATCH",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({ status: 503, enabled: false }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { status: number; enabled: boolean };
    expect(patched.status).toBe(503);
    expect(patched.enabled).toBe(false);

    const deleteRes = await fetch(`${baseUrl}/api/route-mocks/${created.id}`, {
      method: "DELETE",
      headers: withCookie(cookie),
    });
    expect(deleteRes.status).toBe(204);

    const afterList = await fetch(
      `${baseUrl}/api/route-mocks?projectName=${PROJECT}`,
      { headers: withCookie(cookie) },
    );
    const afterBody = (await afterList.json()) as { mocks: unknown[] };
    expect(afterBody.mocks).toEqual([]);
  });

  it("isolates mocks per user — another user cannot see, update, or delete", async () => {
    const createRes = await fetch(`${baseUrl}/api/route-mocks`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        projectName: PROJECT,
        name: "private",
        method: "GET",
        urlPattern: "**/private",
        status: 200,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const otherList = await fetch(
      `${baseUrl}/api/route-mocks?projectName=${PROJECT}`,
      { headers: withCookie(otherCookie) },
    );
    expect(otherList.status).toBe(200);
    const otherBody = (await otherList.json()) as { mocks: unknown[] };
    expect(otherBody.mocks).toEqual([]);

    const otherPatch = await fetch(`${baseUrl}/api/route-mocks/${created.id}`, {
      method: "PATCH",
      headers: withCookie(otherCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ status: 500 }),
    });
    expect(otherPatch.status).toBe(404);

    const otherDelete = await fetch(`${baseUrl}/api/route-mocks/${created.id}`, {
      method: "DELETE",
      headers: withCookie(otherCookie),
    });
    expect(otherDelete.status).toBe(404);
  });

  it("400s on invalid create payload", async () => {
    const res = await fetch(`${baseUrl}/api/route-mocks`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({ projectName: PROJECT }),
    });
    expect(res.status).toBe(400);
  });

  it("404s when patching a non-existent mock", async () => {
    const res = await fetch(
      `${baseUrl}/api/route-mocks/00000000-0000-0000-0000-000000000000`,
      {
        method: "PATCH",
        headers: withCookie(cookie, { "content-type": "application/json" }),
        body: JSON.stringify({ status: 200 }),
      },
    );
    expect(res.status).toBe(404);
  });
});
