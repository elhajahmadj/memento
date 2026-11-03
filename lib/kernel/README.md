# `@workspace/kernel`

The shared kernel: framework-agnostic primitives consumed at every layer
boundary in the monorepo.

## What lives here

- `Result<T, E>` — discriminated-union type returned by every application
  use case. Replaces ad-hoc `throw` / `null` / `{ok, error}` patterns.
- `AppError` family (`ValidationError`, `NotFoundError`, …) — base error
  shapes plus an `httpStatusForAppError` mapper used by Express
  presentation code.

## What does NOT live here

- React, Express, Drizzle, axios, fetch-wrapper, Zod imports.
- Anything that imports from `lib/db`, `lib/api-zod`, `lib/api-client-react`,
  or any artifact.
- I/O of any kind.

The kernel sits at the very bottom of the dependency graph. If something
needs a runtime, it doesn't belong here.

See `docs/ARCHITECTURE.md` for the full layering rules.
