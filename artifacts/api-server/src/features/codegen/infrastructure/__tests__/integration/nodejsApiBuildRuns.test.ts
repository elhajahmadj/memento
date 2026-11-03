import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
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
import { setCurrentProject } from "@/features/projects/infrastructure/projectService";

/**
 * Full-route integration smoke for the Node.js API Build Test pipeline.
 *
 * Walks the same path the SPA does:
 *
 *   1. `POST /api/projects` to scaffold a Node.js + solutionType=api
 *      project under a tmp workspace dir.
 *   2. `POST /api/projects/load` to make it the caller's current project.
 *   3. `POST /api/api-tests/build` with a minimal spec; assert the
 *      response lists the four expected file paths and that the new
 *      ones report `created: true`.
 *   4. Snapshot the on-disk contents of the four files and check the
 *      key landmarks (endpoint constant, helper, test class with `it()`,
 *      appsettings url entry).
 *   5. Stand up a tiny in-process stub HTTP server that responds 200 to
 *      `GET /users`, point appsettings.Default at it, then symlink the
 *      api-server's `node_modules` into the scaffold and run
 *      `npx vitest run`. Assert exit code 0 (the generated test passes
 *      against the stub).
 *
 * Gated behind `RUN_API_NODEJS_INTEGRATION=1` because it spawns
 * `npx vitest`, which costs a few seconds even with a warm cache.
 */
const RUN = process.env.RUN_API_NODEJS_INTEGRATION === "1";
const TWO_MINUTES = 2 * 60 * 1000;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const ADMIN_USERNAME = "vitest-nodejsapirun-admin";

describe.skipIf(!RUN)("nodejs API build runs end-to-end via /api routes", () => {
  let serverBaseUrl: string;
  let close: () => Promise<void>;
  let cookie: string;
  let tmp: string;
  let originalWorkspace: string;
  let projectRoot: string;
  let solutionName: string;
  let stub: http.Server;
  let stubBaseUrl: string;

  beforeAll(async () => {
    ({ baseUrl: serverBaseUrl, close } = await bootServer());
    const admin = await provisionUser({
      username: ADMIN_USERNAME,
      role: "admin",
    });
    void admin;
    cookie = await login(serverBaseUrl, ADMIN_USERNAME);

    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-nodejsapirun-"));
    originalWorkspace = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;

    // Stub HTTP server that responds 200 to /users — the generated test
    // asserts `expect(response.status).toBe(200)` so this is what makes
    // vitest exit 0.
    stub = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/users") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ users: [] }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      stub.listen(0, "127.0.0.1", () => resolve()),
    );
    const { port } = stub.address() as AddressInfo;
    stubBaseUrl = `http://127.0.0.1:${port}`;

    solutionName = `IntApiNodejs${Date.now().toString(36)}`;

    const create = await fetch(`${serverBaseUrl}/api/projects`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        solutionName,
        namespace: solutionName,
        language: "nodejs",
        solutionType: "api",
        testProjectName: "tests",
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { slnPath: string };
    projectRoot = path.dirname(created.slnPath);

    const load = await fetch(`${serverBaseUrl}/api/projects/load`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({ slnPath: created.slnPath }),
    });
    expect(load.ok).toBe(true);
  }, TWO_MINUTES);

  afterAll(async () => {
    await new Promise<void>((resolve) =>
      stub?.close(() => resolve()),
    );
    setCurrentProject(null);
    recorderConfig.workspaceDir = originalWorkspace;
    await fs.rm(tmp, { recursive: true, force: true });
    await deleteUserByUsername(ADMIN_USERNAME);
    await close();
  });

  it(
    "POST /api/api-tests/build emits the four-file plan and the generated vitest passes against a stub",
    async () => {
      // Build with baseUrl pointing at our stub server so the generated
      // test resolves against it instead of the public internet.
      const build = await fetch(`${serverBaseUrl}/api/api-tests/build`, {
        method: "POST",
        headers: withCookie(cookie, { "content-type": "application/json" }),
        body: JSON.stringify({
          solutionName,
          baseUrl: stubBaseUrl,
          urlName: "Default",
          endpointName: "GetUsers",
          endpointPath: "/users",
          buildInto: "testMethod",
          testMethodName: "GetUsers_Returns200",
          testClass: { mode: "new", className: "UsersTests" },
          helperMethodName: "GetUsersAsync",
          parameters: [],
          httpMethod: "GET",
          useAccessToken: false,
          multipartFields: [],
          defaultHeaders: [],
        }),
      });
      expect(build.status).toBe(200);
      const body = (await build.json()) as {
        files: Array<{ path: string; created: boolean }>;
      };

      // Snapshot the file plan: four files, two newly created.
      const paths = body.files.map((f) => f.path).sort();
      expect(paths).toEqual([
        "src/automation-api/constants/api-endpoints.ts",
        "tests/api-testing-assistants/users-tests-api-testing-assistants.ts",
        "tests/appsettings.json",
        "tests/tests/users-tests.spec.ts",
      ]);
      const createdPaths = body.files
        .filter((f) => f.created)
        .map((f) => f.path)
        .sort();
      expect(createdPaths).toEqual([
        "tests/api-testing-assistants/users-tests-api-testing-assistants.ts",
        "tests/tests/users-tests.spec.ts",
      ]);

      // Snapshot key content landmarks on disk.
      const endpoints = await fs.readFile(
        path.join(projectRoot, "src/automation-api/constants/api-endpoints.ts"),
        "utf8",
      );
      expect(endpoints).toMatch(/GetUsers\s*:\s*"\/users"/);

      const assistant = await fs.readFile(
        path.join(
          projectRoot,
          "tests/api-testing-assistants/users-tests-api-testing-assistants.ts",
        ),
        "utf8",
      );
      expect(assistant).toMatch(/GetUsersAsync/);

      const spec = await fs.readFile(
        path.join(projectRoot, "tests/tests/users-tests.spec.ts"),
        "utf8",
      );
      expect(spec).toMatch(/it\(\s*"GetUsers_Returns200"/);
      expect(spec).toMatch(/expect\(.*status\)\.toBe\(200\)/);

      const appsettings = JSON.parse(
        await fs.readFile(
          path.join(projectRoot, "tests/appsettings.json"),
          "utf8",
        ),
      );
      expect(appsettings.ApiTest.Urls.Default.BaseUrl).toBe(stubBaseUrl);

      // Symlink the api-server's node_modules into the scaffold so
      // vitest + undici resolve without a fresh `npm install`. When
      // this suite is invoked via `pnpm --filter @workspace/api-server
      // exec vitest run`, cwd is the api-server package root.
      const apiServerNodeModules = path.resolve(
        process.cwd(),
        "node_modules",
      );
      await fs.symlink(
        apiServerNodeModules,
        path.join(projectRoot, "node_modules"),
        "dir",
      );

      const result = await run("npx", ["vitest", "run", "--no-coverage"], {
        cwd: projectRoot,
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      expect(combined).toMatch(/Test Files\s+1 passed/);
      expect(result.code).toBe(0);
    },
    TWO_MINUTES,
  );
});
