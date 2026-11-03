/**
 * Unit / integration tests for the per-user personal fork service
 * (task #58 coverage). Runs against the real Postgres test database
 * because the service is a thin Drizzle wrapper — the value is in
 * proving CRUD + encryption + cross-user isolation behave correctly,
 * not in mocking the DB.
 *
 * Covers:
 *   - CRUD: getMyFork / upsertMyFork / deleteMyFork
 *   - Encryption: stored PAT is opaque on the row, decryptable via
 *     loadMyForkForPush, and only the last four leak via toPublic.
 *   - Redaction: getMyFork never returns the plaintext PAT or the
 *     encrypted blob — only `patLastFour` and `patSetAt`.
 *   - User isolation: user A's read/write/delete cannot touch user B's
 *     row for the same project name.
 *   - Validation: bad provider, short PAT, missing PAT on first save,
 *     and validateRepoUrl error propagation.
 *   - Branch-name validation rules used by the push-target / branch
 *     flow (validateBranchName).
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db, userProjectForksTable, usersTable } from "@workspace/db";
import { provisionUser, deleteUserByUsername } from "@/shared/test-helpers";

// PROJECT_SECRETS_KEY must be set BEFORE the service is imported.
process.env.PROJECT_SECRETS_KEY ??=
  "vitest-user-fork-service-secret-xxxxxxxxxxxxxxxx";

const {
  getMyFork,
  upsertMyFork,
  deleteMyFork,
  loadMyForkForPush,
} = await import(
  "@/features/projects/infrastructure/userProjectForkService"
);
const { validateBranchName } = await import(
  "@/features/projects/infrastructure/gitConfigService"
);

const PREFIX = "vitest-upfork-";
const USER_A = `${PREFIX}alice`;
const USER_B = `${PREFIX}bob`;
const PROJECT = `${PREFIX}Project`;

let userAId = "";
let userBId = "";

async function scrubForks(): Promise<void> {
  await db
    .delete(userProjectForksTable)
    .where(like(userProjectForksTable.projectName, `${PREFIX}%`));
}

beforeAll(async () => {
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
  const a = await provisionUser({ username: USER_A, role: "limited" });
  const b = await provisionUser({ username: USER_B, role: "limited" });
  userAId = a.id;
  userBId = b.id;
});

afterAll(async () => {
  await scrubForks();
  await deleteUserByUsername(USER_A);
  await deleteUserByUsername(USER_B);
});

beforeEach(scrubForks);

describe("userProjectForkService.getMyFork", () => {
  it("returns an empty payload for a user/project that has never saved a fork", async () => {
    const fork = await getMyFork(userAId, PROJECT);
    expect(fork).toEqual({
      configured: false,
      provider: null,
      repoUrl: null,
      patSetAt: null,
      patLastFour: null,
    });
  });
});

describe("userProjectForkService.upsertMyFork (create)", () => {
  it("creates a row, stores the PAT encrypted, and returns only the last four", async () => {
    const result = await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/me/myproj/_git/myfork",
      pat: "personal-pat-1234-WXYZ",
    });
    expect(result.configured).toBe(true);
    expect(result.provider).toBe("azure_repos");
    expect(result.repoUrl).toBe(
      "https://dev.azure.com/me/myproj/_git/myfork",
    );
    expect(result.patLastFour).toBe("WXYZ");
    expect(result.patSetAt).not.toBeNull();

    // The public payload must never leak plaintext or the encrypted blob.
    const text = JSON.stringify(result);
    expect(text).not.toContain("personal-pat-1234-WXYZ");
    expect(text).not.toContain("patEncrypted");

    // The stored row must hold an encrypted blob (not the plaintext).
    const [row] = await db
      .select()
      .from(userProjectForksTable)
      .where(
        and(
          eq(userProjectForksTable.userId, userAId),
          eq(userProjectForksTable.projectName, PROJECT),
        ),
      );
    expect(row).toBeTruthy();
    expect(row!.patEncrypted).not.toContain("personal-pat-1234-WXYZ");
    expect(row!.patEncrypted.length).toBeGreaterThan(20);
    expect(row!.patLastFour).toBe("WXYZ");
  });

  it("normalizes a github provider URL through validateRepoUrl", async () => {
    const result = await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "github",
      repoUrl: "https://github.com/me/myfork.git",
      pat: "ghp-abcdefghij",
    });
    expect(result.provider).toBe("github");
    expect(result.repoUrl).toBe("https://github.com/me/myfork.git");
  });

  it("strips embedded credentials from the saved repo URL", async () => {
    const result = await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "azure_repos",
      repoUrl: "https://leak:hunter2@dev.azure.com/o/p/_git/myfork",
      pat: "personal-pat-1234",
    });
    expect(result.repoUrl).toBe(
      "https://dev.azure.com/o/p/_git/myfork",
    );
    expect(result.repoUrl).not.toContain("leak");
    expect(result.repoUrl).not.toContain("hunter2");
  });

  it("rejects an unsupported provider", async () => {
    await expect(
      upsertMyFork({
        userId: userAId,
        projectName: PROJECT,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider: "bitbucket" as any,
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        pat: "personal-pat-1234",
      }),
    ).rejects.toThrow(/Unsupported git provider/);
  });

  it("rejects a PAT that looks too short", async () => {
    await expect(
      upsertMyFork({
        userId: userAId,
        projectName: PROJECT,
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        pat: "short",
      }),
    ).rejects.toThrow(/too short/);
  });

  it("rejects pat: null on the very first save (no existing PAT to keep)", async () => {
    await expect(
      upsertMyFork({
        userId: userAId,
        projectName: PROJECT,
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        pat: null,
      }),
    ).rejects.toThrow(/Personal Access Token is required/);
  });

  it("rejects a URL whose host is not an Azure Repos host", async () => {
    await expect(
      upsertMyFork({
        userId: userAId,
        projectName: PROJECT,
        provider: "azure_repos",
        repoUrl: "https://example.com/o/p/_git/r",
        pat: "personal-pat-1234",
      }),
    ).rejects.toThrow();
  });
});

describe("userProjectForkService.upsertMyFork (update)", () => {
  beforeEach(async () => {
    await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/o/p/_git/v1",
      pat: "original-pat-aaaa",
    });
  });

  it("updates provider + URL while keeping the existing PAT when pat: null", async () => {
    const initial = await getMyFork(userAId, PROJECT);
    expect(initial.patLastFour).toBe("aaaa");

    const after = await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "github",
      repoUrl: "https://github.com/me/myfork.git",
      pat: null,
    });
    expect(after.provider).toBe("github");
    expect(after.repoUrl).toBe("https://github.com/me/myfork.git");
    // pat: null must preserve the existing PAT (lastFour + the
    // timestamp on the row). We assert *equality* of patSetAt, which
    // is precision-independent: if the row had been silently
    // re-encrypted, the timestamp would advance no matter the clock
    // resolution.
    expect(after.patLastFour).toBe("aaaa");
    expect(after.patSetAt).toBe(initial.patSetAt);
  });

  it("rotates the stored PAT and patSetAt when a new one is supplied", async () => {
    const initial = await getMyFork(userAId, PROJECT);

    const after = await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/o/p/_git/v1",
      pat: "rotated-pat-ZZZZ",
    });
    expect(after.patLastFour).toBe("ZZZZ");
    // A real rotation must produce a *different* patSetAt. We avoid
    // strict `>` ordering (timestamps can round to the same ms on
    // fast machines) — `not.toBe` only flakes if the row was not
    // actually updated, which is the bug we want to catch.
    expect(after.patSetAt).not.toBe(initial.patSetAt);
  });
});

describe("userProjectForkService.loadMyForkForPush", () => {
  it("returns null when the user has no fork for the project", async () => {
    expect(await loadMyForkForPush(userAId, PROJECT)).toBeNull();
  });

  it("returns the decrypted PAT alongside provider + repoUrl", async () => {
    await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/me/myproj/_git/myfork",
      pat: "personal-pat-1234-WXYZ",
    });
    const internal = await loadMyForkForPush(userAId, PROJECT);
    expect(internal).not.toBeNull();
    expect(internal!.provider).toBe("azure_repos");
    expect(internal!.repoUrl).toBe(
      "https://dev.azure.com/me/myproj/_git/myfork",
    );
    expect(internal!.pat).toBe("personal-pat-1234-WXYZ");
  });
});

describe("userProjectForkService user isolation", () => {
  it("user B does not see user A's fork for the same project name", async () => {
    await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/a/p/_git/r",
      pat: "alice-pat-aaaa",
    });
    const bobView = await getMyFork(userBId, PROJECT);
    expect(bobView.configured).toBe(false);
    expect(bobView.repoUrl).toBeNull();
    expect(await loadMyForkForPush(userBId, PROJECT)).toBeNull();
  });

  it("user B's upsert creates a separate row and does not overwrite user A's", async () => {
    await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/a/p/_git/r",
      pat: "alice-pat-aaaa",
    });
    await upsertMyFork({
      userId: userBId,
      projectName: PROJECT,
      provider: "github",
      repoUrl: "https://github.com/bob/r.git",
      pat: "bob-pat-bbbb",
    });
    const a = await getMyFork(userAId, PROJECT);
    const b = await getMyFork(userBId, PROJECT);
    expect(a.repoUrl).toBe("https://dev.azure.com/a/p/_git/r");
    expect(a.patLastFour).toBe("aaaa");
    expect(b.repoUrl).toBe("https://github.com/bob/r.git");
    expect(b.patLastFour).toBe("bbbb");

    // And loadMyForkForPush returns each user their own PAT.
    expect((await loadMyForkForPush(userAId, PROJECT))!.pat).toBe(
      "alice-pat-aaaa",
    );
    expect((await loadMyForkForPush(userBId, PROJECT))!.pat).toBe(
      "bob-pat-bbbb",
    );
  });

  it("deleteMyFork only deletes the calling user's row", async () => {
    await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/a/p/_git/r",
      pat: "alice-pat-aaaa",
    });
    await upsertMyFork({
      userId: userBId,
      projectName: PROJECT,
      provider: "github",
      repoUrl: "https://github.com/bob/r.git",
      pat: "bob-pat-bbbb",
    });
    await deleteMyFork(userAId, PROJECT);
    expect((await getMyFork(userAId, PROJECT)).configured).toBe(false);
    expect((await getMyFork(userBId, PROJECT)).configured).toBe(true);
  });

  it("deleteMyFork on a user that never had a row is a silent no-op", async () => {
    await expect(deleteMyFork(userAId, PROJECT)).resolves.toBeUndefined();
  });
});

describe("loadMyForkForPush (push-target selection)", () => {
  it("returns null when no fork is configured — push falls back to the upstream", async () => {
    const target = await loadMyForkForPush(userAId, PROJECT);
    expect(target).toBeNull();
  });

  it("returns the decrypted push target (provider + repoUrl + plaintext PAT) when a fork exists", async () => {
    await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/o/p/_git/fork",
      pat: "push-target-pat-9999",
    });
    const target = await loadMyForkForPush(userAId, PROJECT);
    expect(target).not.toBeNull();
    expect(target!.provider).toBe("azure_repos");
    expect(target!.repoUrl).toBe("https://dev.azure.com/o/p/_git/fork");
    // Critical: the selector returns the *plaintext* PAT (the push
    // pipeline embeds it in the clone URL). This is the one place
    // decryption is allowed; everywhere else we redact.
    expect(target!.pat).toBe("push-target-pat-9999");
  });

  it("isolates per-user: a fork saved by user A does NOT leak as user B's push target", async () => {
    await upsertMyFork({
      userId: userAId,
      projectName: PROJECT,
      provider: "github",
      repoUrl: "https://github.com/alice/fork.git",
      pat: "alice-only-pat",
    });
    const bTarget = await loadMyForkForPush(userBId, PROJECT);
    // User B has no row of their own for this project — push must
    // fall through to the project upstream, never to A's fork.
    expect(bTarget).toBeNull();
  });
});

describe("validateBranchName (push-target / branch-flow input validation)", () => {
  it("accepts plain names, slash-namespaced names, dots, dashes, and digits", () => {
    expect(validateBranchName("main")).toBe("main");
    expect(validateBranchName("feature/x")).toBe("feature/x");
    expect(validateBranchName("release-1.2.3")).toBe("release-1.2.3");
    expect(validateBranchName("user/abc_def")).toBe("user/abc_def");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateBranchName("  feature/x  ")).toBe("feature/x");
  });

  it("rejects empty / whitespace-only names", () => {
    expect(validateBranchName("")).toBeNull();
    expect(validateBranchName("   ")).toBeNull();
    expect(validateBranchName("has space")).toBeNull();
  });

  it.each([
    "bad~name",
    "bad^name",
    "bad:name",
    "bad?name",
    "bad*name",
    "bad[name",
    "bad\\name",
  ])("rejects git-forbidden character in %j", (name) => {
    expect(validateBranchName(name)).toBeNull();
  });

  it("rejects `..`, leading `-` or `/`, trailing `/` or `.lock`, and `@` / `@{` patterns", () => {
    expect(validateBranchName("foo..bar")).toBeNull();
    expect(validateBranchName("-leadingdash")).toBeNull();
    expect(validateBranchName("/leadingslash")).toBeNull();
    expect(validateBranchName("trailing/")).toBeNull();
    expect(validateBranchName("trailing.lock")).toBeNull();
    expect(validateBranchName("@")).toBeNull();
    expect(validateBranchName("foo@{1}")).toBeNull();
  });
});
