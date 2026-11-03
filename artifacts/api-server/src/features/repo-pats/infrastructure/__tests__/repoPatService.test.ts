import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, like } from "drizzle-orm";
import {
  db,
  repoPatsTable,
  projectGitConfigsTable,
  usersTable,
} from "@workspace/db";
import { provisionUser, deleteUserByUsername } from "@/shared/test-helpers";
import { decryptSecret, encryptSecret } from "@/shared/crypto";
import {
  createRepoPat,
  updateRepoPat,
  deleteRepoPat,
  listRepoPats,
  getRepoPat,
  findBoundProjectsForRepoPat,
} from "@/features/repo-pats/infrastructure/repoPatService";

process.env.PROJECT_SECRETS_KEY ??=
  "vitest-repo-pats-secret-xxxxxxxxxxxxxxxx";

const PREFIX = "vitest-repopat-";
const ADMIN = `${PREFIX}admin`;

let adminId = "";

async function scrub(): Promise<void> {
  await db
    .delete(projectGitConfigsTable)
    .where(like(projectGitConfigsTable.projectName, `${PREFIX}%`));
  await db.delete(repoPatsTable).where(like(repoPatsTable.name, `${PREFIX}%`));
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
}

beforeAll(async () => {
  await scrub();
  const u = await provisionUser({ username: ADMIN, role: "admin" });
  adminId = u.id;
});

afterAll(async () => {
  await scrub();
  await deleteUserByUsername(ADMIN);
});

beforeEach(async () => {
  await db
    .delete(projectGitConfigsTable)
    .where(like(projectGitConfigsTable.projectName, `${PREFIX}%`));
  await db.delete(repoPatsTable).where(like(repoPatsTable.name, `${PREFIX}%`));
});

describe("repoPatService.createRepoPat", () => {
  it("creates a PAT, encrypts at rest, and exposes only last four", async () => {
    const plaintext = "azpat-supersecret-1234ABCD";
    const created = await createRepoPat({
      provider: "azure_repos",
      name: `${PREFIX}shared-1`,
      pat: plaintext,
      userId: adminId,
    });

    expect(created.provider).toBe("azure_repos");
    expect(created.name).toBe(`${PREFIX}shared-1`);
    expect(created.patLastFour).toBe("ABCD");
    // The public shape must never include the encrypted/plaintext PAT.
    const j = JSON.stringify(created);
    expect(j).not.toContain(plaintext);
    expect(j).not.toContain("patEncrypted");

    const [row] = await db
      .select()
      .from(repoPatsTable)
      .where(eq(repoPatsTable.id, created.id));
    expect(row).toBeTruthy();
    // Stored value is ciphertext, not the plaintext.
    expect(row!.patEncrypted).not.toBe(plaintext);
    expect(decryptSecret(row!.patEncrypted)).toBe(plaintext);
  });

  it("rejects an unsupported provider", async () => {
    await expect(
      createRepoPat({
        provider: "gitlab",
        name: `${PREFIX}x`,
        pat: "12345678",
        userId: adminId,
      }),
    ).rejects.toThrow(/Unsupported git provider/);
  });

  it("rejects an empty name", async () => {
    await expect(
      createRepoPat({
        provider: "github",
        name: "   ",
        pat: "12345678",
        userId: adminId,
      }),
    ).rejects.toThrow(/Name is required/);
  });

  it("rejects a too-short PAT", async () => {
    await expect(
      createRepoPat({
        provider: "github",
        name: `${PREFIX}short`,
        pat: "abc",
        userId: adminId,
      }),
    ).rejects.toThrow(/too short/);
  });

  it("rejects a duplicate (provider, name) pair", async () => {
    await createRepoPat({
      provider: "azure_repos",
      name: `${PREFIX}dup`,
      pat: "abcdefgh",
      userId: adminId,
    });
    await expect(
      createRepoPat({
        provider: "azure_repos",
        name: `${PREFIX}dup`,
        pat: "abcdefgh",
        userId: adminId,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("allows the same name across providers", async () => {
    await createRepoPat({
      provider: "azure_repos",
      name: `${PREFIX}same`,
      pat: "abcdefgh",
      userId: adminId,
    });
    const second = await createRepoPat({
      provider: "github",
      name: `${PREFIX}same`,
      pat: "abcdefgh",
      userId: adminId,
    });
    expect(second.provider).toBe("github");
  });
});

describe("repoPatService.updateRepoPat", () => {
  it("rotates the encrypted PAT when a new value is provided", async () => {
    const r = await createRepoPat({
      provider: "azure_repos",
      name: `${PREFIX}rot`,
      pat: "originalAAAA",
      userId: adminId,
    });
    expect(r.patLastFour).toBe("AAAA");
    const updated = await updateRepoPat({
      id: r.id,
      provider: "azure_repos",
      name: `${PREFIX}rot`,
      pat: "rotatedZZZZ",
      userId: adminId,
    });
    expect(updated.patLastFour).toBe("ZZZZ");
    const [row] = await db
      .select()
      .from(repoPatsTable)
      .where(eq(repoPatsTable.id, r.id));
    expect(decryptSecret(row!.patEncrypted)).toBe("rotatedZZZZ");
  });

  it("keeps the existing encrypted PAT when pat=null", async () => {
    const r = await createRepoPat({
      provider: "azure_repos",
      name: `${PREFIX}keep`,
      pat: "keepmeplease",
      userId: adminId,
    });
    const before = await db
      .select()
      .from(repoPatsTable)
      .where(eq(repoPatsTable.id, r.id));
    const updated = await updateRepoPat({
      id: r.id,
      provider: "github",
      name: `${PREFIX}keep-renamed`,
      pat: null,
      userId: adminId,
    });
    expect(updated.provider).toBe("github");
    expect(updated.name).toBe(`${PREFIX}keep-renamed`);
    expect(updated.patLastFour).toBe(before[0]!.patLastFour);
    const after = await db
      .select()
      .from(repoPatsTable)
      .where(eq(repoPatsTable.id, r.id));
    expect(after[0]!.patEncrypted).toBe(before[0]!.patEncrypted);
  });

  it("rejects renaming onto another PAT (same provider+name)", async () => {
    const a = await createRepoPat({
      provider: "azure_repos",
      name: `${PREFIX}a`,
      pat: "abcdefgh",
      userId: adminId,
    });
    await createRepoPat({
      provider: "azure_repos",
      name: `${PREFIX}b`,
      pat: "abcdefgh",
      userId: adminId,
    });
    await expect(
      updateRepoPat({
        id: a.id,
        provider: "azure_repos",
        name: `${PREFIX}b`,
        pat: null,
        userId: adminId,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("throws when the row is missing", async () => {
    await expect(
      updateRepoPat({
        id: "00000000-0000-0000-0000-000000000000",
        provider: "github",
        name: `${PREFIX}ghost`,
        pat: null,
        userId: adminId,
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe("repoPatService.deleteRepoPat", () => {
  it("deletes an unbound PAT", async () => {
    const r = await createRepoPat({
      provider: "github",
      name: `${PREFIX}del`,
      pat: "abcdefgh",
      userId: adminId,
    });
    const out = await deleteRepoPat(r.id);
    expect(out).toEqual({ deleted: true, boundProjects: [] });
    expect(await getRepoPat(r.id)).toBeNull();
  });

  it("refuses to delete a PAT bound to a project_git_configs row", async () => {
    const r = await createRepoPat({
      provider: "azure_repos",
      name: `${PREFIX}bound`,
      pat: "abcdefgh",
      userId: adminId,
    });
    await db.insert(projectGitConfigsTable).values({
      projectName: `${PREFIX}proj`,
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/o/p/_git/r",
      branch: "main",
      patEncrypted: null,
      patLastFour: null,
      patSetAt: null,
      repoPatId: r.id,
      updatedByUserId: adminId,
    });

    const bound = await findBoundProjectsForRepoPat(r.id);
    expect(bound).toEqual([`${PREFIX}proj`]);

    const out = await deleteRepoPat(r.id);
    expect(out.deleted).toBe(false);
    expect(out.boundProjects).toEqual([`${PREFIX}proj`]);
    // Row must still exist.
    expect(await getRepoPat(r.id)).not.toBeNull();
  });
});

describe("repoPatService.listRepoPats", () => {
  it("orders by (provider, name) and excludes plaintext", async () => {
    await createRepoPat({
      provider: "github",
      name: `${PREFIX}zzz`,
      pat: "abcdefgh",
      userId: adminId,
    });
    await createRepoPat({
      provider: "azure_repos",
      name: `${PREFIX}aaa`,
      pat: encryptSecret("ignored-marker") + "moreXXXX",
      userId: adminId,
    });
    const all = (await listRepoPats()).filter((p) =>
      p.name.startsWith(PREFIX),
    );
    const ordered = all.map((p) => `${p.provider}:${p.name}`);
    expect(ordered).toEqual([
      `azure_repos:${PREFIX}aaa`,
      `github:${PREFIX}zzz`,
    ]);
    expect(JSON.stringify(all)).not.toContain("patEncrypted");
  });
});
