/**
 * REST coverage for POST /api/selectors/heal — the Tier-2 Fix-selector
 * feature. Verifies:
 *
 *   1. Cross-recording rewrite. Two distinct RecordedAction sets that
 *      both reference `oldSelector` (one in `selector`, one in a wait's
 *      `waitSelector`) get rewritten in a single call. The DB rows are
 *      updated in place; the response counts (recordings, replacements)
 *      and `details` array reflect every site touched.
 *
 *   2. On-disk Selectors-file rewrite, per language. For each of
 *      C# / Python / Node.js / Java we scaffold a Selectors file that
 *      maps a key to the old value, run heal, and assert the literal
 *      string was replaced and the response's `fileDetails[]` lists
 *      the file with its key.
 *
 *   3. dryRun=true is a true preview: counts populated, but the DB
 *      rows AND the on-disk file are unchanged.
 *
 *   4. 400 when oldSelector === newSelector (server guard).
 *
 *   5. 401 with no session, 400 with no project loaded, 403 for an
 *      unassigned limited_admin (role gate).
 *
 *   6. The audit row is recorded ONLY for non-dry-run calls and ONLY
 *      when at least one site changed.
 */
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
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, recordedActionSetsTable, sharedStepsTable } from "@workspace/db";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";
import {
  setCurrentProject,
  type Project,
} from "@/features/projects/infrastructure/projectService";

vi.mock("@/features/audit/infrastructure/recordAudit", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    recordAudit: vi.fn().mockResolvedValue(undefined),
  };
});

import { recordAudit } from "@/features/audit/infrastructure/recordAudit";

let baseUrl: string;
let close: () => Promise<void>;
let adminCookie: string;
let limitedCookie: string;
let adminUserId = "";
let limitedUserId = "";

const ADMIN_USERNAME = "vitest-heal-admin";
const LIMITED_USERNAME = "vitest-heal-limited";
const PROJECT_NAME = "HealProj";
const TEST_PROJECT = "HealProj.Tests";
const NAMESPACE = "HealProj";

let tmp = "";

function makeProject(rootPath: string, language: Project["language"]): Project {
  return {
    solutionName: PROJECT_NAME,
    testProjectName: TEST_PROJECT,
    namespace: NAMESPACE,
    rootPath,
    slnPath: path.join(rootPath, `${PROJECT_NAME}.sln`),
    language,
  };
}

async function insertRecordingRow(
  rec: typeof recordedActionSetsTable.$inferInsert,
): Promise<void> {
  await db.insert(recordedActionSetsTable).values(rec);
}

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  adminUserId = (
    await provisionUser({ username: ADMIN_USERNAME, role: "admin" })
  ).id;
  limitedUserId = (
    await provisionUser({ username: LIMITED_USERNAME, role: "limited_admin" })
  ).id;
  adminCookie = await login(baseUrl, ADMIN_USERNAME);
  limitedCookie = await login(baseUrl, LIMITED_USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(ADMIN_USERNAME);
  await deleteUserByUsername(LIMITED_USERNAME);
  await close();
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "heal-"));
});

afterEach(async () => {
  setCurrentProject(null, adminUserId);
  setCurrentProject(null, limitedUserId);
  // Clean any rows left behind by a test.
  await db
    .delete(recordedActionSetsTable)
    .where(eq(recordedActionSetsTable.projectName, PROJECT_NAME));
  await db
    .delete(sharedStepsTable)
    .where(eq(sharedStepsTable.projectName, PROJECT_NAME));
  await fs.rm(tmp, { recursive: true, force: true });
  vi.mocked(recordAudit).mockClear();
});

describe("POST /api/selectors/heal — cross-recording DB rewrite", () => {
  it("rewrites `selector` AND `waitSelector` across multiple recordings owned by the user", async () => {
    setCurrentProject(makeProject(tmp, "csharp"), adminUserId);
    await insertRecordingRow({
      userId: adminUserId,
      projectName: PROJECT_NAME,
      filePath: "Tests/A.cs",
      kind: "testMethod",
      methodName: "A",
      urlName: "Login",
      startUrl: "https://example.com/login",
      actions: [
        { type: "click", selector: "[data-testid=submit]" },
        { type: "fill", selector: "[name=user]", value: "u" },
      ],
    });
    await insertRecordingRow({
      userId: adminUserId,
      projectName: PROJECT_NAME,
      filePath: "Tests/B.cs",
      kind: "testMethod",
      methodName: "B",
      urlName: "Login",
      startUrl: "https://example.com/login",
      actions: [
        { type: "click", selector: "[data-testid=submit]" },
        {
          type: "wait",
          waitKind: "selector",
          waitSelector: "[data-testid=submit]",
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/selectors/heal`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        oldSelector: "[data-testid=submit]",
        newSelector: "[data-testid=login-submit]",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalReplacements: number;
      recordingsChanged: number;
      details: Array<{ filePath: string; replacements: number }>;
    };
    // 1 selector hit in A + 1 selector + 1 waitSelector hit in B = 3.
    expect(body.totalReplacements).toBe(3);
    expect(body.recordingsChanged).toBe(2);
    expect(body.details.map((d) => d.filePath).sort()).toEqual([
      "Tests/A.cs",
      "Tests/B.cs",
    ]);

    // Persisted change — re-read both rows from the DB.
    const rows = await db
      .select()
      .from(recordedActionSetsTable)
      .where(eq(recordedActionSetsTable.projectName, PROJECT_NAME));
    const a = rows.find((r) => r.filePath === "Tests/A.cs")!;
    const b = rows.find((r) => r.filePath === "Tests/B.cs")!;
    const aActions = a.actions as Array<Record<string, unknown>>;
    const bActions = b.actions as Array<Record<string, unknown>>;
    expect(aActions[0]).toMatchObject({ selector: "[data-testid=login-submit]" });
    expect(bActions[0]).toMatchObject({ selector: "[data-testid=login-submit]" });
    expect(bActions[1]).toMatchObject({
      waitSelector: "[data-testid=login-submit]",
    });

    // Audit was recorded with the right action + counts.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const auditArg = vi.mocked(recordAudit).mock.calls[0]![0] as {
      action: string;
      details: Record<string, unknown>;
    };
    expect(auditArg.action).toBe("selector_heal");
    expect(auditArg.details.recordingsChanged).toBe(2);
    expect(auditArg.details.recordingReplacements).toBe(3);
  });

  it("dryRun=true previews counts without mutating DB rows AND without auditing", async () => {
    setCurrentProject(makeProject(tmp, "csharp"), adminUserId);
    await insertRecordingRow({
      userId: adminUserId,
      projectName: PROJECT_NAME,
      filePath: "Tests/Dry.cs",
      kind: "testMethod",
      methodName: "Dry",
      urlName: "Login",
      startUrl: "https://example.com/login",
      actions: [{ type: "click", selector: "#dry" }],
    });

    const res = await fetch(`${baseUrl}/api/selectors/heal`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        oldSelector: "#dry",
        newSelector: "#fixed",
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalReplacements: number;
      recordingsChanged: number;
    };
    expect(body.totalReplacements).toBe(1);
    expect(body.recordingsChanged).toBe(1);

    const [row] = await db
      .select()
      .from(recordedActionSetsTable)
      .where(eq(recordedActionSetsTable.projectName, PROJECT_NAME));
    // Untouched.
    const rowActions = row!.actions as Array<Record<string, unknown>>;
    expect(rowActions[0]).toMatchObject({ selector: "#dry" });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("POST /api/selectors/heal — on-disk Selectors file rewrite per language", () => {
  it("csharp: rewrites `public static readonly string Key = \"value\";` literals", async () => {
    setCurrentProject(makeProject(tmp, "csharp"), adminUserId);
    const dir = path.join(tmp, TEST_PROJECT, "PageObjects", "Selectors");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "LoginSelectors.cs");
    await fs.writeFile(
      file,
      'namespace HealProj.Tests {\n' +
        '  public static class LoginSelectors {\n' +
        '    public static readonly string Submit = "[data-testid=submit]";\n' +
        '  }\n' +
        '}\n',
    );

    const res = await fetch(`${baseUrl}/api/selectors/heal`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        oldSelector: "[data-testid=submit]",
        newSelector: "[data-testid=login-submit]",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      filesChanged: number;
      fileDetails: Array<{ filePath: string; keys: string[] }>;
    };
    expect(body.filesChanged).toBe(1);
    expect(body.fileDetails[0]!.keys).toContain("Submit");

    const after = await fs.readFile(file, "utf8");
    expect(after).toContain('"[data-testid=login-submit]"');
    expect(after).not.toContain('"[data-testid=submit]"');
  });

  it("python: rewrites `KEY = \"value\"` literals", async () => {
    setCurrentProject(makeProject(tmp, "python"), adminUserId);
    const dir = path.join(tmp, "pages", "selectors");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "login_selectors.py");
    await fs.writeFile(file, 'SUBMIT = "#submit"\nOTHER = "#other"\n');

    const res = await fetch(`${baseUrl}/api/selectors/heal`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ oldSelector: "#submit", newSelector: "#go" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      filesChanged: number;
      fileDetails: Array<{ keys: string[] }>;
    };
    expect(body.filesChanged).toBe(1);
    expect(body.fileDetails[0]!.keys).toContain("SUBMIT");

    const after = await fs.readFile(file, "utf8");
    expect(after).toContain('SUBMIT = "#go"');
    expect(after).toContain('OTHER = "#other"');
  });

  it("nodejs: rewrites `key: \"value\",` literals in pages/selectors/*.ts", async () => {
    setCurrentProject(makeProject(tmp, "nodejs"), adminUserId);
    const dir = path.join(tmp, "pages", "selectors");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "LoginSelectors.ts");
    await fs.writeFile(
      file,
      'export const LoginSelectors = {\n  submit: "#submit",\n  cancel: "#cancel",\n};\n',
    );

    const res = await fetch(`${baseUrl}/api/selectors/heal`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ oldSelector: "#submit", newSelector: "#go" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      filesChanged: number;
      fileDetails: Array<{ keys: string[] }>;
    };
    expect(body.filesChanged).toBe(1);
    expect(body.fileDetails[0]!.keys).toContain("submit");

    const after = await fs.readFile(file, "utf8");
    expect(after).toContain('submit: "#go"');
    expect(after).toContain('cancel: "#cancel"');
  });

  it("java: rewrites `public static final String key = \"value\";` literals", async () => {
    setCurrentProject(makeProject(tmp, "java"), adminUserId);
    // Java scaffold writes Selectors files under the Tests module's
    // src/test/java tree. We mirror the canonical layout and let the
    // healer's recursive walk find the file.
    const dir = path.join(
      tmp,
      TEST_PROJECT,
      "src",
      "test",
      "java",
      "healproj",
      "pages",
      "selectors",
    );
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "LoginSelectors.java");
    await fs.writeFile(
      file,
      'package healproj.pages.selectors;\n' +
        'public class LoginSelectors {\n' +
        '  public static final String submit = "#submit";\n' +
        '}\n',
    );

    const res = await fetch(`${baseUrl}/api/selectors/heal`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ oldSelector: "#submit", newSelector: "#go" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      filesChanged: number;
      fileDetails: Array<{ keys: string[] }>;
    };
    expect(body.filesChanged).toBe(1);
    expect(body.fileDetails[0]!.keys).toContain("submit");

    const after = await fs.readFile(file, "utf8");
    expect(after).toContain('"#go"');
    expect(after).not.toContain('"#submit"');
  });

  it("dryRun=true does NOT rewrite the on-disk file", async () => {
    setCurrentProject(makeProject(tmp, "csharp"), adminUserId);
    const dir = path.join(tmp, TEST_PROJECT, "PageObjects", "Selectors");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "DryRunSelectors.cs");
    const before =
      'public static class DryRunSelectors {\n' +
      '  public static readonly string Submit = "#dry";\n' +
      '}\n';
    await fs.writeFile(file, before);

    const res = await fetch(`${baseUrl}/api/selectors/heal`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({
        oldSelector: "#dry",
        newSelector: "#wet",
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { filesChanged: number };
    expect(body.filesChanged).toBe(1);
    const after = await fs.readFile(file, "utf8");
    expect(after).toBe(before);
  });
});

describe("POST /api/selectors/heal — guards", () => {
  it("400 when oldSelector === newSelector", async () => {
    setCurrentProject(makeProject(tmp, "csharp"), adminUserId);
    const res = await fetch(`${baseUrl}/api/selectors/heal`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ oldSelector: "#x", newSelector: "#x" }),
    });
    expect(res.status).toBe(400);
  });

  it("401 without a session", async () => {
    const res = await fetch(`${baseUrl}/api/selectors/heal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oldSelector: "#a", newSelector: "#b" }),
    });
    expect(res.status).toBe(401);
  });

  it("404 when no project is loaded", async () => {
    const res = await fetch(`${baseUrl}/api/selectors/heal`, {
      method: "POST",
      headers: withCookie(adminCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ oldSelector: "#a", newSelector: "#b" }),
    });
    // The shared requireAdminOrAssignedToCurrentProjectOrOwner guard
    // rejects with 404 ("No project loaded") before the route's own
    // 400 fallback runs.
    expect(res.status).toBe(404);
  });

  it("403 for an unassigned limited_admin", async () => {
    setCurrentProject(makeProject(tmp, "csharp"), limitedUserId);
    const res = await fetch(`${baseUrl}/api/selectors/heal`, {
      method: "POST",
      headers: withCookie(limitedCookie, { "content-type": "application/json" }),
      body: JSON.stringify({ oldSelector: "#a", newSelector: "#b" }),
    });
    expect(res.status).toBe(403);
  });
});
