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
  type Project,
} from "@/features/projects/infrastructure/projectService";
import { createAssignment } from "@/features/assignments/infrastructure/assignmentService";
import { createFork } from "@/features/forks/infrastructure/forkService";
import { pipelineFilePath } from "@/features/projects/infrastructure/pipelineTemplates";
import {
  db,
  forksTable,
  projectAssignmentsTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";

const TEST_USERNAMES = [
  "vitest-pipefile-admin",
  "vitest-pipefile-ladmin",
  "vitest-pipefile-limited",
];

async function scrubTestUserFkRows(): Promise<void> {
  const stale = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.username, TEST_USERNAMES));
  if (stale.length === 0) return;
  const ids = stale.map((u) => u.id);
  await db
    .delete(projectAssignmentsTable)
    .where(
      or(
        inArray(projectAssignmentsTable.userId, ids),
        inArray(projectAssignmentsTable.assignedBy, ids),
      ),
    );
  await db
    .delete(forksTable)
    .where(
      or(
        inArray(forksTable.userId, ids),
        inArray(forksTable.decidedBy, ids),
      ),
    );
}

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedAdminCookie: string;
let limitedCookie: string;
let tmp: string;
let originalWorkspace: string;
let adminUserId = "";
let limitedAdminUserId = "";
let limitedUserId = "";

const ADMIN_USERNAME = "vitest-pipefile-admin";
const LIMITED_ADMIN_USERNAME = "vitest-pipefile-ladmin";
const LIMITED_USERNAME = "vitest-pipefile-limited";

const ENDPOINT = "/api/projects/pipeline-file";

async function generate(
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}${ENDPOINT}`, {
    method: "POST",
    headers: withCookie(cookie, { "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  await scrubTestUserFkRows();
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  const limitedAdmin = await provisionUser({
    username: LIMITED_ADMIN_USERNAME,
    role: "limited_admin",
  });
  limitedAdminUserId = limitedAdmin.id;
  const limited = await provisionUser({
    username: LIMITED_USERNAME,
    role: "limited",
  });
  limitedUserId = limited.id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedAdminCookie = await login(baseUrl, LIMITED_ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
});

afterAll(async () => {
  await db
    .delete(projectAssignmentsTable)
    .where(
      or(
        eq(projectAssignmentsTable.userId, limitedAdminUserId),
        eq(projectAssignmentsTable.assignedBy, adminUserId),
      ),
    );
  await db
    .delete(forksTable)
    .where(
      or(
        eq(forksTable.userId, limitedUserId),
        eq(forksTable.decidedBy, adminUserId),
      ),
    );
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await close();
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-pipefile-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  setCurrentProject(null, limitedAdminUserId);
  setCurrentProject(null, limitedUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function makeProjectAndLoadFor(
  userId: string,
  solutionName: string,
): Promise<Project> {
  const project = await createProject({
    solutionName,
    namespace: `${solutionName}.QA`,
  });
  setCurrentProject(project, userId);
  return project;
}

describe("POST /api/projects/pipeline-file — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await fetch(`${baseUrl}${ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "github", mode: "ci" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/projects/pipeline-file — admin happy path", () => {
  it("returns 201 and writes the pipeline file on first generation", async () => {
    const project = await makeProjectAndLoadFor(adminUserId, "PipeAdmin1");
    const res = await generate(adminCookie, {
      platform: "github",
      mode: "ci",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe(pipelineFilePath("github"));
    const written = await fs.readFile(
      path.join(project.rootPath, body.path),
      "utf8",
    );
    // The C# default scaffold should appear in the generated file.
    expect(written).toContain("actions/setup-dotnet@v4");
  });

  it("returns 409 with { exists: true, path } when the file already exists", async () => {
    await makeProjectAndLoadFor(adminUserId, "PipeAdmin2");
    const first = await generate(adminCookie, {
      platform: "jenkins",
      mode: "ci",
    });
    expect(first.status).toBe(201);

    const second = await generate(adminCookie, {
      platform: "jenkins",
      mode: "ci",
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { exists: boolean; path: string };
    expect(body.exists).toBe(true);
    expect(body.path).toBe(pipelineFilePath("jenkins"));
  });

  it("returns 201 on overwrite retry after a 409", async () => {
    const project = await makeProjectAndLoadFor(adminUserId, "PipeAdmin3");

    const first = await generate(adminCookie, {
      platform: "gitlab",
      mode: "ci",
    });
    expect(first.status).toBe(201);

    const conflict = await generate(adminCookie, {
      platform: "gitlab",
      mode: "ci",
    });
    expect(conflict.status).toBe(409);

    // Mutate the existing file so we can verify the overwrite actually
    // replaced contents (not just returned 201).
    const abs = path.join(project.rootPath, pipelineFilePath("gitlab"));
    await fs.writeFile(abs, "# stale\n");

    const overwrite = await generate(adminCookie, {
      platform: "gitlab",
      mode: "cd",
      overwrite: true,
    });
    expect(overwrite.status).toBe(201);
    const body = (await overwrite.json()) as { path: string };
    expect(body.path).toBe(pipelineFilePath("gitlab"));
    const written = await fs.readFile(abs, "utf8");
    expect(written).not.toContain("# stale");
    // CD mode should declare the build/test stage layout.
    expect(written).toContain("stages:\n  - build\n  - test");
  });

  it("returns 404 when no project is loaded for the caller", async () => {
    setCurrentProject(null, adminUserId);
    const res = await generate(adminCookie, {
      platform: "github",
      mode: "ci",
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/pipeline-file — body validation", () => {
  beforeEach(async () => {
    await makeProjectAndLoadFor(adminUserId, "PipeValidate");
  });

  it("returns 400 when platform is missing", async () => {
    const res = await generate(adminCookie, { mode: "ci" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when mode is missing", async () => {
    const res = await generate(adminCookie, { platform: "github" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when platform is not in the enum", async () => {
    const res = await generate(adminCookie, {
      platform: "bitbucket",
      mode: "ci",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when mode is not in the enum", async () => {
    const res = await generate(adminCookie, {
      platform: "github",
      mode: "deploy-prod",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/projects/pipeline-file — limited_admin", () => {
  it("returns 403 when limited_admin has no assignment to the loaded project", async () => {
    await makeProjectAndLoadFor(limitedAdminUserId, "PipeLAdminUnassigned");
    const res = await generate(limitedAdminCookie, {
      platform: "github",
      mode: "ci",
    });
    expect(res.status).toBe(403);
  });

  it("returns 201 when limited_admin is assigned to the loaded project", async () => {
    const project = await makeProjectAndLoadFor(
      limitedAdminUserId,
      "PipeLAdminAssigned",
    );
    await createAssignment({
      userId: limitedAdminUserId,
      projectName: project.solutionName,
      assignedBy: adminUserId,
    });
    const res = await generate(limitedAdminCookie, {
      platform: "azure",
      mode: "ci",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe(pipelineFilePath("azure"));
    const stat = await fs.stat(path.join(project.rootPath, body.path));
    expect(stat.isFile()).toBe(true);
  });
});

describe("POST /api/projects/pipeline-file — limited user", () => {
  it("returns 201 when the loaded project is the limited user's own active fork", async () => {
    // Materialize a real workspace project, fork it for the limited user,
    // and load that fork as their current project (mirroring what
    // /projects/load does after fork-ownership is verified).
    const project = await createProject({
      solutionName: "PipeLimitedFork",
      namespace: "PipeLimitedFork.QA",
    });
    const fork = await createFork({
      userId: limitedUserId,
      projectName: project.solutionName,
      decidedBy: adminUserId,
    });
    setCurrentProject(
      {
        solutionName: project.solutionName,
        testProjectName: project.testProjectName,
        namespace: project.namespace,
        rootPath: fork.forkPath,
        slnPath: path.join(fork.forkPath, `${project.solutionName}.sln`),
        language: project.language,
      },
      limitedUserId,
    );

    const res = await generate(limitedCookie, {
      platform: "circleci",
      mode: "cd",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe(pipelineFilePath("circleci"));
    // Verify the file was written into the user's fork directory, not
    // the main workspace project, so the test actually exercises the
    // per-user current-project resolution.
    const writtenInFork = await fs
      .stat(path.join(fork.forkPath, body.path))
      .catch(() => null);
    expect(writtenInFork?.isFile()).toBe(true);
    const writtenInMain = await fs
      .stat(path.join(project.rootPath, body.path))
      .catch(() => null);
    expect(writtenInMain).toBeNull();
  });

  it("returns 404 when the limited user has no project loaded", async () => {
    setCurrentProject(null, limitedUserId);
    const res = await generate(limitedCookie, {
      platform: "github",
      mode: "ci",
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 when the loaded project is not the limited user's active fork", async () => {
    // Set the limited user's current project directly to a main
    // workspace project they do not own a fork of. /projects/load
    // would have rejected this, but we set it via the internal helper
    // to verify the route's own authorization check (defense-in-depth)
    // independently of /projects/load.
    const project = await createProject({
      solutionName: "PipeLimitedNoFork",
      namespace: "PipeLimitedNoFork.QA",
    });
    setCurrentProject(project, limitedUserId);
    const res = await generate(limitedCookie, {
      platform: "github",
      mode: "ci",
    });
    expect(res.status).toBe(403);
    // And critically, no pipeline file gets written to the project.
    const written = await fs
      .stat(path.join(project.rootPath, pipelineFilePath("github")))
      .catch(() => null);
    expect(written).toBeNull();
  });

  it("returns 403 when the loaded project matches an unrelated user's fork (not the caller's)", async () => {
    // Set the limited user's current project to a fork directory owned
    // by someone else (here we just craft a fork-shaped path; what
    // matters is that listForksForUser(limitedUserId) does not include
    // this exact rootPath as an active fork).
    const project = await createProject({
      solutionName: "PipeLimitedOtherFork",
      namespace: "PipeLimitedOtherFork.QA",
    });
    // Hand-craft a project whose rootPath is in the forks/ tree but
    // belongs to a different username, so the ownership check rejects.
    const otherForkRoot = path.join(
      tmp,
      "forks",
      "someone-else",
      project.solutionName,
    );
    await fs.mkdir(otherForkRoot, { recursive: true });
    setCurrentProject(
      {
        solutionName: project.solutionName,
        testProjectName: project.testProjectName,
        namespace: project.namespace,
        rootPath: otherForkRoot,
        slnPath: path.join(otherForkRoot, `${project.solutionName}.sln`),
        language: project.language,
      },
      limitedUserId,
    );
    const res = await generate(limitedCookie, {
      platform: "github",
      mode: "ci",
    });
    expect(res.status).toBe(403);
  });
});
