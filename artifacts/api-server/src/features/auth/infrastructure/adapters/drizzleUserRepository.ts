import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  type Organization,
  type User,
} from "@workspace/db";
import type {
  ProfileUpdate,
  UserRepository,
} from "../../domain/ports";
import type { NormalizedClaims } from "../../domain/claims";
// Route through the `oidcProvider` barrel so existing test spies on
// `provisionFromClaims` / `listOrgsForUser` keep intercepting the
// runtime path the adapter actually takes.
import * as oidcProvider from "../oidcProvider";

/**
 * Drizzle/Postgres-backed adapter for the {@link UserRepository} port.
 * Wraps the existing infrastructure helpers — behavior unchanged so
 * existing route + integration tests keep passing.
 */
export class DrizzleUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateProfile(
    id: string,
    update: ProfileUpdate,
  ): Promise<User | null> {
    const [updated] = await db
      .update(usersTable)
      .set({
        firstName: update.firstName,
        lastName: update.lastName,
        title: update.title,
        email: update.email,
      })
      .where(eq(usersTable.id, id))
      .returning();
    return updated ?? null;
  }

  async listOrgsForUser(userId: string): Promise<Organization[]> {
    return oidcProvider.listOrgsForUser(userId);
  }

  async provisionFromClaims(
    claims: NormalizedClaims,
  ): Promise<{ user: User; orgs: Organization[] }> {
    return oidcProvider.provisionFromClaims(claims);
  }
}
