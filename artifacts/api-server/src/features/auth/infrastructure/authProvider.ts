import { eq } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import { verifyPassword } from "@/features/auth/infrastructure/passwordHash";

export type LoginOutcome =
  | { kind: "ok"; user: User }
  | { kind: "invalid_credentials" };

export interface AuthProvider {
  /** Verify the supplied credentials against the local password column. */
  login(username: string, password: string): Promise<LoginOutcome>;

  /** Look up a user by id (used by session middleware on every request). */
  findUserById(id: string): Promise<User | null>;
}

class LocalAuthProviderImpl implements AuthProvider {
  async login(username: string, password: string): Promise<LoginOutcome> {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);
    const user = rows[0];
    if (!user || !user.passwordHash) return { kind: "invalid_credentials" };
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return { kind: "invalid_credentials" };
    return { kind: "ok", user };
  }

  async findUserById(id: string): Promise<User | null> {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
}

let provider: AuthProvider | null = null;

export function getAuthProvider(): AuthProvider {
  if (!provider) provider = new LocalAuthProviderImpl();
  return provider;
}

/** Test seam: swap the active provider. */
export function setAuthProvider(next: AuthProvider | null): void {
  provider = next;
}
