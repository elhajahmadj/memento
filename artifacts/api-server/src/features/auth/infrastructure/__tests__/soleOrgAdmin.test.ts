import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { like, or } from "drizzle-orm";
import {
  db,
  organizationsTable,
  userOrganizationsTable,
  usersTable,
  type User,
} from "@workspace/db";
import { getSoleOrgAdminStatus } from "@/features/auth/infrastructure/soleOrgAdmin";
import {
  toPerOrgRole,
  type PerOrgRole,
} from "@/features/auth/domain/claims";
import type { Request } from "express";

const TEST_PREFIX = "vitest-soleorg-";

async function cleanup() {
  await db
    .delete(usersTable)
    .where(or(like(usersTable.username, `${TEST_PREFIX}%`)));
  await db
    .delete(organizationsTable)
    .where(like(organizationsTable.externalKey, `${TEST_PREFIX}%`));
}

beforeAll(cleanup);
afterEach(cleanup);

async function createOrg(key: string): Promise<string> {
  const [row] = await db
    .insert(organizationsTable)
    .values({
      externalKey: `${TEST_PREFIX}${key}`,
      displayName: `${TEST_PREFIX}${key}`,
    })
    .returning();
  return row!.id;
}

async function createUser(
  suffix: string,
  role: User["role"],
  orgId: string | null,
  authSource: User["authSource"] = "oidc",
): Promise<User> {
  const [u] = await db
    .insert(usersTable)
    .values({
      username: `${TEST_PREFIX}${suffix}`,
      role,
      authSource,
    })
    .returning();
  if (orgId) {
    // Stamp the membership with the same role as `users.role` so the
    // per-org resolver (`resolveEffectiveRole`) returns this role for
    // the caller in the active org. Memento Admin lives only on
    // `users.role` (god-mode, org-independent) and guests never join an
    // org at all; neither may be written to a membership row — the
    // per-org enum forbids both.
    const perOrgRole: PerOrgRole = toPerOrgRole(role) ?? "limited";
    await db.insert(userOrganizationsTable).values({
      userId: u!.id,
      organizationId: orgId,
      role: perOrgRole,
    });
  }
  return u!;
}

function makeReq(user: User, activeOrgId: string | null): Request {
  return {
    user,
    session: { activeOrgId: activeOrgId ?? undefined },
    header: () => undefined,
  } as unknown as Request;
}

describe("getSoleOrgAdminStatus()", () => {
  it("returns isSoleAdmin=true when caller is the only Admin in their org", async () => {
    const orgId = await createOrg("org-a");
    const admin = await createUser("admin-1", "admin", orgId);
    // Other members exist but none are admins.
    await createUser("user-1", "limited", orgId);
    await createUser("ladmin-1", "limited_admin", orgId);

    const result = await getSoleOrgAdminStatus(makeReq(admin, orgId), admin);
    expect(result).toEqual({ isSoleAdmin: true, orgId });
  });

  it("returns isSoleAdmin=false when another Admin is in the same org", async () => {
    const orgId = await createOrg("org-b");
    const admin = await createUser("admin-a", "admin", orgId);
    await createUser("admin-b", "admin", orgId);

    const result = await getSoleOrgAdminStatus(makeReq(admin, orgId), admin);
    expect(result).toEqual({ isSoleAdmin: false, orgId });
  });

  it("does not count Memento Admins toward the sole-Admin rule", async () => {
    const orgId = await createOrg("org-c");
    const admin = await createUser("admin-c", "admin", orgId);
    await createUser("mem-admin-c", "memento_admin", orgId);

    const result = await getSoleOrgAdminStatus(makeReq(admin, orgId), admin);
    expect(result).toEqual({ isSoleAdmin: true, orgId });
  });

  it("returns false with null orgId for local users with no active org", async () => {
    const admin = await createUser("local-admin", "admin", null, "local");
    const result = await getSoleOrgAdminStatus(makeReq(admin, null), admin);
    expect(result).toEqual({ isSoleAdmin: false, orgId: null });
  });
});
