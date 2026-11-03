import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import {
  INTERNAL_TEST_SUITES,
  __resetForTesting,
  __setSpawnImplForTesting,
} from "@/features/internal-tests/infrastructure/internalTestRunService";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedAdminCookie: string;
const ADMIN_USERNAME = "vitest-admin-admin";
const LIMITED_ADMIN_USERNAME = "vitest-admin-ladmin";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  await provisionUser({ username: ADMIN_USERNAME, role: "admin" });
  await provisionUser({
    username: LIMITED_ADMIN_USERNAME,
    role: "limited_admin",
  });
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedAdminCookie = await login(baseUrl, LIMITED_ADMIN_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_ADMIN_USERNAME);
  await close();
});

describe("GET /api/admin/validation-traces", () => {
  it("returns dir + counts to an admin", async () => {
    const res = await fetch(`${baseUrl}/api/admin/validation-traces`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dir: string;
      fileCount: number;
      totalBytes: number;
      maxAgeMs: number;
    };
    expect(typeof body.dir).toBe("string");
    expect(typeof body.fileCount).toBe("number");
    expect(typeof body.totalBytes).toBe("number");
    expect(typeof body.maxAgeMs).toBe("number");
  });

  it("rejects a limited_admin with 403", async () => {
    const res = await fetch(`${baseUrl}/api/admin/validation-traces`, {
      headers: withCookie(limitedAdminCookie),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/internal-tests/suites", () => {
  it("returns the suite list to an admin", async () => {
    const res = await fetch(`${baseUrl}/api/admin/internal-tests/suites`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      enabled: boolean;
      suites: Array<{ key: string; name: string }>;
      current: unknown;
    };
    expect(typeof body.enabled).toBe("boolean");
    // Suite metadata is built at module load — every key in the constant
    // should be present in the response.
    for (const s of INTERNAL_TEST_SUITES) {
      expect(body.suites.find((x) => x.key === s.key)).toBeDefined();
    }
  });

  it("rejects a limited_admin with 403", async () => {
    const res = await fetch(`${baseUrl}/api/admin/internal-tests/suites`, {
      headers: withCookie(limitedAdminCookie),
    });
    expect(res.status).toBe(403);
  });
});

// Stub child-process spawn so the success-path internal-tests test never
// shells out to a real `pnpm vitest`. Returns a child whose streams end
// immediately and exits with code 0 on next-tick. Reset between tests so
// the rest of the suite (which exercises validation/auth branches only)
// is unaffected.
function makeFakeChild(exitCode: number): ChildProcessWithoutNullStreams {
  const stdout = Readable.from([]) as unknown as ChildProcessWithoutNullStreams["stdout"];
  const stderr = Readable.from([]) as unknown as ChildProcessWithoutNullStreams["stderr"];
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  Object.assign(child, { stdout, stderr });
  // Defer the close so the route handler returns 201 before the
  // run is finalised.
  setImmediate(() => {
    child.emit("close", exitCode);
  });
  return child;
}

afterEach(() => {
  __setSpawnImplForTesting(null);
  __resetForTesting();
});

describe("POST /api/admin/internal-tests/runs", () => {
  it("starts a run with a valid suiteKey (admin)", async () => {
    __setSpawnImplForTesting(() => makeFakeChild(0));
    const res = await fetch(`${baseUrl}/api/admin/internal-tests/runs`, {
      method: "POST",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ suiteKey: INTERNAL_TEST_SUITES[0]!.key }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      run: { id: string; suiteKey: string; status: string };
    };
    expect(body.run.id).toBeTruthy();
    expect(body.run.suiteKey).toBe(INTERNAL_TEST_SUITES[0]!.key);
    // The fake child closes on next tick, so by the time the response
    // resolves the run could be either "running" or already terminal —
    // both are valid happy-path states.
    expect(["running", "passed", "failed", "error"]).toContain(body.run.status);
  });

  it("rejects an unknown suiteKey with 400", async () => {
    const res = await fetch(`${baseUrl}/api/admin/internal-tests/runs`, {
      method: "POST",
      headers: withCookie(adminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ suiteKey: "no-such-suite" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(`${baseUrl}/api/admin/internal-tests/runs`, {
      method: "POST",
      headers: withCookie(limitedAdminCookie, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ suiteKey: INTERNAL_TEST_SUITES[0]!.key }),
    });
    expect(res.status).toBe(403);
  });
});

// Helper: start a run via the spawn stub, wait for it to enter the
// terminal state, and return its id. Used by the GET /:id and SSE
// happy-path tests below so they have a live run to point at.
async function startRunAndWaitForCompletion(): Promise<string> {
  __setSpawnImplForTesting(() => makeFakeChild(0));
  const post = await fetch(`${baseUrl}/api/admin/internal-tests/runs`, {
    method: "POST",
    headers: withCookie(adminCookie, { "content-type": "application/json" }),
    body: JSON.stringify({ suiteKey: INTERNAL_TEST_SUITES[0]!.key }),
  });
  const body = (await post.json()) as { run: { id: string } };
  // Give the run service a moment to absorb the synthetic child's
  // close event so subsequent GETs see a terminal status.
  await new Promise((r) => setTimeout(r, 50));
  return body.run.id;
}

describe("GET /api/admin/internal-tests/runs/:id", () => {
  it("returns 404 for an unknown run id", async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/internal-tests/runs/does-not-exist`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("returns the run + log for an existing run id (admin)", async () => {
    const id = await startRunAndWaitForCompletion();
    const res = await fetch(
      `${baseUrl}/api/admin/internal-tests/runs/${id}`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run: { id: string; status: string };
      log: string[];
    };
    expect(body.run.id).toBe(id);
    expect(["running", "passed", "failed", "error"]).toContain(body.run.status);
    expect(Array.isArray(body.log)).toBe(true);
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/internal-tests/runs/does-not-exist`,
      { headers: withCookie(limitedAdminCookie) },
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/internal-tests/runs/:id/stream", () => {
  it("returns 404 (not an SSE stream) for an unknown run id", async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/internal-tests/runs/does-not-exist/stream`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
    // Should NOT have written SSE headers — verify it's still JSON.
    expect(res.headers.get("content-type") ?? "").not.toContain(
      "text/event-stream",
    );
  });

  it("streams an SSE 'done' event for a finished run (admin)", async () => {
    const id = await startRunAndWaitForCompletion();
    const res = await fetch(
      `${baseUrl}/api/admin/internal-tests/runs/${id}/stream`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain(
      "text/event-stream",
    );
    // The run already finished so the route emits a single `done` event
    // and closes the stream — read the entire body and assert.
    const text = await res.text();
    expect(text).toContain("event: done");
    expect(text).toContain('"id":');
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await fetch(
      `${baseUrl}/api/admin/internal-tests/runs/does-not-exist/stream`,
      { headers: withCookie(limitedAdminCookie) },
    );
    expect(res.status).toBe(403);
  });
});
