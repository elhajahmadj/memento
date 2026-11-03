import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ensureDemoProjectMock = vi.fn();

vi.mock("@/features/demo/infrastructure/demoService", () => ({
  ensureDemoProject: (...args: unknown[]) => ensureDemoProjectMock(...args),
}));

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
let userId: string;
const USERNAME = "vitest-demo-routes";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const u = await provisionUser({ username: USERNAME, role: "admin" });
  userId = u.id;
  cookie = await login(baseUrl, USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(USERNAME);
  await close();
});

describe("POST /projects/demo", () => {
  it("rejects unauthenticated requests", async () => {
    ensureDemoProjectMock.mockResolvedValueOnce({
      project: { slnPath: "/x.sln", solutionName: "MementoDemo" },
      seededTestMethods: [],
      seededMocks: [],
    });
    const res = await fetch(`${baseUrl}/api/projects/demo`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 201 with the seeded summary on success", async () => {
    ensureDemoProjectMock.mockReset();
    ensureDemoProjectMock.mockResolvedValueOnce({
      project: { slnPath: "/tmp/MementoDemo/MementoDemo.sln", solutionName: "MementoDemo" },
      seededTestMethods: ["Demo_A", "Demo_B"],
      seededMocks: ["Demo: stub /api/users/me"],
    });

    const res = await fetch(`${baseUrl}/api/projects/demo`, {
      method: "POST",
      headers: withCookie(cookie),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      slnPath: string;
      solutionName: string;
      seededTestMethods: string[];
      seededMocks: string[];
    };
    expect(body).toEqual({
      slnPath: "/tmp/MementoDemo/MementoDemo.sln",
      solutionName: "MementoDemo",
      seededTestMethods: ["Demo_A", "Demo_B"],
      seededMocks: ["Demo: stub /api/users/me"],
    });
    expect(ensureDemoProjectMock).toHaveBeenCalledWith({ userId });
  });

  it("returns 400 when scaffolding fails", async () => {
    ensureDemoProjectMock.mockReset();
    ensureDemoProjectMock.mockRejectedValueOnce(new Error("disk full"));
    const res = await fetch(`${baseUrl}/api/projects/demo`, {
      method: "POST",
      headers: withCookie(cookie),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("disk full");
  });
});
