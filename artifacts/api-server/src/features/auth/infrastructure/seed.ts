import { eq, inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  hashPassword,
  verifyPassword,
} from "@/features/auth/infrastructure/passwordHash";
import { isDevEnvironment } from "@/features/auth/infrastructure/devEnvironment";
import { logger } from "@/shared/logger";

/**
 * Fixed password for the four demo role accounts. This value is in the
 * repository and is therefore NOT a secret — it exists so a local or
 * development sandbox has predictable logins for each role, and so the
 * e2e/docs harness can sign in as any of them.
 *
 * It must never reach a deployed environment. `seedUsers()` refuses to
 * create these accounts outside `local` / `development` (see the
 * environment gate below), which is the control that keeps a
 * publicly-known credential out of production.
 */
const SEED_PASSWORD = "Temporary1!";

/**
 * Env var holding the initial password for the single bootstrap admin
 * created in a non-development environment. Absent = no seeding at all,
 * which is the correct behavior for an already-provisioned deployment.
 */
const BOOTSTRAP_PASSWORD_ENV = "BOOTSTRAP_ADMIN_PASSWORD";
const BOOTSTRAP_USERNAME_ENV = "BOOTSTRAP_ADMIN_USERNAME";
const DEFAULT_BOOTSTRAP_USERNAME = "admin";

/** Minimum length for an operator-supplied bootstrap password. */
const MIN_BOOTSTRAP_PASSWORD_LENGTH = 12;

interface SeedUser {
  username: string;
  role: "memento_admin" | "admin" | "limited_admin" | "limited";
  firstName: string;
  lastName: string;
  title: string;
  email: string;
}

const SEED_USERS: SeedUser[] = [
  {
    username: "MementoAdminRole",
    role: "memento_admin",
    firstName: "Memento",
    lastName: "Admin",
    title: "Memento Administrator",
    email: "memento.admin@example.com",
  },
  {
    username: "AdminRole",
    role: "admin",
    firstName: "Admin",
    lastName: "Role",
    title: "Administrator",
    email: "admin.role@example.com",
  },
  {
    username: "LimitedAdminRole",
    role: "limited_admin",
    firstName: "Limited",
    lastName: "Admin",
    title: "Limited Administrator",
    email: "limited.admin@example.com",
  },
  {
    username: "UserRole",
    role: "limited",
    firstName: "User",
    lastName: "Role",
    title: "Tester",
    email: "user.role@example.com",
  },
];

/**
 * Create the four fixed-password demo role accounts. Development only —
 * callers must gate on {@link isDevEnvironment}.
 */
async function seedDemoRoleUsers(): Promise<void> {
  for (const seed of SEED_USERS) {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, seed.username))
      .limit(1);
    if (existing.length > 0) {
      // Re-assert the seeded profile fields on every boot so the post-login
      // splash flow doesn't get short-circuited into the profile-completion
      // screen for these accounts.
      await db
        .update(usersTable)
        .set({
          firstName: seed.firstName,
          lastName: seed.lastName,
          title: seed.title,
          email: seed.email,
          hasSeenTour: true,
        })
        .where(eq(usersTable.id, existing[0]!.id));
      continue;
    }
    const passwordHash = await hashPassword(SEED_PASSWORD);
    await db.insert(usersTable).values({
      username: seed.username,
      passwordHash,
      role: seed.role,
      firstName: seed.firstName,
      lastName: seed.lastName,
      title: seed.title,
      email: seed.email,
      profile: {},
      hasSeenTour: true,
    });
    logger.info({ username: seed.username, role: seed.role }, "Seeded user");
  }
}

/**
 * Create a single `admin` account from an operator-supplied password so
 * a freshly-provisioned deployment can be administered at all.
 *
 * Deliberately narrower than the development seeding in two ways:
 *  - one account, not four;
 *  - role `admin`, never `memento_admin` — the cross-tenant god-mode
 *    role is promoted deliberately by a human, not minted at boot.
 *
 * No-ops when any admin-capable account already exists, so it cannot
 * resurrect a deleted admin or fight with an existing user directory.
 *
 * The account is created with an incomplete profile (no email), so the
 * existing post-login profile-completion flow prompts the operator
 * before they can use the app — which is also where they should change
 * the password. A hard `mustChangePassword` enforcement flag would need
 * a `users` column and therefore a schema migration; deployment runs no
 * migration step today, so that is deliberately left as a follow-up
 * rather than shipped as an unmigrated column.
 */
async function seedBootstrapAdmin(password: string): Promise<void> {
  if (password.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
    logger.error(
      { minLength: MIN_BOOTSTRAP_PASSWORD_LENGTH },
      `${BOOTSTRAP_PASSWORD_ENV} is shorter than the minimum length — refusing to seed a weak bootstrap admin.`,
    );
    return;
  }

  const username = (process.env[BOOTSTRAP_USERNAME_ENV] ?? "")
    .trim()
    .toLowerCase() || DEFAULT_BOOTSTRAP_USERNAME;

  // If the deployment already has someone who can administer it, there
  // is nothing to bootstrap.
  const existingAdmins = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
    .limit(1);
  const existingMementoAdmins = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "memento_admin"))
    .limit(1);
  if (existingAdmins.length > 0 || existingMementoAdmins.length > 0) {
    logger.info(
      "Bootstrap admin not created: an administrator account already exists.",
    );
    return;
  }

  const existingSameName = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);
  if (existingSameName.length > 0) {
    logger.warn(
      { username },
      `Bootstrap admin not created: username already taken. Set ${BOOTSTRAP_USERNAME_ENV} to a free name.`,
    );
    return;
  }

  await db.insert(usersTable).values({
    username,
    passwordHash: await hashPassword(password),
    role: "admin",
    firstName: "Bootstrap",
    lastName: "Admin",
    title: "Administrator",
    email: null,
    profile: {},
    hasSeenTour: false,
  });
  logger.warn(
    { username },
    `Bootstrap admin account created from ${BOOTSTRAP_PASSWORD_ENV}. ` +
      `Sign in, change the password immediately, then unset ${BOOTSTRAP_PASSWORD_ENV}.`,
  );
}

/**
 * Boot-time user seeding.
 *
 * Development (`APP_ENVIRONMENT` of `local` / `development`): create the
 * four fixed-password role accounts the e2e and docs harnesses expect.
 *
 * Everything else (production, staging, anything unset): create nothing
 * unless the operator explicitly supplies `BOOTSTRAP_ADMIN_PASSWORD`,
 * and even then only a single non-god-mode admin that must change its
 * password on first use. This is what keeps the repository-known
 * `SEED_PASSWORD` — and the `memento_admin` role — out of a deployed
 * environment.
 *
 * Fails safe: an unset or unrecognized `APP_ENVIRONMENT` is treated as
 * NOT development, so a missing env var cannot open the demo accounts.
 */
export async function seedUsers(): Promise<void> {
  if (isDevEnvironment()) {
    await seedDemoRoleUsers();
    return;
  }

  await warnOnDefaultCredentials();

  const bootstrap = process.env[BOOTSTRAP_PASSWORD_ENV]?.trim();
  if (!bootstrap) {
    logger.info(
      "Non-development environment — skipping demo user seeding. " +
        `Set ${BOOTSTRAP_PASSWORD_ENV} to create an initial admin on a fresh database.`,
    );
    return;
  }
  await seedBootstrapAdmin(bootstrap);
}

/**
 * Detect demo accounts that still carry the repository-known
 * `SEED_PASSWORD` and log a loud, actionable warning.
 *
 * Gating the seeder (above) stops NEW environments from being created
 * with a public credential, but it cannot help a database that was
 * already seeded by an earlier build — those rows still exist and still
 * accept `Temporary1!`. This check is what makes that state visible
 * instead of silent.
 *
 * Deliberately non-destructive: it does not disable, delete, or
 * re-password anything. An automatic lockout here could remove the
 * operator's own last route into a running deployment, so remediation
 * stays a human decision. Read-only and best-effort — any failure is
 * logged and never blocks boot.
 */
async function warnOnDefaultCredentials(): Promise<void> {
  try {
    const rows = await db
      .select({
        username: usersTable.username,
        role: usersTable.role,
        passwordHash: usersTable.passwordHash,
      })
      .from(usersTable)
      .where(
        inArray(
          usersTable.username,
          SEED_USERS.map((s) => s.username),
        ),
      );

    const compromised: { username: string; role: string }[] = [];
    for (const row of rows) {
      if (!row.passwordHash) continue;
      if (await verifyPassword(SEED_PASSWORD, row.passwordHash)) {
        compromised.push({ username: row.username, role: row.role });
      }
    }

    if (compromised.length === 0) return;

    logger.error(
      { accounts: compromised },
      "SECURITY: account(s) in this deployment still use the default demo " +
        "password from the repository. Anyone can sign in as them. Change " +
        "each password or delete the account now. This build no longer " +
        "creates these accounts, but it cannot rotate ones that already exist.",
    );
  } catch (err) {
    logger.warn(
      { err },
      "Default-credential check failed — could not verify seeded accounts.",
    );
  }
}
