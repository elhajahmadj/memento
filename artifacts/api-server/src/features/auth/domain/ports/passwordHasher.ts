/**
 * Password-hashing port. The local sign-in use case depends on this
 * interface rather than `bcryptjs` directly so tests can substitute a
 * deterministic stub.
 */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, stored: string): Promise<boolean>;
}
