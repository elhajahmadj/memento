import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db, authStatesTable, usersTable } from "@workspace/db";
import {
  isEncryptedState,
  unwrapState,
  wrapState,
} from "@/features/auth-states/infrastructure/authStateCrypto";
import {
  getAuthStateSummary,
  loadAuthStateStorageState,
  saveAuthState,
} from "@/features/auth-states/infrastructure/authStateService";
import { provisionUser } from "@/shared/test-helpers";

/**
 * At-rest encryption for captured Playwright storage state (audit H-2).
 *
 * The regression these tests exist for: the `auth_states.state` column
 * held a verbatim Playwright `storageState()` payload — the live cookies
 * and localStorage of the system under test, i.e. a directly replayable
 * credential for a third-party system — in plaintext. Every other secret
 * class in this codebase (git PATs, repo PATs, AI provider keys, fork
 * secrets) already went through AES-256-GCM via `shared/crypto.ts`.
 */

const PREFIX = "authcrypto-";
const PROJECT = "AuthCryptoProject";

const SAMPLE_STATE = {
  cookies: [
    {
      name: "session",
      value: "super-secret-session-token",
      domain: "app.example",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
  ],
  origins: [
    {
      origin: "https://app.example",
      localStorage: [{ name: "token", value: "another-secret" }],
    },
  ],
};

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.PROJECT_SECRETS_KEY;
  process.env.PROJECT_SECRETS_KEY = "authcrypto-test-key-plenty-long";
});

afterEach(async () => {
  if (savedKey === undefined) delete process.env.PROJECT_SECRETS_KEY;
  else process.env.PROJECT_SECRETS_KEY = savedKey;
  await db.delete(authStatesTable).where(eq(authStatesTable.projectName, PROJECT));
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
});

describe("wrapState / unwrapState", () => {
  it("round-trips a storage state through encryption", () => {
    const wrapped = wrapState(SAMPLE_STATE);
    expect(unwrapState(wrapped)).toEqual(SAMPLE_STATE);
  });

  it("produces a value that does not contain the plaintext secrets", () => {
    const serialized = JSON.stringify(wrapState(SAMPLE_STATE));
    expect(serialized).not.toContain("super-secret-session-token");
    expect(serialized).not.toContain("another-secret");
    expect(serialized).not.toContain("app.example");
  });

  it("uses a fresh IV so the same input encrypts differently each time", () => {
    const a = JSON.stringify(wrapState(SAMPLE_STATE));
    const b = JSON.stringify(wrapState(SAMPLE_STATE));
    expect(a).not.toBe(b);
  });

  it("marks its output as encrypted", () => {
    expect(isEncryptedState(wrapState(SAMPLE_STATE))).toBe(true);
  });

  it("reads a legacy plaintext row unchanged (transparent migration)", () => {
    // Rows written before H-2 are bare storageState objects. They must
    // keep working, or a user's saved login would silently break.
    expect(isEncryptedState(SAMPLE_STATE)).toBe(false);
    expect(unwrapState(SAMPLE_STATE)).toEqual(SAMPLE_STATE);
  });

  it("returns null rather than throwing when the key cannot decrypt", () => {
    const wrapped = wrapState(SAMPLE_STATE);
    process.env.PROJECT_SECRETS_KEY = "a-completely-different-key-value";
    // Degrades to "no saved login" instead of failing the request.
    expect(unwrapState(wrapped)).toBeNull();
  });

  it("returns null for a corrupt envelope", () => {
    expect(unwrapState({ enc: "v1:not:valid:hex" })).toBeNull();
    expect(unwrapState({ enc: "garbage" })).toBeNull();
  });

  it("handles null and undefined", () => {
    expect(unwrapState(null)).toBeNull();
    expect(unwrapState(undefined)).toBeNull();
  });
});

describe("saveAuthState — at-rest encryption", () => {
  it("stores ciphertext in the database, not the captured cookies", async () => {
    const user = await provisionUser({
      username: `${PREFIX}owner`,
      role: "admin",
    });

    await saveAuthState({
      userId: user.id,
      projectName: PROJECT,
      label: "captured",
      state: SAMPLE_STATE,
    });

    const [row] = await db
      .select({ state: authStatesTable.state })
      .from(authStatesTable)
      .where(
        and(
          eq(authStatesTable.userId, user.id),
          eq(authStatesTable.projectName, PROJECT),
        ),
      );

    expect(row).toBeDefined();
    expect(isEncryptedState(row!.state)).toBe(true);
    const raw = JSON.stringify(row!.state);
    expect(raw).not.toContain("super-secret-session-token");
    expect(raw).not.toContain("another-secret");
  });

  it("round-trips through the service so Playwright still gets real cookies", async () => {
    const user = await provisionUser({
      username: `${PREFIX}rt`,
      role: "admin",
    });

    await saveAuthState({
      userId: user.id,
      projectName: PROJECT,
      label: "captured",
      state: SAMPLE_STATE,
    });

    const loaded = await loadAuthStateStorageState({
      userId: user.id,
      projectName: PROJECT,
    });
    expect(loaded).toEqual(SAMPLE_STATE);
  });

  it("keeps the summary working (label + hasState) without decrypting", async () => {
    const user = await provisionUser({
      username: `${PREFIX}sum`,
      role: "admin",
    });

    await saveAuthState({
      userId: user.id,
      projectName: PROJECT,
      label: "my login",
      state: SAMPLE_STATE,
    });

    const summary = await getAuthStateSummary({
      userId: user.id,
      projectName: PROJECT,
    });
    expect(summary.hasState).toBe(true);
    expect(summary.label).toBe("my login");
  });

  it("returns null for a project with no captured state", async () => {
    const user = await provisionUser({
      username: `${PREFIX}none`,
      role: "admin",
    });
    expect(
      await loadAuthStateStorageState({
        userId: user.id,
        projectName: PROJECT,
      }),
    ).toBeNull();
  });

  it("still reads a row that was written as legacy plaintext", async () => {
    const user = await provisionUser({
      username: `${PREFIX}legacy`,
      role: "admin",
    });
    // Simulate a pre-H-2 row: raw storageState straight into the column.
    await db.insert(authStatesTable).values({
      userId: user.id,
      projectName: PROJECT,
      label: "legacy",
      state: SAMPLE_STATE,
    });

    const loaded = await loadAuthStateStorageState({
      userId: user.id,
      projectName: PROJECT,
    });
    expect(loaded).toEqual(SAMPLE_STATE);
  });
});
