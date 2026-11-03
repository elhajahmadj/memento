/**
 * api-server composition root.
 *
 * The single place where concrete infrastructure adapters are
 * constructed and injected into application use cases. Route modules
 * resolve use cases from the container instead of importing
 * service-style modules directly.
 *
 * For features whose infrastructure module already owns singleton
 * state (in-memory event buses, queues, lifecycle hooks), the
 * container re-exposes the use cases that the feature's
 * `infrastructure/*Service.ts` module wires up at import time. That
 * keeps the composition single-instance without duplicating
 * stateful adapters.
 *
 * Per-request adapters (e.g. `ExpressSessionStore`) are not held on the
 * container — they're constructed inside the route handler and passed
 * into the use case's `execute()` call. The container only owns
 * adapters whose lifetimes are tied to the process.
 */
import { setCurrentProject } from "@/features/projects/infrastructure/projectService";
import {
  BcryptPasswordHasher,
  DrizzleUserRepository,
  JoseOidcTokenVerifier,
  NexusOidcGateway,
} from "@/features/auth/infrastructure/adapters";
import {
  InMemoryPasswordResetThrottle,
  RequestPasswordResetUseCase,
  SignInLocalUseCase,
  SignInOidcCallbackUseCase,
  SignOutUseCase,
  VerifyBearerTokenUseCase,
} from "@/features/auth/application/useCases";
import { NexusPasswordResetClient } from "@/features/auth/infrastructure/nexusPasswordResetClient";
import { approvalsComposition } from "@/features/approvals/infrastructure/approvalService";
import { architecturesComposition } from "@/features/architectures/infrastructure/architectureService";
import { validationComposition } from "@/features/validation/infrastructure/replayService";
import { projectsComposition } from "@/features/projects/infrastructure/projectService";
import { generateTest } from "@/features/codegen/application/useCases/generateTest";
import { upsertGitConfig } from "@/features/projects/application/useCases/gitConfig/upsertGitConfig";
import { cloneProjectFromRepo } from "@/features/projects/application/useCases/gitConfig/cloneProjectFromRepo";
import { pullProject } from "@/features/projects/application/useCases/gitConfig/pullProject";
import { pushProject } from "@/features/projects/application/useCases/gitConfig/pushProject";
import {
  checkoutBranch,
  createBranch,
  listBranches,
} from "@/features/projects/application/useCases/gitConfig/branchOperations";

export interface AuthUseCases {
  readonly signInLocal: SignInLocalUseCase;
  readonly signOut: SignOutUseCase;
  readonly verifyBearerToken: VerifyBearerTokenUseCase;
  readonly signInOidcCallback: SignInOidcCallbackUseCase;
  readonly requestPasswordReset: RequestPasswordResetUseCase;
}

export interface Container {
  readonly useCases: {
    readonly auth: AuthUseCases;
    readonly approvals: typeof approvalsComposition;
    readonly architectures: typeof architecturesComposition;
    readonly validation: typeof validationComposition;
    readonly projects: typeof projectsComposition;
    readonly codegen: {
      readonly generateTest: typeof generateTest;
    };
    readonly gitConfig: {
      readonly upsertGitConfig: typeof upsertGitConfig;
      readonly cloneProjectFromRepo: typeof cloneProjectFromRepo;
      readonly pullProject: typeof pullProject;
      readonly pushProject: typeof pushProject;
      readonly listBranches: typeof listBranches;
      readonly createBranch: typeof createBranch;
      readonly checkoutBranch: typeof checkoutBranch;
    };
  };
}

/**
 * Build the production container. Called once from `index.ts` at boot.
 * Tests construct their own container with stub adapters instead of
 * importing this function.
 */
export function buildContainer(): Container {
  const users = new DrizzleUserRepository();
  const hasher = new BcryptPasswordHasher();
  const verifier = new JoseOidcTokenVerifier();
  const gateway = new NexusOidcGateway();
  return {
    useCases: {
      auth: {
        signInLocal: new SignInLocalUseCase(users, hasher),
        signOut: new SignOutUseCase((userId) =>
          setCurrentProject(null, userId),
        ),
        verifyBearerToken: new VerifyBearerTokenUseCase(
          verifier,
          gateway,
          users,
        ),
        signInOidcCallback: new SignInOidcCallbackUseCase(
          verifier,
          gateway,
          users,
        ),
        requestPasswordReset: new RequestPasswordResetUseCase(
          new NexusPasswordResetClient(),
          new InMemoryPasswordResetThrottle(),
        ),
      },
      approvals: approvalsComposition,
      architectures: architecturesComposition,
      validation: validationComposition,
      projects: projectsComposition,
      codegen: { generateTest },
      gitConfig: {
        upsertGitConfig,
        cloneProjectFromRepo,
        pullProject,
        pushProject,
        listBranches,
        createBranch,
        checkoutBranch,
      },
    },
  };
}

let cached: Container | null = null;

/**
 * Lazy accessor used by route modules. Stays a singleton across the
 * process; tests can override individual use cases with
 * {@link setContainerForTests}.
 */
export function getContainer(): Container {
  if (!cached) cached = buildContainer();
  return cached;
}

/** Test seam: swap the active container (or clear it with `null`). */
export function setContainerForTests(next: Container | null): void {
  cached = next;
}
