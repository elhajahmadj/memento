import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import app from "@/app";
import { db, usersTable } from "@workspace/db";
import { setAuthProvider } from "@/features/auth/infrastructure/authProvider";
import { hashPassword } from "@/features/auth/infrastructure/passwordHash";

let server: http.Server;
let baseUrl: string;
const LOCAL_USERNAME = "vitest-local-only-user";
const LOCAL_PASSWORD = "Sup3rSecret!";

beforeAll(async () => {
  // Clear any cached provider so getAuthProvider() re-resolves cleanly.
  setAuthProvider(null);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  setAuthProvider(null);
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

afterEach(async () => {
  await db.delete(usersTable).where(eq(usersTable.username, LOCAL_USERNAME));
});

async function login(username: string, password: string): Promise<Response> {
  return await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

async function provisionLocalUser() {
  const passwordHash = await hashPassword(LOCAL_PASSWORD);
  const [created] = await db
    .insert(usersTable)
    .values({
      username: LOCAL_USERNAME,
      passwordHash,
      role: "admin",
      profile: {},
    })
    .returning();
  return created!;
}

describe("POST /api/auth/login", () => {
  it("returns 401 on a wrong password — the local provider only emits ok or invalid_credentials", async () => {
    await provisionLocalUser();
    const wrongPwRes = await login(LOCAL_USERNAME, "wrong-password");
    expect(wrongPwRes.status).toBe(401);
    const missingRes = await login("does-not-exist", "anything");
    expect(missingRes.status).toBe(401);
  });

  it("returns 200 with the user payload on a valid local hash", async () => {
    await provisionLocalUser();
    const res = await login(LOCAL_USERNAME, LOCAL_PASSWORD);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { username: string };
    };
    expect(body.user.username).toBe(LOCAL_USERNAME);
  });

  it("returns 401 on a wrong password", async () => {
    await provisionLocalUser();
    const res = await login(LOCAL_USERNAME, "definitely-wrong");
    expect(res.status).toBe(401);
  });

  it("returns a user payload (or null user) from /auth/me", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown };
    expect(body).toHaveProperty("user");
  });
});
