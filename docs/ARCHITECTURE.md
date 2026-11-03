# Architecture

This document describes the Clean Architecture layout that both
artifacts in this monorepo (`artifacts/api-server`, `artifacts/test-builder`)
follow today, plus the layering rules that hold the code together.

The multi-phase refactor that landed this shape is closed out in
`docs/REFACTORING_PLAN.md` (kept as a historical log + retrospective).
New features extend this same layout; they don't reintroduce the old
service-shim style.

---

## 1. Layers

The codebase is organized into four layers. The dependency rule points
inward only — outer layers may depend on inner layers, never the
reverse.

```
┌────────────────────────────────────────────────────────────────────┐
│  Presentation                                                      │
│  Express handlers, React pages/components, hooks, route plumbing   │
│  Knows about HTTP, JSX, React Router (Wouter), TanStack Query      │
│  May call:  Application                                            │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│  Application (use cases)                                           │
│  One file per use case, each exporting a single `execute()`        │
│  Returns `Result<T, AppError>` at every boundary                   │
│  May call:  Domain, Domain.Ports                                   │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│  Domain                                                            │
│  Pure entities, value objects, domain services, port interfaces    │
│  No I/O, no React, no Express, no Drizzle                          │
│  May call:  itself, `@workspace/kernel`                            │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  Infrastructure                                                    │
│  Adapters that implement domain ports                              │
│  Drizzle repositories (backend), orval react-query repositories    │
│  (frontend), filesystem, child_process, fetch wrappers             │
│  May call:  Domain.Ports (to implement them), `@workspace/kernel`  │
└────────────────────────────────────────────────────────────────────┘
```

Infrastructure sits "outside" the inner layers but is consumed by the
**composition root**, which is the only place that knows about both
application use cases and concrete adapter implementations.

---

## 2. Folder conventions

Both artifacts use the **feature-folder structure**. Inside each artifact:

```
src/
├── app/                      (test-builder only)
│   ├── di/container.ts       composition root
│   └── providers/AppProviders.tsx
├── composition/              (api-server only)
│   └── container.ts          composition root
├── features/
│   └── <feature>/
│       ├── domain/
│       │   ├── entities/
│       │   ├── valueObjects/
│       │   ├── services/
│       │   └── ports/        port interfaces (repositories, adapters)
│       ├── application/
│       │   └── useCases/     one file per use case, single `execute()`
│       ├── infrastructure/
│       │   └── repositories/ implementations of domain ports
│       └── presentation/
│           ├── routes/       (api-server) Express route handlers
│           ├── pages/        (test-builder) React page components
│           ├── components/   feature-private React components
│           └── hooks/        feature-private React hooks
├── shared/
│   ├── ui/                   cross-feature React UI primitives (shadcn)
│   ├── hooks/
│   ├── utils/
│   └── config/
└── index.ts | main.tsx       app entry
```

Each feature exposes a top-level `index.ts` barrel listing only what
sibling features and the composition root may import. Cross-feature
imports go through these barrels — no deep relative paths.

### What goes where

| Concern                                            | Layer            |
| -------------------------------------------------- | ---------------- |
| HTTP request parsing, response shaping             | Presentation     |
| React component, hook, JSX                         | Presentation     |
| Calling a use case                                 | Presentation     |
| `execute()` orchestrating the business operation   | Application      |
| `Result` -> HTTP status mapping                    | Presentation     |
| Pure validation rule                               | Domain (service) |
| Identifier-casing rule (`csharp-noun`, …)          | Domain (VO)      |
| Role / permission predicate                        | Domain (service) |
| Repository / port interface declaration            | Domain (port)    |
| Drizzle query, fetch call, file I/O                | Infrastructure   |
| Wiring concrete repos into use cases               | Composition root |
| `Result<T,E>`, `AppError`                          | `@workspace/kernel` |

---

## 3. Result discipline

Every application use case returns
`Promise<Result<TSuccess, AppError | DomainError>>` from
`@workspace/kernel`. Callers must inspect the `kind` discriminant.

```ts
import { ok, err, type Result } from "@workspace/kernel";

export class GetProjectByIdUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(
    id: string,
  ): Promise<Result<Project, NotFoundError | InfrastructureError>> {
    const found = await this.projects.findById(id);
    if (!found) return err(notFoundError("Project", id));
    return ok(found);
  }
}
```

Presentation handlers translate the `err` branch into the appropriate
transport response (HTTP status via `httpStatusForAppError`, toast
notification, form-field error, etc.). They never throw across the
boundary.

Infrastructure adapters wrap their I/O in `fromPromise` / `fromThrowable`
(or equivalent try/catch) and map driver-specific exceptions into the
typed `AppError` shapes before returning. A `pg` exception, for example,
becomes an `infrastructureError`.

---

## 4. Composition root

Each artifact has exactly one composition root that constructs the
dependency graph at boot and exposes use cases to the presentation
layer:

- **api-server** — `src/composition/container.ts`. `index.ts` builds the
  container once and route modules import the use cases from it.
- **test-builder** — `src/app/di/container.ts` plus
  `src/app/providers/AppProviders.tsx`. The provider wraps the React
  tree and exposes the container via `useContainer()`.

Tests construct their own container with stub adapters; they never
import the production `buildContainer()`.

---

## 5. The shared kernel (`@workspace/kernel`)

The kernel sits below the domain layer and contains only
framework-agnostic primitives:

- `Result<T, E>`, plus `ok` / `err` / `map` / `mapErr` / `andThen` /
  `unwrap` / `unwrapOr` / `fromThrowable` / `fromPromise`.
- The `AppError` family (`ValidationError`, `NotFoundError`,
  `UnauthorizedError`, `ForbiddenError`, `ConflictError`,
  `InfrastructureError`, `UnknownError`).
- `httpStatusForAppError` for the default HTTP mapping.

The kernel imports nothing from `lib/db`, `lib/api-zod`,
`lib/api-client-react`, React, Express, Drizzle, or any artifact. If a
piece of code needs a runtime, it doesn't belong in the kernel.

---

## 6. Size budgets

To keep files reviewable and to surface SRP violations early:

- React component file (`.tsx`): **≤ 200 lines**.
- Application use case (anything under `**/application/useCases/**`):
  **≤ 80 lines**.
- Class file (a `.ts` declaring `class X`): **≤ 120 lines**.

Enforced by `scripts/src/check-size-budgets.ts`, wired into
`pnpm run build` as `pnpm --filter @workspace/scripts run check-size-budgets`.
The checker walks both artifact `src/` trees and `lib/*/src`, skips
tests (`__tests__/`, `*.test.*`, `*.spec.*`), and fails CI on:

- any **new** file that exceeds its budget, or
- any **baselined** file (recorded in `scripts/size-budget-baseline.json`)
  that **grew** past the size it had when it was added to the baseline.

The baseline is the agreed list of pre-existing over-budget files
inherited from the giant pre-refactor modules — they're tracked as tech
debt with downstream split tasks queued against them. Run
`pnpm --filter @workspace/scripts run check-size-budgets -- --update-baseline`
after a deliberate split so the new (smaller) sizes become the new
ceiling, and note the update in `docs/REFACTORING_PLAN.md`.

Splitting happens *because* responsibilities can be separated, never
just to hit the number.

---

## 7. Layering enforcement (`lint:layers`)

`dependency-cruiser` configs in each artifact enforce the dependency
rule mechanically:

- `artifacts/api-server/.dependency-cruiser.cjs`
- `artifacts/test-builder/.dependency-cruiser.cjs`

Both are wired up as `pnpm --filter @workspace/<artifact> run lint:layers`
and enforce:

- `domain` may not import from `application` / `infrastructure` /
  `presentation` (only from itself and `@workspace/kernel`; the
  api-server's `domain-no-outward-imports` rule additionally
  whitelists `.txt` resource imports so default architectures can
  load the shared scaffolding templates).
- `application` may not reach into `infrastructure` / `presentation`
  / `pages` / `components`.
- `presentation` may not import directly from `infrastructure`.
- No circular imports inside `src/features/`.

Strict TypeScript is on at the repo root via `tsconfig.base.json`:
`strictFunctionTypes`, `noUnusedLocals`, `noUnusedParameters`, and
`exactOptionalPropertyTypes`. These flags catch silent contract drift
— e.g. an optional prop being passed as an explicit `undefined` that
the receiver did not opt into — at the same boundaries the layering
rules guard.

---

## 8. Worked example — the `auth` slice (api-server)

The api-server `auth` feature is the canonical end-to-end example of
the ports/adapters pattern. All four sign-in code paths (local
username/password, sign-out, OIDC callback, bearer-token verification)
run through it.

```
artifacts/api-server/src/features/auth/
├── domain/
│   ├── ports/
│   │   ├── userRepository.ts      what use cases need from "users"
│   │   ├── passwordHasher.ts      bcrypt-shaped interface, no bcrypt
│   │   ├── sessionStore.ts        login/regenerate/save/destroy
│   │   ├── oidcTokenVerifier.ts   verify access tokens against JWKS
│   │   └── oidcGateway.ts         IDP I/O (exchange, refresh, userinfo)
│   └── claims.ts                  pure claim-shape rules
├── application/
│   └── useCases/
│       ├── signInLocal.ts         Result<Session, AppError>
│       ├── signOut.ts             clears session via SessionStore port
│       ├── verifyBearerToken.ts   bearer-auth middleware uses this
│       └── signInOidcCallback.ts  returns discriminated outcome
│                                  (success | deny(marker, …) |
│                                   userinfo_unauthorized)
├── infrastructure/
│   └── adapters/
│       ├── drizzleUserRepository.ts    implements UserRepository
│       ├── bcryptPasswordHasher.ts     implements PasswordHasher
│       ├── expressSessionStore.ts      per-request SessionStore proxy
│       ├── joseOidcTokenVerifier.ts    JWKS verification via `jose`
│       └── nexusOidcGateway.ts         HTTP calls into the identity provider
└── presentation/
    ├── routes/                    POST /auth/login, /logout,
    │                              GET /auth/sso/callback, etc.
    └── middleware/                bearerAuth, requireAuth, requireRole
```

The composition root at `artifacts/api-server/src/composition/container.ts`
constructs each adapter once and injects them into the use cases:

```ts
const userRepo = new DrizzleUserRepository();
const hasher = new BcryptPasswordHasher();
const tokenVerifier = new JoseOidcTokenVerifier();
const oidcGateway = new NexusOidcGateway();

const auth = {
  signInLocal: new SignInLocalUseCase(userRepo, hasher),
  signOut: new SignOutUseCase(),
  verifyBearerToken: new VerifyBearerTokenUseCase(tokenVerifier, oidcGateway, userRepo),
  signInOidcCallback: new SignInOidcCallbackUseCase(oidcGateway, userRepo),
};
```

The route handler then resolves the use case from the container and
maps its `Result` to HTTP:

```ts
const result = await getContainer().useCases.auth.signInLocal
  .execute({ username, password }, new ExpressSessionStore(req));

if (result.kind === "err") {
  return res.status(httpStatusForAppError(result.error)).json({
    message: result.error.message,
  });
}
return res.json(result.value);
```

Tests construct their own container with stub adapters that implement
the same port interfaces. They never touch `buildContainer()` or the
real Drizzle / bcrypt / `jose` / `fetch` stack — port-mocked unit tests
live under `application/useCases/__tests__/`.

---

## 9. Per-artifact entry points

| Artifact      | Entry            | Composition root                   |
| ------------- | ---------------- | ---------------------------------- |
| api-server    | `src/index.ts`   | `src/composition/container.ts`     |
| test-builder  | `src/main.tsx`   | `src/app/di/container.ts` (built by `AppProviders`) |

The orval-generated React Query client (`@workspace/api-client-react`)
remains the canonical HTTP layer for test-builder. Repositories in
`infrastructure/repositories/` wrap the generated hooks so the
application layer never sees `useXxxQuery` directly.
