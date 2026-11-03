import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { seedUsers } from "@/features/auth/infrastructure/seed";
import { verifyPassword } from "@/features/auth/infrastructure/passwordHash";

/**
 * Boot-time seeding gate (audit finding C-1).
 *
 * The regression these tests exist for: `seedUsers()` used to run
 * unconditionally from `server.listen`, creating four accounts —
 * including a `memento_admin` god-mode account — with the password
 * `Temporary1!`, which is committed to this repository. Any fresh
 * deployment therefore shipped with a publicly-known administrator
 * credential.
 *
 * The four demo accounts must exist in development (the e2e and docs
 * harnesses sign in as them) and must NOT be created anywhere else.
 */

const DEMO_USERNAMES = [
  "MementoAdminRole",
  "AdminRole",
  "LimitedAdminRole",
  "UserRole",
];

const BOOTSTRAP_PREFIX = "seedtest-bootstrap-";

/** Env vars this file mutates, restored after every test. */
const TOUCHED = [
  "APP_ENVIRONMENT",
  "BOOTSTRAP_ADMIN_PASSWORD",
  "BOOTSTRAP_ADMIN_USERNAME",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of TOUCHED) saved[key] = process.env[key];
});

afterEach(async () => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await db.delete(usersTable).where(inArray(usersTable.username, DEMO_USERNAMES));
  await db
    .delete(usersTable)
    .where(like(usersTable.username, `${BOOTSTRAP_PREFIX}%`));
});

async function usernamesPresent(names: string[]): Promise<string[]> {
  const rows = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(inArray(usersTable.username, names));
  return rows.map((r) => r.username).sort();
}

describe("seedUsers — environment gate", () => {
  it("creates the four demo role accounts in a development environment", async () => {
    process.env.APP_ENVIRONMENT = "development";
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;

    await seedUsers();

    expect(await usernamesPresent(DEMO_USERNAMES)).toEqual(
      [...DEMO_USERNAMES].sort(),
    );
  });

  it("creates no demo accounts when APP_ENVIRONMENT is production", async () => {
    process.env.APP_ENVIRONMENT = "production";
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;

    await seedUsers();

    expect(await usernamesPresent(DEMO_USERNAMES)).toEqual([]);
  });

  it("fails safe: creates no demo accounts when APP_ENVIRONMENT is unset", async () => {
    delete process.env.APP_ENVIRONMENT;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;

    await seedUsers();

    expect(await usernamesPresent(DEMO_USERNAMES)).toEqual([]);
  });

  it("fails safe: creates no demo accounts for an unrecognized APP_ENVIRONMENT", async () => {
    process.env.APP_ENVIRONMENT = "staging";
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;

    await seedUsers();

    expect(await usernamesPresent(DEMO_USERNAMES)).toEqual([]);
  });

  it("never creates a memento_admin account outside development", async () => {
    process.env.APP_ENVIRONMENT = "production";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "a-long-enough-bootstrap-password";
    process.env.BOOTSTRAP_ADMIN_USERNAME = `${BOOTSTRAP_PREFIX}godmode`;

    await seedUsers();

    const rows = await db
      .select({ username: usersTable.username, role: usersTable.role })
      .from(usersTable)
      .where(like(usersTable.username, `${BOOTSTRAP_PREFIX}%`));
    for (const row of rows) {
      expect(row.role).not.toBe("memento_admin");
    }
  });
});

describe("seedUsers — production bootstrap admin", () => {
  it("creates a single admin from BOOTSTRAP_ADMIN_PASSWORD when no admin exists", async () => {
    process.env.APP_ENVIRONMENT = "production";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "a-long-enough-bootstrap-password";
    const username = `${BOOTSTRAP_PREFIX}fresh`;
    process.env.BOOTSTRAP_ADMIN_USERNAME = username;

    // Only meaningful on a database with no pre-existing admin. The
    // shared test DB usually has one, in which case the bootstrap
    // correctly no-ops — assert whichever branch applies rather than
    // depending on global DB state.
    const priorAdmins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"))
      .limit(1);

    await seedUsers();

    const [created] = await db
      .select({
        username: usersTable.username,
        role: usersTable.role,
        passwordHash: usersTable.passwordHash,
      })
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);

    if (priorAdmins.length > 0) {
      expect(created).toBeUndefined(); // no-op: an admin already exists
      return;
    }
    expect(created).toBeDefined();
    expect(created!.role).toBe("admin");
    expect(
      await verifyPassword("a-long-enough-bootstrap-password", created!.passwordHash!),
    ).toBe(true);
  });

  it("refuses to seed a bootstrap admin with a short password", async () => {
    process.env.APP_ENVIRONMENT = "production";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "short";
    const username = `${BOOTSTRAP_PREFIX}weak`;
    process.env.BOOTSTRAP_ADMIN_USERNAME = username;

    await seedUsers();

    expect(await usernamesPresent([username])).toEqual([]);
  });

  it("never stores the bootstrap password in plaintext", async () => {
    process.env.APP_ENVIRONMENT = "production";
    const password = "another-long-bootstrap-password";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = password;
    const username = `${BOOTSTRAP_PREFIX}hash`;
    process.env.BOOTSTRAP_ADMIN_USERNAME = username;

    await seedUsers();

    const rows = await db
      .select({ passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.username, username));
    for (const row of rows) {
      expect(row.passwordHash).not.toBe(password);
      expect(row.passwordHash?.startsWith("$2")).toBe(true); // bcrypt
    }
  });
});
