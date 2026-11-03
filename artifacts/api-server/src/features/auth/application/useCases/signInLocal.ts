/**
 * Verify local username/password credentials and regenerate the session.
 *
 * Demonstrates the first end-to-end port-and-adapter slice for the auth
 * feature: depends only on `UserRepository`, `PasswordHasher`, and the
 * per-request `SessionStore` ports, returns `Result<T, AppError>`.
 */
import {
  err,
  ok,
  unauthorizedError,
  type AppError,
  type Result,
} from "@workspace/kernel";
import type { User } from "@workspace/db";
import type {
  PasswordHasher,
  SessionStore,
  UserRepository,
} from "../../domain/ports";

export interface SignInLocalInput {
  readonly username: string;
  readonly password: string;
  readonly session: SessionStore;
}

const INVALID = unauthorizedError("Invalid email or password.");

export class SignInLocalUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(
    input: SignInLocalInput,
  ): Promise<Result<{ user: User }, AppError>> {
    const user = await this.users.findByUsername(input.username);
    if (!user || !user.passwordHash) return err(INVALID);
    const matched = await this.hasher.verify(
      input.password,
      user.passwordHash,
    );
    if (!matched) return err(INVALID);

    await input.session.regenerate();
    input.session.data.userId = user.id;
    await input.session.save();
    return ok({ user });
  }
}
