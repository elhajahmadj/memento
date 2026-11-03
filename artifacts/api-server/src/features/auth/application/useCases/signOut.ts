/**
 * Sign out the current user. Clears the in-memory "current project"
 * pin for that user (so the next sign-in starts on a clean redirect),
 * then destroys the session.
 */
import { ok, type Result } from "@workspace/kernel";
import type { SessionStore } from "../../domain/ports";

export interface SignOutInput {
  readonly userId: string | null;
  readonly session: SessionStore;
}

export interface ClearCurrentProject {
  (userId: string): void;
}

export class SignOutUseCase {
  constructor(private readonly clearCurrentProject: ClearCurrentProject) {}

  async execute(input: SignOutInput): Promise<Result<void, never>> {
    if (input.userId) this.clearCurrentProject(input.userId);
    await input.session.destroy();
    return ok(undefined);
  }
}
