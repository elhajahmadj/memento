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
import {
  __resetSelectionRunsForTesting,
  __setSelectionSpawnImplForTesting,
  type SelectionSpawnImpl,
} from "../infrastructure/runDispatcher";

const ADMIN_USERNAME = "vitest-tests-discovery-admin";
let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let adminUserId = "";
let tmp: string;
let originalWorkspace: string;

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({ username: ADMIN_USERNAME, role: "admin" });
  adminUserId = admin.id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await close();
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-testsdisc-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  __setSelectionSpawnImplForTesting(null);
  __resetSelectionRunsForTesting();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("GET /api/projects/:projectId/tests", () => {
  it("returns the discovered tree for a real workspace project", async () => {
    const project = await createProject({
      solutionName: "DiscProj",
      namespace: "DiscProj.QA",
    });
    // Drop a Playwright spec into the project root so the walker has
    // something to find regardless of which scaffolder ran.
    const specDir = path.join(project.rootPath, "tests", "e2e");
    await fs.mkdir(specDir, { recursive: true });
    await fs.writeFile(
      path.join(specDir, "login.spec.ts"),
      `test.describe("Login", () => {
         test("happy", async () => {});
       });`,
    );

    const url = `${baseUrl}/api/projects/${encodeURIComponent(project.slnPath)}/tests`;
    const res = await fetch(url, { headers: withCookie(adminCookie) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projectName: string;
      slnPath: string;
      root: { totals: { all: number; e2e: number } };
    };
    expect(body.slnPath).toBe(project.slnPath);
    expect(body.root.totals.all).toBeGreaterThanOrEqual(1);
    expect(body.root.totals.e2e).toBeGreaterThanOrEqual(1);
  });

  it("returns 404 for a path outside the workspace", async () => {
    const url = `${baseUrl}/api/projects/${encodeURIComponent("/etc/passwd")}/tests`;
    const res = await fetch(url, { headers: withCookie(adminCookie) });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:projectId/runs/by-selection", () => {
  it("groups the selection by language and dispatches one CLI per group", async () => {
    const project = await createProject({
      solutionName: "DispProj",
      namespace: "DispProj.QA",
    });

    const calls: Array<{
      command: string;
      args: ReadonlyArray<string>;
      cwd: string;
    }> = [];
    const fake: SelectionSpawnImpl = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      // Minimal ChildProcessWithoutNullStreams stand-in: we never read
      // from stdio in the test, but the dispatcher attaches `data` /
      // `close` listeners and pipes both streams.
      const noop = { on: () => undefined };
      return {
        on: () => undefined,
        stdout: noop,
        stderr: noop,
      } as unknown as ReturnType<SelectionSpawnImpl>;
    };
    __setSelectionSpawnImplForTesting(fake);

    const url = `${baseUrl}/api/projects/${encodeURIComponent(project.slnPath)}/runs/by-selection`;
    const res = await fetch(url, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        testIds: [
          "Disc.LoginSuite.HappyPath",
          "tests/login.spec.ts > Login > happy",
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runs: Array<{
        id: string;
        suiteKey: string;
        status: string;
        language: string;
        testIds: string[];
      }>;
    };
    expect(body.runs).toHaveLength(2);
    const langs = body.runs.map((r) => r.language).sort();
    expect(langs).toEqual(["csharp", "nodejs"]);
    for (const r of body.runs) {
      expect(r.suiteKey).toBe("selection");
      expect(typeof r.id).toBe("string");
    }
    expect(calls).toHaveLength(2);
    const csharpCall = calls.find((c) => c.command === "dotnet");
    expect(csharpCall?.args[0]).toBe("test");
    const nodeCall = calls.find((c) => c.command === "npx");
    expect(nodeCall?.args.slice(0, 2)).toEqual(["playwright", "test"]);
  });

  it("returns the selection run by id with captured stdout/stderr", async () => {
    const project = await createProject({
      solutionName: "DetailProj",
      namespace: "DetailProj.QA",
    });

    // Hold the spawned child so the test can drive its event emitters.
    const handlers: Record<string, (...a: unknown[]) => void> = {};
    const stdoutHandlers: Record<string, (...a: unknown[]) => void> = {};
    const stderrHandlers: Record<string, (...a: unknown[]) => void> = {};
    const fake: SelectionSpawnImpl = () => {
      return {
        on: (ev: string, fn: (...a: unknown[]) => void) => {
          handlers[ev] = fn;
        },
        stdout: {
          on: (ev: string, fn: (...a: unknown[]) => void) => {
            stdoutHandlers[ev] = fn;
          },
        },
        stderr: {
          on: (ev: string, fn: (...a: unknown[]) => void) => {
            stderrHandlers[ev] = fn;
          },
        },
      } as unknown as ReturnType<SelectionSpawnImpl>;
    };
    __setSelectionSpawnImplForTesting(fake);

    const dispatchUrl = `${baseUrl}/api/projects/${encodeURIComponent(project.slnPath)}/runs/by-selection`;
    const dispatchRes = await fetch(dispatchUrl, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        testIds: ["DetailProj.Suite.HappyPath"],
      }),
    });
    expect(dispatchRes.status).toBe(200);
    const dispatchBody = (await dispatchRes.json()) as {
      runs: Array<{ id: string }>;
    };
    const runId = dispatchBody.runs[0]!.id;

    // Drive the fake child: stdout, stderr, then a clean exit.
    stdoutHandlers["data"]?.(Buffer.from("Passed: 1\n"));
    stderrHandlers["data"]?.(Buffer.from("warning NU1701\n"));
    handlers["close"]?.(0);

    const detailUrl = `${baseUrl}/api/projects/${encodeURIComponent(project.slnPath)}/runs/by-selection/${runId}`;
    const detailRes = await fetch(detailUrl, {
      headers: withCookie(adminCookie),
    });
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      id: string;
      status: string;
      exitCode: number | null;
      stdout: string;
      stderr: string;
    };
    expect(detail.id).toBe(runId);
    expect(detail.status).toBe("passed");
    expect(detail.exitCode).toBe(0);
    expect(detail.stdout).toContain("Passed: 1");
    expect(detail.stderr).toContain("NU1701");
  });

  it("404s when the runId belongs to a different project", async () => {
    const projectA = await createProject({
      solutionName: "ScopeA",
      namespace: "ScopeA.QA",
    });
    const projectB = await createProject({
      solutionName: "ScopeB",
      namespace: "ScopeB.QA",
    });

    const fake: SelectionSpawnImpl = () =>
      ({
        on: () => undefined,
        stdout: { on: () => undefined },
        stderr: { on: () => undefined },
      }) as unknown as ReturnType<SelectionSpawnImpl>;
    __setSelectionSpawnImplForTesting(fake);

    const aDispatch = await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(projectA.slnPath)}/runs/by-selection`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ testIds: ["ScopeA.Suite.T1"] }),
      },
    );
    const aBody = (await aDispatch.json()) as { runs: Array<{ id: string }> };
    const runId = aBody.runs[0]!.id;

    // Same run id, but fetched through project B's URL → 404.
    const cross = await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(projectB.slnPath)}/runs/by-selection/${runId}`,
      { headers: withCookie(adminCookie) },
    );
    expect(cross.status).toBe(404);

    // Through project A's URL → 200.
    const own = await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(projectA.slnPath)}/runs/by-selection/${runId}`,
      { headers: withCookie(adminCookie) },
    );
    expect(own.status).toBe(200);
  });

  it("rejects an empty selection with 400", async () => {
    const project = await createProject({
      solutionName: "EmptySel",
      namespace: "EmptySel.QA",
    });
    const url = `${baseUrl}/api/projects/${encodeURIComponent(project.slnPath)}/runs/by-selection`;
    const res = await fetch(url, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ testIds: [] }),
    });
    expect(res.status).toBe(400);
  });
});
