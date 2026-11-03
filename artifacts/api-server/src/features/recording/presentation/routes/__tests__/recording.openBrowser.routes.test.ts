import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Mock playwright so the open-browser route tests below never spawn a
// real chromium browser. Same shape as `recording.lifecycle.routes.test.ts`.
const mocks = vi.hoisted(() => {
  const page = {
    mouse: { click: vi.fn().mockResolvedValue(undefined) },
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    goto: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    mainFrame: () => ({ url: () => "" }),
    url: vi.fn().mockReturnValue("https://example.com/"),
    locator: vi.fn().mockReturnValue({ first: () => ({ fill: vi.fn() }) }),
    screenshot: vi
      .fn()
      .mockImplementation(() => new Promise(() => undefined)),
    route: vi.fn().mockResolvedValue(undefined),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    exposeBinding: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, context, page };
});

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mocks.browser) },
}));

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
import { shutdown } from "@/features/recording/infrastructure/recordingService";
import { generateTestClass } from "@/features/codegen/infrastructure/codegenAdapter";
type Language = "csharp" | "python" | "nodejs" | "java";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let tmp: string;
let originalWorkspace: string;
let adminUserId = "";

const ADMIN_USERNAME = "vitest-openbrowser-admin";

/**
 * Recursively snapshot every regular file under `root` so a follow-up
 * assertion can prove the on-disk bytes are unchanged. Returns a map
 * keyed by project-relative path → file contents (as a Buffer).
 */
async function snapshotTree(root: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else if (e.isFile()) {
        out.set(path.relative(root, abs), await fs.readFile(abs));
      }
    }
  }
  await walk(root);
  return out;
}

/**
 * Filter a tree snapshot down to the two "named-URL store" files the
 * task pins as byte-identical: `appsettings.json` (C# / Java) and
 * `.env` (Python / Node.js). Returns an empty map when neither file
 * is present in the snapshot, which is a valid state too — the open-
 * browser flow must not CREATE one either.
 */
function namedUrlStoreFiles(snap: Map<string, Buffer>): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const [rel, buf] of snap) {
    const base = path.basename(rel);
    if (base === "appsettings.json" || base === ".env") {
      out.set(rel, buf);
    }
  }
  return out;
}

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  const admin = await provisionUser({
    username: ADMIN_USERNAME,
    role: "admin",
  });
  adminUserId = admin.id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await close();
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-openbrowser-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
});

afterEach(async () => {
  await shutdown().catch(() => {});
  setCurrentProject(null, adminUserId);
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("POST /api/recording/open-browser → /attach-to-open-browser → /cancel-open-browser", () => {
  it("opens a browser and returns RecordingStatus with the open-browser flag (admin happy path)", async () => {
    const project = await createProject({
      solutionName: "OpenBrowserA",
      namespace: "OpenBrowserA.QA",
    });
    setCurrentProject(project, adminUserId);
    const res = await fetch(`${baseUrl}/api/recording/open-browser`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ url: "https://example.com/login" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active: boolean; phase?: string };
    expect(body.active).toBe(true);
    // Single-flight: a second open while the first is still alive
    // must fail (mirrors the start route's behavior).
    const second = await fetch(`${baseUrl}/api/recording/open-browser`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ url: "https://example.com/" }),
    });
    expect(second.status).toBe(400);
  });

  it("attaches an open-browser session to an existing test class (happy path)", async () => {
    const project = await createProject({
      solutionName: "OpenBrowserAttach",
      namespace: "OpenBrowserAttach.QA",
    });
    setCurrentProject(project, adminUserId);
    // Seed a fake existing test class file under the project root so
    // the attach route's on-disk check passes.
    const relSuite = path.join("Tests", "AttachSuite.cs");
    const abs = path.join(project.rootPath, relSuite);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, "// seeded\n");

    await fetch(`${baseUrl}/api/recording/open-browser`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ url: "https://example.com/" }),
    });
    const res = await fetch(
      `${baseUrl}/api/recording/attach-to-open-browser`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          existingTestClassPath: relSuite,
          methodName: "AttachedMethod",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active: boolean };
    expect(body.active).toBe(true);
  });

  it("cancels an open-browser session and tears it down", async () => {
    const project = await createProject({
      solutionName: "OpenBrowserCancel",
      namespace: "OpenBrowserCancel.QA",
    });
    setCurrentProject(project, adminUserId);
    await fetch(`${baseUrl}/api/recording/open-browser`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ url: "https://example.com/" }),
    });
    const cancel = await fetch(
      `${baseUrl}/api/recording/cancel-open-browser`,
      {
        method: "POST",
        headers: withCookie(adminCookie),
      },
    );
    expect(cancel.status).toBe(200);
    const cancelBody = (await cancel.json()) as { canceled: boolean };
    expect(cancelBody.canceled).toBe(true);
    // After cancel the session is gone — a follow-up cancel is a
    // no-op returning canceled:false.
    const second = await fetch(
      `${baseUrl}/api/recording/cancel-open-browser`,
      {
        method: "POST",
        headers: withCookie(adminCookie),
      },
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { canceled: boolean };
    expect(secondBody.canceled).toBe(false);
  });

  it("rejects attach with suiteMode='new' (400) — attach forces existing", async () => {
    const project = await createProject({
      solutionName: "OpenBrowserRejectNew",
      namespace: "OpenBrowserRejectNew.QA",
    });
    setCurrentProject(project, adminUserId);
    await fetch(`${baseUrl}/api/recording/open-browser`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ url: "https://example.com/" }),
    });
    const res = await fetch(
      `${baseUrl}/api/recording/attach-to-open-browser`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          suiteMode: "new",
          existingTestClassPath: "Tests/X.cs",
          methodName: "M",
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects attach with target≠'testMethod' (400)", async () => {
    const project = await createProject({
      solutionName: "OpenBrowserRejectTarget",
      namespace: "OpenBrowserRejectTarget.QA",
    });
    setCurrentProject(project, adminUserId);
    await fetch(`${baseUrl}/api/recording/open-browser`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ url: "https://example.com/" }),
    });
    const res = await fetch(
      `${baseUrl}/api/recording/attach-to-open-browser`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          target: "testClass",
          existingTestClassPath: "Tests/X.cs",
          methodName: "M",
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("rejects attach when the existing test class file is missing (404)", async () => {
    const project = await createProject({
      solutionName: "OpenBrowserMissing",
      namespace: "OpenBrowserMissing.QA",
    });
    setCurrentProject(project, adminUserId);
    await fetch(`${baseUrl}/api/recording/open-browser`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ url: "https://example.com/" }),
    });
    const res = await fetch(
      `${baseUrl}/api/recording/attach-to-open-browser`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          existingTestClassPath: "Tests/DoesNotExist.cs",
          methodName: "M",
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("rejects attach when only one of categoryConstantName/categoryValue is set (400 both-or-neither)", async () => {
    const project = await createProject({
      solutionName: "OpenBrowserCatHalf",
      namespace: "OpenBrowserCatHalf.QA",
    });
    setCurrentProject(project, adminUserId);
    const relSuite = path.join("Tests", "CatHalfSuite.cs");
    const abs = path.join(project.rootPath, relSuite);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, "// seeded\n");
    await fetch(`${baseUrl}/api/recording/open-browser`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ url: "https://example.com/" }),
    });
    // Only the name is supplied — the value is missing. Mirrors the
    // start route's both-or-neither category check.
    const res = await fetch(
      `${baseUrl}/api/recording/attach-to-open-browser`,
      {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          existingTestClassPath: relSuite,
          methodName: "M",
          categoryConstantName: "Smoke",
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it.each<[Language]>([["csharp"], ["python"], ["nodejs"], ["java"]])(
    "open-browser → attach → finalize leaves appsettings.json / .env byte-identical for %s",
    async (language) => {
      // Per-language project root + seeded suite file. The point of
      // this test is that the open-browser start path skips
      // upsertNamedUrl and finalize skips regenerateTestConfig + the
      // goto header line — so whatever named-URL store file shipped
      // with the scaffold is byte-identical at the end.
      const project = await createProject({
        solutionName: `OpenBrowserBytes${language.charAt(0).toUpperCase()}${language.slice(1)}`,
        namespace: `OpenBrowserBytes.QA`,
        language,
      });
      setCurrentProject(project, adminUserId);

      const beforeStore = namedUrlStoreFiles(
        await snapshotTree(project.rootPath),
      );

      // Seed a real existing test class using the per-language codegen
      // adapter. Attach requires `existingTestClassPath` to resolve to a
      // file the codegen recognises as a test fixture, so we let the
      // adapter author it instead of hand-rolling syntax for four
      // languages.
      const seededRel = await generateTestClass(project, "OpenBrowserSeed");

      const open = await fetch(`${baseUrl}/api/recording/open-browser`, {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ url: "https://example.com/login" }),
      });
      expect(open.status).toBe(200);

      // After /open-browser alone, the named-URL store must already be
      // untouched. This proves the start path skipped upsertNamedUrl.
      const afterOpenStore = namedUrlStoreFiles(
        await snapshotTree(project.rootPath),
      );
      expect(afterOpenStore.size).toBe(beforeStore.size);
      for (const [rel, buf] of beforeStore) {
        expect(afterOpenStore.get(rel)?.equals(buf)).toBe(true);
      }

      // Real attach → finalize. The point is to prove that the
      // open-browser-originated finalize path skips regenerateTestConfig
      // and the goto-header line, so the named-URL store stays
      // byte-identical end-to-end (not just up to cancel).
      const attach = await fetch(
        `${baseUrl}/api/recording/attach-to-open-browser`,
        {
          method: "POST",
          headers: withCookie(adminCookie, {
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            existingTestClassPath: seededRel,
            methodName: "AttachedMethod",
          }),
        },
      );
      expect(attach.status).toBe(200);

      await fetch(`${baseUrl}/api/recording/stop`, {
        method: "POST",
        headers: withCookie(adminCookie),
      });
      const finalizeRes = await fetch(`${baseUrl}/api/recording/finalize`, {
        method: "POST",
        headers: withCookie(adminCookie, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ mode: "save" }),
      });
      expect(finalizeRes.status).toBe(200);

      const afterFinalizeStore = namedUrlStoreFiles(
        await snapshotTree(project.rootPath),
      );
      expect(afterFinalizeStore.size).toBe(beforeStore.size);
      for (const [rel, buf] of beforeStore) {
        expect(afterFinalizeStore.get(rel)?.equals(buf)).toBe(true);
      }
    },
    60_000,
  );
});
