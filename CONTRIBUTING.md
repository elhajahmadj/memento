# Contributing to memento

Thanks for your interest in improving memento! This guide covers how to
set up, the conventions the codebase enforces, and how to get a change
merged.

By contributing you agree that your contributions are licensed under the
project's [PolyForm Noncommercial License 1.0.0](LICENSE).

## Getting set up

See the **Getting started** section of the [README](README.md) for
prerequisites and local setup (Node 24+, pnpm 10+, PostgreSQL). In short:

```bash
pnpm install
pnpm --filter @workspace/db run push     # create the schema
pnpm run build                            # typecheck + checks + build
```

## Project conventions

Both apps (`artifacts/api-server`, `artifacts/test-builder`) follow a
feature-based **Clean Architecture**. Please read
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before making structural
changes. The rules that are enforced automatically:

- **Dependency direction** — `domain` depends on nothing outward;
  `application` may use `domain` + the shared kernel only; `presentation`
  must not import `infrastructure` across layers. Enforced by
  dependency-cruiser (`pnpm --filter @workspace/<artifact> run lint:layers`).
- **Result discipline** — application use cases return
  `Result<T, AppError>` from `@workspace/kernel`; presentation maps the
  error branch to a transport response. No throwing across boundaries.
- **Size budgets** — React component files ≤ 200 lines, use cases
  ≤ 80 lines, class files ≤ 120 lines. Enforced by
  `pnpm --filter @workspace/scripts run check-size-budgets`.
- **No deep cross-feature imports** — go through each feature's `index.ts`
  barrel.

## Before you open a pull request

Run the checks the CI/build runs:

```bash
pnpm run typecheck          # all packages typecheck
pnpm run build              # typecheck + guard checks + build
```

Add or update tests for your change:

- **API server unit tests:** `pnpm --filter @workspace/api-server test`
- **SPA unit tests:** `pnpm --filter @workspace/test-builder test`
- **End-to-end (Playwright) tests:** `pnpm --filter @workspace/test-builder run test:e2e`

If you change the API, edit the OpenAPI source in `lib/api-spec/openapi.yaml`
and regenerate the client:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Pull request guidelines

- Keep PRs focused; one logical change per PR.
- Describe what changed and why, and how you verified it.
- Make sure `pnpm run build` passes and new/changed behavior is covered by
  tests.
- Match the style and structure of the surrounding code.

## Reporting bugs and requesting features

Open a GitHub issue with clear reproduction steps (for bugs) or a short
description of the problem you want solved (for features). Screenshots and
the exact language/target you scaffolded are helpful.
