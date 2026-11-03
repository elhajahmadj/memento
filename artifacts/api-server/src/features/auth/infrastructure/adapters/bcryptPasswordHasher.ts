import type { PasswordHasher } from "../../domain/ports";
import { hashPassword, verifyPassword } from "../passwordHash";

/**
 * bcryptjs-backed adapter for the {@link PasswordHasher} port.
 * Delegates to the existing helpers so cost factor + error handling
 * stay defined in one place.
 */
export class BcryptPasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return hashPassword(plain);
  }
  verify(plain: string, stored: string): Promise<boolean> {
    return verifyPassword(plain, stored);
  }
}
