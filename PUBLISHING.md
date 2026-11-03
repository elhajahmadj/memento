# Publishing memento

This is the operator-facing guide for shipping memento (the api-server +
test-builder web app) to a real environment. If you just cloned the repo
and need to know how to put it in front of users, start here.

For developer-facing handoff information (repo layout, conventions,
local development), see [`HANDOFF.md`](HANDOFF.md). For architecture
details, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Reading order

The detailed publishing docs live under [`docs/publishing/`](docs/publishing/).
Read them in order the first time:

1. [Overview](docs/publishing/01-overview.md) — what gets deployed and how
   the two artifacts fit together behind a single proxy.
2. [Prerequisites](docs/publishing/02-prerequisites.md) — Node, pnpm,
   PostgreSQL, and the Chromium binary Playwright needs.
3. [Environment variables & secrets](docs/publishing/03-environment.md) —
   every variable the application actually reads.
4. [Database (PostgreSQL)](docs/publishing/04-database.md) — provisioning
   Postgres 16, the `DATABASE_URL` shape, running Drizzle migrations,
   and the auto-managed `user_sessions` table.
5. [Build](docs/publishing/05-build.md) — `pnpm install`, `pnpm run typecheck`,
   `pnpm run build`, output directories, and the handoff zip.
6. [CI/CD pipelines](docs/publishing/06-cicd.md) — how the existing
   `doc-screenshots.yml` workflow is wired and a recommended template
   for a publish/release pipeline.
7. [Hosting](docs/publishing/07-hosting.md) — Replit Autoscale (default)
   and a generic Node host / container path.
8. [Production runtime](docs/publishing/08-production.md) — start
   commands, session cookies + `trust proxy`, logging.
9. [Post-deploy verification](docs/publishing/09-verification.md) — what
   to hit and what you should see.
10. [Troubleshooting](docs/publishing/10-troubleshooting.md) — the
    failure modes that bite people first.

For an end-to-end runbook of the cheapest hosting option (single Fly.io
machine + free Neon Postgres), see [`docs/PUBLISHING.md`](docs/PUBLISHING.md).
That guide is opinionated and copy-pasteable; the chapter list above is
the reference for everything else.

## Quick reference

| Topic | Where to look |
| --- | --- |
| Required runtime versions | [Prerequisites](docs/publishing/02-prerequisites.md) |
| `DATABASE_URL`, `SESSION_SECRET`, `PORT`, `BASE_PATH` | [Environment](docs/publishing/03-environment.md) |
| Drizzle `push` schema | [Database](docs/publishing/04-database.md) |
| What the build emits and where | [Build](docs/publishing/05-build.md) |
| Path-routing rule (`/api` → api-server, `/` → test-builder) | [Hosting](docs/publishing/07-hosting.md) |
| Health probe `GET /api/healthz` | [Verification](docs/publishing/09-verification.md) |

## Regenerating the HTML

Each Markdown file in this set has a sibling `.html` file so the docs
can be read directly in a browser without a Markdown viewer. The HTML
is produced by [`scripts/build-publishing-docs.mjs`](scripts/build-publishing-docs.mjs)
and is committed to the repo.

```bash
pnpm run docs:publishing
```

The script is idempotent — running it again over unchanged Markdown
produces byte-identical HTML output.
