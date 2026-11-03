# memento

**memento** is a web app for QA engineers / SDETs that scaffolds a real,
runnable Playwright test solution and records browser interactions into
page-object tests — without hand-writing the boilerplate. You record a
flow in the browser, add assertions through a no-code UI, validate the
run, and export a complete test project you run on your own machine.

> **Live demo:** <https://memento-playwright.fly.dev/>
> On the sign-in screen choose **Continue as guest** to try it with no
> account. Guest mode is intentionally limited — it gives you one project
> for a short session so you can scaffold, record, assert, validate, and
> export. Setup surfaces (network mocks, shared steps, architecture
> management), the AI assistant, and Admin/Tools are not available to
> guests. Run the project locally (below) to use the full feature set.

---

## About this project

I've built memento as a solo project over the past 10 months — designing,
recording, scaffolding, and refining the whole record-to-page-object loop
on my own. It has reached the point where it's ready to be shared, so I'm
publishing it for the community to use and help shape. Contributions,
issues, and ideas are very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
to get started.

---

## What it does

- **Record → page objects.** Drive a headless Chromium session in the
  browser; clicks, fills, and navigations are captured and compiled into
  per-suite `Selectors`, `Actions`, and one test class per recording.
- **Four target languages**, each producing a real, runnable solution:

  | Language | Runner | Layout |
  | --- | --- | --- |
  | **C# (.NET / NUnit)** | `dotnet test` | Visual Studio solution (`.sln`) |
  | **Python (pytest)** | `pytest` | `pyproject.toml` + `requirements.txt` |
  | **Node.js (`@playwright/test`)** | `npx playwright test` | `package.json` + `playwright.config.ts` |
  | **Java (JUnit 5 + Playwright)** | `mvn test` | Maven multi-module |

- **No-code assertions.** A catalog of assertion kinds (element visible /
  hidden, count, attribute/value/text, URL, HTTP response status,
  out-of-band API checks, accessibility via axe-core, and visual baseline
  diffs) that compile down to the right call in your chosen language.
- **Network mocks.** Per-project `page.route()` interceptions the recorder
  and Validate install before navigation, so you can record and replay
  against deterministic canned responses.
- **Validate.** Run a recorded suite (or every suite at once) and stream
  per-suite status, trace zips, and final-state screenshots back into the
  workbench.
- **Export.** Download the whole solution as a zip and run it anywhere.

An optional in-app **AI assistant** can suggest tests and heal selectors
when you configure your own provider API key — it is off by default and
never required.

---

## Tech stack

- **Monorepo:** pnpm workspaces
- **Backend:** Node.js 24 + Express 5 (TypeScript)
- **Frontend:** React 19 + Vite
- **Database:** PostgreSQL + Drizzle ORM
- **Validation / API contract:** Zod, OpenAPI + Orval-generated client
- **Browser automation:** Playwright

Both apps follow a feature-based **Clean Architecture** (domain →
application → infrastructure → presentation). See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the layering rules,
folder conventions, and a worked example.

---

## Repository layout

```
artifacts/
  api-server/     Express API (feature folders, composition root)
  test-builder/   React + Vite SPA (feature folders, DI container)
lib/
  kernel/         Result<T,E>, AppError family, HTTP status mapping
  db/             Drizzle schema + client
  api-spec/       OpenAPI source of truth
  api-zod/        generated Zod schemas
  api-client-react/ generated React Query hooks
docs/             architecture, environment, deployment, tests
```

---

## Getting started (local development)

### Prerequisites

- **Node.js 24+**
- **pnpm 10+** (`corepack enable` will provide it)
- **PostgreSQL** (local or hosted) — you need a connection string

### 1. Install

```bash
pnpm install
```

Playwright's Chromium is installed on postinstall; to skip it set
`SKIP_PLAYWRIGHT_INSTALL=1` and install later with
`pnpm --filter @workspace/api-server exec playwright install chromium`.

### 2. Configure environment

The server reads configuration from environment variables. The minimum to
run locally:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `SESSION_SECRET` | yes | Secret used to sign session cookies |
| `PORT` | yes | Port the API server (and, in production, the SPA) listens on, e.g. `8080` |
| `APP_ENVIRONMENT` | dev | Set to `local` or `development` to enable dev login and seed demo users |
| `PROJECT_SECRETS_KEY` | optional | Encryption key for stored per-project secrets (Git PATs, AI provider keys) |
| `SMTP_HOST`, `SMTP_FROM`, … | optional | Enable outbound email |

Authentication defaults to **local username/password**. A generic OIDC/SSO
seam is included so you can wire in your own identity provider later; it
stays disabled unless you configure it. See
[`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for the full variable
reference.

### 3. Create the database schema

```bash
pnpm --filter @workspace/db run push
```

### 4. Generate the API client (after any OpenAPI change)

```bash
pnpm --filter @workspace/api-spec run codegen
```

### 5. Build and run

```bash
# Build the SPA + API bundle
pnpm run build

# Start the API server (serves the built SPA and the API on $PORT)
pnpm --filter @workspace/api-server run dev
```

For fast frontend iteration you can also run the Vite dev server
(`pnpm --filter @workspace/test-builder run dev`, which requires `PORT`
and `BASE_PATH`) alongside the API server.

With `APP_ENVIRONMENT=local`, demo users are seeded on a fresh database so
you can sign in immediately. **Change or delete seeded accounts before
exposing an instance publicly** — they use well-known default passwords.

---

## Common commands

| Command | What it does |
| --- | --- |
| `pnpm run typecheck` | Typecheck every package |
| `pnpm run build` | Typecheck + guard checks + build all packages |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate Zod schemas + React Query hooks |
| `pnpm --filter @workspace/db run push` | Push the Drizzle schema to the database |
| `pnpm --filter @workspace/api-server run dev` | Run the API server |

---

## Deployment

The app ships with a `Dockerfile` and a `fly.toml` for deploying to
[Fly.io](https://fly.io) against a managed PostgreSQL database. See
[`docs/PUBLISHING.md`](docs/PUBLISHING.md) for a step-by-step runbook.

---

## Contributing

Contributions are welcome. Please read
[`CONTRIBUTING.md`](CONTRIBUTING.md) for how to set up, the architecture
and size-budget conventions, and how to run the checks before opening a
pull request.

---

## License

Licensed under the **PolyForm Noncommercial License 1.0.0** — see
[`LICENSE`](LICENSE).

In short: you may use, modify, and share this software freely for **any
noncommercial purpose**, and any changes you make and distribute must be
offered under these same terms. **Commercial use — including selling the
software or a service based on it — is not permitted.** This means the
project is source-available and free for noncommercial use, but it is not
an OSI "open source" license.
