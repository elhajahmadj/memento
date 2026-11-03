import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import { saveActionSet } from "@/features/recording/infrastructure/recordedActionStore";
import { db, validationRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedAdminCookie: string;
let tmp: string;
let originalWorkspace: string;
let adminUserId = "";

const ADMIN_USERNAME = "vitest-valroutes-admin";
const LIMITED_ADMIN_USERNAME = "vitest-valroutes-ladmin";

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
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedAdminCookie = await login(baseUrl, LIMITED_ADMIN_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_ADMIN_USERNAME);
  await close();
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-valroutes-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("GET /api/validation/recordings", () => {
  it("returns 404 when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await fetch(`${baseUrl}/api/validation/recordings`, {
      headers: withCookie(adminCookie),
    });
    // requireAdminOrAssignedToCurrentProjectOrOwner returns 404 when no
    // project is loaded for an admin/limited_admin caller.
    expect(res.status).toBe(404);
  });

  it("returns an empty list for a fresh project (admin)", async () => {
    const project = await createProject({
      solutionName: "ValRecs",
      namespace: "ValRecs.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/validation/recordings`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it("rejects a limited_admin without a project loaded (404)", async () => {
    // Project is loaded only for the admin; the middleware returns 404
    // for limited_admins with no current project.
    const project = await createProject({
      solutionName: "ValRecsB",
      namespace: "ValRecsB.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/validation/recordings`, {
      headers: withCookie(limitedAdminCookie),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/validation/runs", () => {
  it("returns 404 when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await fetch(`${baseUrl}/api/validation/runs`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ filePath: "x.cs", kind: "testMethod", methodName: "M" }),
    });
    // requireAdminOrAssignedToCurrentProjectOrOwner returns 404 when no
    // project is loaded for an admin/limited_admin caller.
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid kind value", async () => {
    const project = await createProject({
      solutionName: "ValBad",
      namespace: "ValBad.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/validation/runs`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        filePath: "Tests/Foo.cs",
        kind: "junkKind",
        methodName: "M",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when source=session has no stopped session", async () => {
    const project = await createProject({
      solutionName: "ValSess",
      namespace: "ValSess.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/validation/runs`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ source: "session" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a recording that does not exist", async () => {
    const project = await createProject({
      solutionName: "ValRec404",
      namespace: "ValRec404.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/validation/runs`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        filePath: "Tests/Nope.cs",
        kind: "testMethod",
        methodName: "DoesNotExist",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("queues a validation run for a stored recording (admin)", async () => {
    // Use a unique project name so the single-active-run guard
    // (findActiveRunForProject) can't collide with prior tests.
    const project = await createProject({
      solutionName: "ValQueueOK",
      namespace: "ValQueueOK.QA",
    });
    setCurrentProject(project, adminUserId);
    // Seed a recordedActionSet so the route's existence check passes. The
    // background pump will probe the (intentionally unreachable) URL,
    // mark the run as `error`, and never launch chromium.
    await saveActionSet({
      userId: adminUserId,
      projectName: project.solutionName,
      filePath: "Tests/ValQueueOK.cs",
      kind: "testMethod",
      methodName: "Smoke",
      urlName: "Local",
      startUrl: "http://127.0.0.1:1",
      actions: [],
    });
    const res = await fetch(`${baseUrl}/api/validation/runs`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        filePath: "Tests/ValQueueOK.cs",
        kind: "testMethod",
        methodName: "Smoke",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(typeof body.id).toBe("string");
    // Tear down: wait briefly for the background pump to finish (the
    // probe fails fast on a refused connection, so this is < 1s) and
    // then drop the row so the next suite isn't blocked by the
    // single-active-run guard.
    await new Promise((r) => setTimeout(r, 1500));
    await db
      .delete(validationRunsTable)
      .where(eq(validationRunsTable.id, body.id));
  });
});

describe("GET /api/validation/runs", () => {
  it("returns 404 when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await fetch(`${baseUrl}/api/validation/runs`, {
      headers: withCookie(adminCookie),
    });
    // requireAdminOrAssignedToCurrentProjectOrOwner returns 404 when no
    // project is loaded for an admin/limited_admin caller.
    expect(res.status).toBe(404);
  });

  it("returns an empty list for a fresh project", async () => {
    const project = await createProject({
      solutionName: "ValList",
      namespace: "ValList.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/validation/runs`, {
      headers: withCookie(adminCookie),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });
});

// Helper: insert a completed validation_runs row whose project matches
// the currently-loaded project, optionally also writing on-disk trace
// + final-screenshot artifacts under `<cwd>/.validation-traces/` (the
// path traceZipPathForRun / finalScreenshotPathForRun resolve to).
// Returns the run id and the absolute paths it created so callers can
// clean them up.
async function seedCompletedRun(opts: {
  projectName: string;
  triggeredByUserId: string;
  withArtifacts: boolean;
}): Promise<{ id: string; tracePath: string | null; shotPath: string | null }> {
  const traceFilename = `${crypto.randomUUID()}.zip`;
  const [row] = await db
    .insert(validationRunsTable)
    .values({
      projectName: opts.projectName,
      recordingFilePath: "Tests/Seeded.cs",
      recordingKind: "testMethod" as const,
      recordingMethodName: "Seeded",
      status: "passed" as const,
      summary: { steps: [] },
      traceRef: opts.withArtifacts ? traceFilename : null,
      triggeredByUserId: opts.triggeredByUserId,
    })
    .returning();
  const traceDir = path.join(process.cwd(), ".validation-traces");
  let tracePath: string | null = null;
  let shotPath: string | null = null;
  if (opts.withArtifacts) {
    await fs.mkdir(traceDir, { recursive: true });
    tracePath = path.join(traceDir, traceFilename);
    shotPath = path.join(traceDir, `${row!.id}-final.png`);
    // Minimal valid zip (PK\x05\x06 EOCD-only) and tiny PNG-ish blob;
    // the route only does fs.existsSync + streams bytes through, so
    // any non-empty file is fine.
    await fs.writeFile(
      tracePath,
      Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    await fs.writeFile(shotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  return { id: row!.id, tracePath, shotPath };
}

describe("GET /api/validation/runs/:id", () => {
  it("returns 404 when no project is loaded", async () => {
    setCurrentProject(null, adminUserId);
    const res = await fetch(
      `${baseUrl}/api/validation/runs/00000000-0000-0000-0000-000000000000`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the run does not exist (project loaded)", async () => {
    const project = await createProject({
      solutionName: "ValGet",
      namespace: "ValGet.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(
      `${baseUrl}/api/validation/runs/00000000-0000-0000-0000-000000000000`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 200 with the run payload when the run exists (admin)", async () => {
    const project = await createProject({
      solutionName: "ValGetOK",
      namespace: "ValGetOK.QA",
    });
    setCurrentProject(project, adminUserId);
    const seeded = await seedCompletedRun({
      projectName: project.solutionName,
      triggeredByUserId: adminUserId,
      withArtifacts: false,
    });
    try {
      const res = await fetch(
        `${baseUrl}/api/validation/runs/${seeded.id}`,
        { headers: withCookie(adminCookie) },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; status: string };
      expect(body.id).toBe(seeded.id);
      expect(body.status).toBe("passed");
    } finally {
      await db
        .delete(validationRunsTable)
        .where(eq(validationRunsTable.id, seeded.id));
    }
  });
});

describe("GET /api/validation/runs/:id/trace", () => {
  it("returns 404 when the run does not exist", async () => {
    const project = await createProject({
      solutionName: "ValTrace",
      namespace: "ValTrace.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(
      `${baseUrl}/api/validation/runs/00000000-0000-0000-0000-000000000000/trace`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("streams the trace zip when one exists (admin)", async () => {
    const project = await createProject({
      solutionName: "ValTraceOK",
      namespace: "ValTraceOK.QA",
    });
    setCurrentProject(project, adminUserId);
    const seeded = await seedCompletedRun({
      projectName: project.solutionName,
      triggeredByUserId: adminUserId,
      withArtifacts: true,
    });
    try {
      const res = await fetch(
        `${baseUrl}/api/validation/runs/${seeded.id}/trace`,
        { headers: withCookie(adminCookie) },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.length).toBeGreaterThan(0);
    } finally {
      if (seeded.tracePath) await fs.unlink(seeded.tracePath).catch(() => {});
      if (seeded.shotPath) await fs.unlink(seeded.shotPath).catch(() => {});
      await db
        .delete(validationRunsTable)
        .where(eq(validationRunsTable.id, seeded.id));
    }
  });
});

describe("GET /api/validation/runs/:id/screenshot", () => {
  it("returns 404 when the run does not exist", async () => {
    const project = await createProject({
      solutionName: "ValShot",
      namespace: "ValShot.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(
      `${baseUrl}/api/validation/runs/00000000-0000-0000-0000-000000000000/screenshot`,
      { headers: withCookie(adminCookie) },
    );
    expect(res.status).toBe(404);
  });

  it("streams the final screenshot when one exists (admin)", async () => {
    const project = await createProject({
      solutionName: "ValShotOK",
      namespace: "ValShotOK.QA",
    });
    setCurrentProject(project, adminUserId);
    const seeded = await seedCompletedRun({
      projectName: project.solutionName,
      triggeredByUserId: adminUserId,
      withArtifacts: true,
    });
    try {
      const res = await fetch(
        `${baseUrl}/api/validation/runs/${seeded.id}/screenshot`,
        { headers: withCookie(adminCookie) },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    } finally {
      if (seeded.tracePath) await fs.unlink(seeded.tracePath).catch(() => {});
      if (seeded.shotPath) await fs.unlink(seeded.shotPath).catch(() => {});
      await db
        .delete(validationRunsTable)
        .where(eq(validationRunsTable.id, seeded.id));
    }
  });
});
