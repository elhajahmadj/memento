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
import https from "node:https";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, like } from "drizzle-orm";
import {
  db,
  projectGitConfigsTable,
  usersTable,
} from "@workspace/db";
import { provisionUser, deleteUserByUsername } from "@/shared/test-helpers";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import { encryptSecret } from "@/shared/crypto";

/**
 * Service-level integration coverage for the `auth_failed` classification
 * end-to-end through {@link pullProject} / {@link pushProject}.
 *
 * The dev-mode `file://` remote used by most other gitConfigService tests
 * cannot reproduce a real HTTPS 401/403 from Azure Repos or GitHub, so
 * the `auth_failed` branch of `classifyGitError` / `classifyPushError`
 * was previously only covered indirectly through unit tests over fixed
 * stderr strings. This suite drives the real `git` CLI against two
 * loopback fixtures:
 *
 *   1. A plain-HTTP server that returns `401 Unauthorized` (covers both
 *      providers and both operations — the bulk of the matrix).
 *   2. A real HTTPS server with a self-signed cert that also returns
 *      `401 Unauthorized` (covers the production transport: git uses
 *      libcurl + OpenSSL on the HTTPS path, which is a different code
 *      path than plain HTTP). `GIT_SSL_NO_VERIFY=true` is set on the
 *      git child process so the self-signed cert is accepted; the
 *      assertion is still that the 401 surfaces as `auth_failed`.
 *
 * The matching API/UI coverage already exists:
 *   - Route layer: `gitConfig.routes.test.ts` runs the same HTTP-401
 *     fixture through `POST /git-config/{pull,push}` and asserts the
 *     `errorCode: "auth_failed"` JSON contract the UI's toast handler
 *     reads.
 *   - UX layer: `memento-ux-tests/.../GitReposSettingsTests.cs`
 *     (`Pull_against_auth_rejecting_remote_shows_auth_failed_toast` and
 *     `Push_against_auth_rejecting_remote_records_failed_audit_row`)
 *     drives the same fixture from Playwright via
 *     `LocalAuthFailingHttpServer`. The previously skipped
 *     `Pull_with_bad_pat_shows_auth_failed_toast` no longer exists —
 *     it was replaced by those two tests in an earlier commit.
 */

process.env.PROJECT_SECRETS_KEY ??=
  "vitest-git-auth-failure-secret-xxxxxxxxxxxx";

const { pullProject, pushProject } = await import(
  "@/features/projects/infrastructure/gitConfigService"
);

const PREFIX = "vitest-gitauthfail-";
const ADMIN_USERNAME = `${PREFIX}admin`;

let adminUserId = "";
let workspaceTmp: string;
let originalWorkspace: string;
let httpServer: http.Server;
let httpsServer: https.Server;
let httpUrlBase: string;
let httpsUrlBase: string;
let certTmpDir: string;
let originalGitSslNoVerify: string | undefined;

function authFailingHandler(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="git"',
    "Content-Type": "text/plain",
  });
  res.end("Authentication failed");
}

async function startHttpAuthFailingServer(): Promise<void> {
  httpServer = http.createServer(authFailingHandler);
  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = httpServer.address() as AddressInfo;
  httpUrlBase = `http://127.0.0.1:${port}`;
}

/**
 * Generate a throwaway self-signed RSA cert via the system `openssl`
 * binary (already used elsewhere in the repo's nix pin). Returns the
 * PEM-encoded private key + cert. Kept self-contained so the test
 * doesn't take a new npm dependency just for cert minting.
 */
function generateSelfSignedCert(): { key: Buffer; cert: Buffer } {
  const dir = certTmpDir;
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  const r = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "pipe" },
  );
  if (r.status !== 0) {
    throw new Error(
      `openssl failed (${r.status}): ${r.stderr?.toString() ?? ""}`,
    );
  }
  return {
    key: fsSync.readFileSync(keyPath),
    cert: fsSync.readFileSync(certPath),
  };
}

async function startHttpsAuthFailingServer(): Promise<void> {
  certTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rec-gitauthfail-tls-"));
  const { key, cert } = generateSelfSignedCert();
  httpsServer = https.createServer({ key, cert }, authFailingHandler);
  await new Promise<void>((resolve) =>
    httpsServer.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = httpsServer.address() as AddressInfo;
  httpsUrlBase = `https://127.0.0.1:${port}`;
}

async function insertGitConfig(args: {
  projectName: string;
  repoUrl: string;
  branch: string;
  provider?: "azure_repos" | "github";
}): Promise<void> {
  const pat = "test-pat-token-1234";
  await db
    .delete(projectGitConfigsTable)
    .where(eq(projectGitConfigsTable.projectName, args.projectName));
  await db.insert(projectGitConfigsTable).values({
    projectName: args.projectName,
    provider: args.provider ?? "azure_repos",
    repoUrl: args.repoUrl,
    branch: args.branch,
    patEncrypted: encryptSecret(pat),
    patLastFour: pat.slice(-4),
    patSetAt: new Date(),
    updatedByUserId: adminUserId,
  });
}

async function makeProjectOnDisk(name: string): Promise<void> {
  await createProject({ solutionName: name, namespace: `${name}.QA` });
}

beforeAll(async () => {
  // Wipe dependents before the users themselves: previous runs may
  // have left `project_git_configs` rows pointing at one of our
  // throwaway admins through `updated_by_user_id`, and the FK is
  // `ON DELETE RESTRICT`. Deleting the configs first lets the user
  // delete succeed even against a dirty database.
  await db
    .delete(projectGitConfigsTable)
    .where(like(projectGitConfigsTable.projectName, "GitAuthFail%"));
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  await startHttpAuthFailingServer();
  await startHttpsAuthFailingServer();
  // The HTTPS fixture uses a self-signed cert; tell git (via libcurl)
  // to skip cert verification for the duration of the suite. The
  // assertion is still that an HTTP 401 surfaces as `auth_failed`,
  // not that TLS verification was bypassed.
  originalGitSslNoVerify = process.env.GIT_SSL_NO_VERIFY;
  process.env.GIT_SSL_NO_VERIFY = "true";
}, 30_000);

afterAll(async () => {
  // Guard each close: when `beforeAll` fails partway through (e.g. a
  // dirty-db FK violation before the servers are started), these
  // handles can be undefined. Without the guard the afterAll itself
  // crashes with `Cannot read properties of undefined (reading 'close')`,
  // masking the real beforeAll error behind a misleading second failure.
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
  if (httpsServer) {
    await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
  }
  if (certTmpDir) {
    await fs.rm(certTmpDir, { recursive: true, force: true });
  }
  if (originalGitSslNoVerify === undefined) {
    delete process.env.GIT_SSL_NO_VERIFY;
  } else {
    process.env.GIT_SSL_NO_VERIFY = originalGitSslNoVerify;
  }
  await deleteUserByUsername(ADMIN_USERNAME);
}, 30_000);

beforeEach(async () => {
  workspaceTmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-gitauthfail-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = workspaceTmp;
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(workspaceTmp, { recursive: true, force: true });
  await db
    .delete(projectGitConfigsTable)
    .where(like(projectGitConfigsTable.projectName, "GitAuthFail%"));
});

describe("gitConfigService against an auth-rejecting HTTP remote (401)", () => {
  it("pullProject surfaces auth_failed when the remote returns 401 (azure_repos)", async () => {
    const projectName = "GitAuthFailPullAzure";
    await makeProjectOnDisk(projectName);
    await insertGitConfig({
      projectName,
      repoUrl: `${httpUrlBase}/azure/repo.git`,
      branch: "main",
      provider: "azure_repos",
    });

    const result = await pullProject(projectName, adminUserId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("auth_failed");
    expect(result.message).toMatch(/authentication failed/i);
    // The PAT must never appear in the user-facing message.
    expect(result.message).not.toContain("test-pat-token-1234");
  });

  it("pullProject surfaces auth_failed when the remote returns 401 (github)", async () => {
    const projectName = "GitAuthFailPullGithub";
    await makeProjectOnDisk(projectName);
    await insertGitConfig({
      projectName,
      repoUrl: `${httpUrlBase}/owner/repo.git`,
      branch: "main",
      provider: "github",
    });

    const result = await pullProject(projectName, adminUserId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("auth_failed");
  });

  it("pushProject surfaces auth_failed when the remote returns 401 (azure_repos)", async () => {
    const projectName = "GitAuthFailPushAzure";
    await makeProjectOnDisk(projectName);
    await insertGitConfig({
      projectName,
      repoUrl: `${httpUrlBase}/azure/repo.git`,
      branch: "main",
      provider: "azure_repos",
    });

    const result = await pushProject(
      projectName,
      "attempted commit",
      adminUserId,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("auth_failed");
    expect(result.message).not.toContain("test-pat-token-1234");
  });

  it("pushProject surfaces auth_failed when the remote returns 401 (github)", async () => {
    const projectName = "GitAuthFailPushGithub";
    await makeProjectOnDisk(projectName);
    await insertGitConfig({
      projectName,
      repoUrl: `${httpUrlBase}/owner/repo.git`,
      branch: "main",
      provider: "github",
    });

    const result = await pushProject(
      projectName,
      "attempted commit",
      adminUserId,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("auth_failed");
  });
});

describe("gitConfigService against an auth-rejecting HTTPS remote (401, self-signed cert)", () => {
  it("pullProject surfaces auth_failed when an HTTPS remote returns 401 (azure_repos)", async () => {
    const projectName = "GitAuthFailPullHttpsAzure";
    await makeProjectOnDisk(projectName);
    await insertGitConfig({
      projectName,
      repoUrl: `${httpsUrlBase}/azure/repo.git`,
      branch: "main",
      provider: "azure_repos",
    });

    const result = await pullProject(projectName, adminUserId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("auth_failed");
    expect(result.message).not.toContain("test-pat-token-1234");
  });

  it("pullProject surfaces auth_failed when an HTTPS remote returns 401 (github)", async () => {
    const projectName = "GitAuthFailPullHttpsGithub";
    await makeProjectOnDisk(projectName);
    await insertGitConfig({
      projectName,
      repoUrl: `${httpsUrlBase}/owner/repo.git`,
      branch: "main",
      provider: "github",
    });

    const result = await pullProject(projectName, adminUserId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("auth_failed");
  });

  it("pushProject surfaces auth_failed when an HTTPS remote returns 401 (azure_repos)", async () => {
    const projectName = "GitAuthFailPushHttpsAzure";
    await makeProjectOnDisk(projectName);
    await insertGitConfig({
      projectName,
      repoUrl: `${httpsUrlBase}/azure/repo.git`,
      branch: "main",
      provider: "azure_repos",
    });

    const result = await pushProject(
      projectName,
      "attempted commit",
      adminUserId,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("auth_failed");
    expect(result.message).not.toContain("test-pat-token-1234");
  });

  it("pushProject surfaces auth_failed when an HTTPS remote returns 401 (github)", async () => {
    const projectName = "GitAuthFailPushHttpsGithub";
    await makeProjectOnDisk(projectName);
    await insertGitConfig({
      projectName,
      repoUrl: `${httpsUrlBase}/owner/repo.git`,
      branch: "main",
      provider: "github",
    });

    const result = await pushProject(
      projectName,
      "attempted commit",
      adminUserId,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("auth_failed");
  });
});
