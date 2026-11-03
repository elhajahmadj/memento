import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { bootServer } from "@/shared/test-helpers";

let baseUrl: string;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
});

afterAll(async () => {
  await close();
});

describe("GET /api/healthz", () => {
  it("returns { status: 'ok' } without requiring authentication", async () => {
    const res = await fetch(`${baseUrl}/api/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body).toEqual({ status: "ok" });
  });

  it("returns 401 for a POST to /healthz (only GET is allow-listed)", async () => {
    // The router only registers GET — and the auth allow-list also only
    // covers GET — so a POST falls through to requireAuth and 401s.
    const res = await fetch(`${baseUrl}/api/healthz`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});
