import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
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
let limitedCookie: string;
const ADMIN_USERNAME = "vitest-settings-admin";
const LIMITED_USERNAME = "vitest-settings-limited";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  await provisionUser({ username: ADMIN_USERNAME, role: "admin" });
  await provisionUser({ username: LIMITED_USERNAME, role: "limited" });
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await close();
});

describe("settings routes", () => {
  describe("GET /api/settings/hook-backup-retention", () => {
    it("returns the current retention to any signed-in user", async () => {
      const res = await fetch(
        `${baseUrl}/api/settings/hook-backup-retention`,
        { headers: withCookie(limitedCookie) },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { retention: number };
      expect(typeof body.retention).toBe("number");
      expect(body.retention).toBeGreaterThan(0);
    });

    it("returns 401 without a session", async () => {
      const res = await fetch(`${baseUrl}/api/settings/hook-backup-retention`);
      expect(res.status).toBe(401);
    });
  });

  describe("PUT /api/settings/hook-backup-retention", () => {
    it("allows an admin to update and round-trip the value", async () => {
      const res = await fetch(
        `${baseUrl}/api/settings/hook-backup-retention`,
        {
          method: "PUT",
          headers: withCookie(adminCookie, {
            "content-type": "application/json",
          }),
          body: JSON.stringify({ retention: 9 }),
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { retention: number };
      expect(body.retention).toBe(9);
    });

    it("rejects a non-admin caller with 403", async () => {
      const res = await fetch(
        `${baseUrl}/api/settings/hook-backup-retention`,
        {
          method: "PUT",
          headers: withCookie(limitedCookie, {
            "content-type": "application/json",
          }),
          body: JSON.stringify({ retention: 9 }),
        },
      );
      expect(res.status).toBe(403);
    });

    it("rejects an out-of-range retention value with 400", async () => {
      const res = await fetch(
        `${baseUrl}/api/settings/hook-backup-retention`,
        {
          method: "PUT",
          headers: withCookie(adminCookie, {
            "content-type": "application/json",
          }),
          body: JSON.stringify({ retention: 9999 }),
        },
      );
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/settings/validation-trace-retention", () => {
    it("returns a numeric retentionDays for any signed-in user", async () => {
      const res = await fetch(
        `${baseUrl}/api/settings/validation-trace-retention`,
        { headers: withCookie(limitedCookie) },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { retentionDays: number };
      expect(typeof body.retentionDays).toBe("number");
      expect(body.retentionDays).toBeGreaterThan(0);
    });
  });

  describe("PUT /api/settings/validation-trace-retention", () => {
    it("allows an admin to update the retention window", async () => {
      const res = await fetch(
        `${baseUrl}/api/settings/validation-trace-retention`,
        {
          method: "PUT",
          headers: withCookie(adminCookie, {
            "content-type": "application/json",
          }),
          body: JSON.stringify({ retentionDays: 7 }),
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { retentionDays: number };
      expect(body.retentionDays).toBe(7);
    });

    it("rejects a non-admin caller with 403", async () => {
      const res = await fetch(
        `${baseUrl}/api/settings/validation-trace-retention`,
        {
          method: "PUT",
          headers: withCookie(limitedCookie, {
            "content-type": "application/json",
          }),
          body: JSON.stringify({ retentionDays: 5 }),
        },
      );
      expect(res.status).toBe(403);
    });

    it("rejects a non-positive value with 400", async () => {
      const res = await fetch(
        `${baseUrl}/api/settings/validation-trace-retention`,
        {
          method: "PUT",
          headers: withCookie(adminCookie, {
            "content-type": "application/json",
          }),
          body: JSON.stringify({ retentionDays: 0 }),
        },
      );
      expect(res.status).toBe(400);
    });
  });
});
