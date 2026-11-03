import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, routeMocksTable } from "@workspace/db";
import { provisionUser, deleteUserByUsername } from "@/shared/test-helpers";
import {
  createRouteMock,
  installPersistentRouteMocks,
  listRouteMocks,
} from "@/features/route-mocks/infrastructure/routeMockService";

const USERNAME = "vitest-route-mocks-svc";
const PROJECT = "RouteMockSvcProj";
let userId: string;

beforeAll(async () => {
  const u = await provisionUser({ username: USERNAME, role: "admin" });
  userId = u.id;
});

afterAll(async () => {
  await deleteUserByUsername(USERNAME);
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

interface FakeRoute {
  reqMethod: string;
  fulfilled?: { status: number; body: string; contentType?: string };
  continued?: boolean;
}
function makeFakePage() {
  const installed: Array<{
    pattern: string;
    handler: (route: unknown) => Promise<void>;
  }> = [];
  return {
    installed,
    page: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      route: async (pattern: string, handler: any) => {
        installed.push({ pattern, handler });
      },
    },
    async run(pattern: string, reqMethod: string): Promise<FakeRoute> {
      const entry = installed.find((i) => i.pattern === pattern);
      if (!entry) throw new Error(`no route registered for ${pattern}`);
      const fakeRoute: FakeRoute = { reqMethod };
      const route = {
        request: () => ({ method: () => reqMethod }),
        fulfill: async (opts: { status: number; body: string; contentType?: string }) => {
          fakeRoute.fulfilled = opts;
        },
        continue: async () => {
          fakeRoute.continued = true;
        },
      };
      await entry.handler(route);
      return fakeRoute;
    },
  };
}

describe("routeMockService.installPersistentRouteMocks", () => {
  it("only installs enabled rules and skips disabled rows", async () => {
    await createRouteMock({
      userId,
      projectName: PROJECT,
      name: "on",
      method: "GET",
      urlPattern: "**/on",
      status: 200,
      bodyJson: { ok: true },
      enabled: true,
    });
    await createRouteMock({
      userId,
      projectName: PROJECT,
      name: "off",
      method: "GET",
      urlPattern: "**/off",
      status: 200,
      bodyJson: null,
      enabled: false,
    });

    const fp = makeFakePage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const installed = await installPersistentRouteMocks(fp.page as any, userId, PROJECT);
    expect(installed).toBe(1);
    expect(fp.installed.map((i) => i.pattern)).toEqual(["**/on"]);
  });

  it("fulfils with the configured status + body when method matches", async () => {
    await createRouteMock({
      userId,
      projectName: PROJECT,
      name: "users",
      method: "POST",
      urlPattern: "**/api/users",
      status: 201,
      bodyJson: { id: "u1" },
      enabled: true,
    });
    const fp = makeFakePage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await installPersistentRouteMocks(fp.page as any, userId, PROJECT);
    const result = await fp.run("**/api/users", "POST");
    expect(result.fulfilled).toBeDefined();
    expect(result.fulfilled!.status).toBe(201);
    expect(result.fulfilled!.contentType).toBe("application/json");
    expect(result.fulfilled!.body).toBe('{"id":"u1"}');
    expect(result.continued).toBeUndefined();
  });

  it("falls through to route.continue() when the request method does not match", async () => {
    await createRouteMock({
      userId,
      projectName: PROJECT,
      name: "get-only",
      method: "GET",
      urlPattern: "**/api/x",
      status: 200,
      bodyJson: { v: 1 },
      enabled: true,
    });
    const fp = makeFakePage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await installPersistentRouteMocks(fp.page as any, userId, PROJECT);
    const result = await fp.run("**/api/x", "POST");
    expect(result.continued).toBe(true);
    expect(result.fulfilled).toBeUndefined();
  });

  it("emits empty body for null bodyJson rows", async () => {
    await createRouteMock({
      userId,
      projectName: PROJECT,
      name: "noop",
      method: "GET",
      urlPattern: "**/noop",
      status: 204,
      bodyJson: null,
      enabled: true,
    });
    const fp = makeFakePage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await installPersistentRouteMocks(fp.page as any, userId, PROJECT);
    const r = await fp.run("**/noop", "GET");
    expect(r.fulfilled!.body).toBe("");
  });

  it("listRouteMocks orders by createdAt ascending", async () => {
    const a = await createRouteMock({
      userId,
      projectName: PROJECT,
      name: "first",
      method: "GET",
      urlPattern: "**/a",
      status: 200,
      bodyJson: null,
      enabled: true,
    });
    const b = await createRouteMock({
      userId,
      projectName: PROJECT,
      name: "second",
      method: "GET",
      urlPattern: "**/b",
      status: 200,
      bodyJson: null,
      enabled: true,
    });
    const rows = await listRouteMocks({ userId, projectName: PROJECT });
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
  });
});

// Mute unused-vi warning when not used.
void vi;
