import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import app from "@/app";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  DEFAULT_ARCHITECTURE_ID,
  type Architecture,
} from "@/features/architectures/infrastructure/architectureService";
import { db, usersTable } from "@workspace/db";
import { setAuthProvider } from "@/features/auth/infrastructure/authProvider";
import { hashPassword } from "@/features/auth/infrastructure/passwordHash";

let server: http.Server;
let baseUrl: string;
let tmp: string;
let originalWorkspace: string;
let cookie: string;

const ADMIN_USERNAME = "vitest-archroutes-admin";
const ADMIN_PASSWORD = "Sup3rSecret!";

function archDir(): string {
  return path.join(recorderConfig.workspaceDir, ".architectures");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function validArch(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: "arch-one",
    name: "Arch One",
    isBuiltIn: false,
    projects: [
      {
        id: "p1",
        nameSuffix: ".Tests",
        isTestsProject: true,
        slnGuid: "{00000000-0000-0000-0000-000000000001}",
        files: [{ name: "appsettings.json", content: "{}" }],
        folders: [{ name: "Tests", files: [], folders: [] }],
      },
    ],
    ...overrides,
  };
}

// Auth headers shared across requests so the requireAdmin middleware sees a
// logged-in admin. Without these every architectures route returns 401.
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return cookie ? { ...extra, cookie } : { ...extra };
}

beforeAll(async () => {
  // The architectures routes are behind requireAuth + requireAdmin. Provision
  // a single admin user we log in with in beforeEach.
  setAuthProvider(null);

  // Make sure no previous run left the admin row behind.
  await db.delete(usersTable).where(eq(usersTable.username, ADMIN_USERNAME));
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  await db
    .insert(usersTable)
    .values({
      username: ADMIN_USERNAME,
      passwordHash,
      role: "admin",
      profile: {},
    });
});

afterAll(async () => {
  await db.delete(usersTable).where(eq(usersTable.username, ADMIN_USERNAME));
  setAuthProvider(null);
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-archroutes-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;

  await new Promise<void>((resolve) => {
    // Force `req.secure` true so express-session (cookie.secure: true)
    // actually emits the Set-Cookie header on login. Trust-proxy is
    // already enabled on the app, so the x-forwarded-proto shim is
    // enough. Without this, login() returns 200 with no session cookie
    // and every protected route call below 401s.
    server = http.createServer((req, res) => {
      req.headers["x-forwarded-proto"] = "https";
      (app as unknown as (r: typeof req, s: typeof res) => void)(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Establish a session cookie via the public login route so subsequent
  // fetches carry an authenticated identity.
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    }),
  });
  if (loginRes.status !== 200) {
    throw new Error(
      `setup login failed: ${loginRes.status} ${await loginRes.text()}`,
    );
  }
  const setCookie = loginRes.headers.get("set-cookie");
  if (!setCookie) throw new Error("setup login did not return a session cookie");
  // Strip flags (Path, HttpOnly, etc.) — we only need name=value for the
  // Cookie request header.
  cookie = setCookie.split(";")[0]!;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
  cookie = "";
});

describe("GET /api/architectures", () => {
  it("returns the built-in defaults (csharp + python + nodejs + java) when there are no custom entries", async () => {
    const res = await fetch(`${baseUrl}/api/architectures`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Architecture[];
    // Four built-ins ship by default — one per supported language.
    expect(body.every((a) => a.isBuiltIn)).toBe(true);
    expect(body.find((a) => a.id === DEFAULT_ARCHITECTURE_ID)).toBeDefined();
    expect(body.find((a) => a.id === "python-default")).toBeDefined();
    expect(body.find((a) => a.id === "nodejs-default")).toBeDefined();
    expect(body.find((a) => a.id === "java-default")).toBeDefined();
  });

  it("returns the default plus custom architectures from disk", async () => {
    // Persist a custom architecture via the upsert endpoint so we exercise
    // the same code path the UI uses.
    const create = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(validArch({ id: "custom-a", name: "Custom A" })),
    });
    expect(create.status).toBe(200);

    const res = await fetch(`${baseUrl}/api/architectures`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Architecture[];
    const ids = body.map((a) => a.id);
    expect(ids).toContain(DEFAULT_ARCHITECTURE_ID);
    expect(ids).toContain("custom-a");
    const custom = body.find((a) => a.id === "custom-a");
    expect(custom?.isBuiltIn).toBe(false);
    expect(custom?.name).toBe("Custom A");
  });
});

describe("POST /api/architectures (upsert)", () => {
  it("persists a new architecture to disk and echoes it back", async () => {
    const res = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(validArch({ id: "persisted", name: "Persisted" })),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Architecture;
    expect(body.id).toBe("persisted");
    expect(body.isBuiltIn).toBe(false);

    const onDisk = path.join(archDir(), "persisted.json");
    expect(await exists(onDisk)).toBe(true);
    const stored = JSON.parse(await fs.readFile(onDisk, "utf8")) as Architecture;
    expect(stored.id).toBe("persisted");
    expect(stored.name).toBe("Persisted");
    expect(stored.isBuiltIn).toBe(false);
  });

  it("generates an id when the request omits one", async () => {
    const res = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(validArch({ id: "", name: "No Id" })),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Architecture;
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    const onDisk = path.join(archDir(), `${body.id}.json`);
    expect(await exists(onDisk)).toBe(true);
  });

  it("updates an existing architecture in place when re-posted with the same id", async () => {
    const first = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(validArch({ id: "same", name: "First" })),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(validArch({ id: "same", name: "Second" })),
    });
    expect(second.status).toBe(200);

    const list = (await (
      await fetch(`${baseUrl}/api/architectures`, { headers: authHeaders() })
    ).json()) as Architecture[];
    const matches = list.filter((a) => a.id === "same");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.name).toBe("Second");
  });

  it("rejects malformed payloads with 400", async () => {
    const bad = {
      id: "bad-shape",
      name: "Bad",
      isBuiltIn: false,
      projects: [
        {
          id: "p1",
          nameSuffix: ".Tests",
          isTestsProject: true,
          slnGuid: "{0}",
          // file name with a path separator must be rejected by the schema
          files: [{ name: "../escape.cs", content: "x" }],
          folders: [],
        },
      ],
    };
    const res = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(bad),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(await exists(path.join(archDir(), "bad-shape.json"))).toBe(false);
  });

  it("rejects unsafe ids with 400", async () => {
    const res = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(validArch({ id: "../escape", name: "Evil" })),
    });
    expect(res.status).toBe(400);
    expect(await exists(path.join(archDir(), "..", "escape.json"))).toBe(false);
  });

  it("refuses to overwrite the built-in default", async () => {
    const res = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(
        validArch({ id: DEFAULT_ARCHITECTURE_ID, name: "Hijack" }),
      ),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/built-in/i);
  });

  it("requires at least one tests project", async () => {
    const arch = validArch({
      id: "no-tests",
      projects: [
        {
          id: "p1",
          nameSuffix: ".Lib",
          isTestsProject: false,
          slnGuid: "{00000000-0000-0000-0000-000000000001}",
          files: [],
          folders: [],
        },
      ],
    });
    const res = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(arch),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/architectures/delete", () => {
  it("removes the file for an existing custom architecture", async () => {
    const create = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(validArch({ id: "to-delete", name: "Goner" })),
    });
    expect(create.status).toBe(200);
    const filePath = path.join(archDir(), "to-delete.json");
    expect(await exists(filePath)).toBe(true);

    const del = await fetch(`${baseUrl}/api/architectures/delete`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ id: "to-delete" }),
    });
    expect(del.status).toBe(204);
    expect(await exists(filePath)).toBe(false);

    const list = (await (
      await fetch(`${baseUrl}/api/architectures`, { headers: authHeaders() })
    ).json()) as Architecture[];
    expect(list.find((a) => a.id === "to-delete")).toBeUndefined();
  });

  it("refuses to delete the built-in default", async () => {
    const res = await fetch(`${baseUrl}/api/architectures/delete`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ id: DEFAULT_ARCHITECTURE_ID }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/built-in/i);

    // The default still shows up in the listing.
    const list = (await (
      await fetch(`${baseUrl}/api/architectures`, { headers: authHeaders() })
    ).json()) as Architecture[];
    expect(list.find((a) => a.id === DEFAULT_ARCHITECTURE_ID)).toBeDefined();
  });

  it("rejects unsafe ids with 400", async () => {
    const res = await fetch(`${baseUrl}/api/architectures/delete`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ id: "../escape" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects malformed bodies with 400", async () => {
    const res = await fetch(`${baseUrl}/api/architectures/delete`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 204 for a non-existent (already absent) custom id", async () => {
    const res = await fetch(`${baseUrl}/api/architectures/delete`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ id: "never-existed" }),
    });
    expect(res.status).toBe(204);
  });
});

describe("GET /api/architectures/:id", () => {
  it("returns the built-in default by id", async () => {
    const res = await fetch(
      `${baseUrl}/api/architectures/${DEFAULT_ARCHITECTURE_ID}`,
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Architecture;
    expect(body.id).toBe(DEFAULT_ARCHITECTURE_ID);
    expect(body.isBuiltIn).toBe(true);
  });

  it("returns a custom architecture by id after upsert", async () => {
    await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(validArch({ id: "fetched", name: "Fetched" })),
    });
    const res = await fetch(`${baseUrl}/api/architectures/fetched`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Architecture;
    expect(body.id).toBe("fetched");
    expect(body.name).toBe("Fetched");
  });

  it("returns 404 for an unknown id", async () => {
    const res = await fetch(`${baseUrl}/api/architectures/missing`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("/api/architectures + solutionType", () => {
  it("lists built-in API marker architectures with solutionType=api", async () => {
    const res = await fetch(`${baseUrl}/api/architectures`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Architecture[];
    const apiBuiltIns = body.filter(
      (a) => a.isBuiltIn && a.solutionType === "api",
    );
    expect(apiBuiltIns.map((a) => a.id).sort()).toEqual([
      "api-default-csharp",
      "api-default-java",
      "api-default-nodejs",
      "api-default-python",
    ]);
    for (const arch of apiBuiltIns) {
      expect(arch.projects).toEqual([]);
      // Each per-language built-in pins its language so the New Project
      // dropdown filter (language + solutionType) shows exactly one
      // built-in option per (language, api) pair.
      expect(["csharp", "python", "nodejs", "java"]).toContain(arch.language);
    }
  });

  it("persists a custom API architecture with solutionType=api round-tripped over the wire", async () => {
    const apiArch = validArch({
      id: "custom-api",
      name: "My Custom API Layout",
    });
    apiArch.language = "csharp";
    apiArch.solutionType = "api";
    apiArch.projects = [
      {
        id: "api-tests",
        nameSuffix: ".ApiTests",
        isTestsProject: true,
        slnGuid: "{00000000-0000-0000-0000-0000000000aa}",
        files: [],
        folders: [],
      },
    ];

    const create = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(apiArch),
    });
    expect(create.status).toBe(200);
    const created = (await create.json()) as Architecture;
    expect(created.solutionType).toBe("api");

    const list = (await (
      await fetch(`${baseUrl}/api/architectures`, { headers: authHeaders() })
    ).json()) as Architecture[];
    const fetched = list.find((a) => a.id === "custom-api");
    expect(fetched?.solutionType).toBe("api");
    expect(fetched?.language).toBe("csharp");
  });

  it("refuses to overwrite the built-in API marker architecture", async () => {
    const res = await fetch(`${baseUrl}/api/architectures`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(
        validArch({ id: "api-default-csharp", name: "Hijack" }),
      ),
    });
    expect(res.status).toBe(400);
  });
});
