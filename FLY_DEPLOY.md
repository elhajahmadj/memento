# Deploying memento to Fly.io — Step by Step

This is the condensed, do-this-in-order guide for getting memento live on
Fly.io with a Neon Postgres database. It mirrors the longer runbook in
[`docs/PUBLISHING.md`](docs/PUBLISHING.md) and folds in the recent
Dockerfile fix that unblocked `fly deploy`.

---

## 0. What you'll end up with

- One Fly app serving both the Express API and the Vite SPA on port `8080`.
- A Neon Postgres database holding all app data and sessions.
- A 1 GB Fly volume mounted at `/data` for generated workspaces, traces,
  and screenshot baselines.
- Free-tier-friendly defaults: the machine scales to zero when idle.

## 1. Create the Neon database

1. Sign in at <https://neon.tech/> and click **New Project**.
2. Pick the region closest to where you'll run the Fly machine.
3. Accept defaults (Postgres 16+).
4. Open **Connection Details** and copy the **Pooled connection** string.
   It looks like:
   ```
   postgresql://USER:PASS@ep-XXXX-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   The pooled host is required — the api-server uses `pg.Pool` and the
   direct host will exhaust idle connections.

Save the string privately for step 5.

## 2. Install flyctl and sign in

| OS | Command |
| --- | --- |
| macOS / Linux | `curl -L https://fly.io/install.sh \| sh` |
| Windows (PowerShell) | `iwr https://fly.io/install.ps1 -useb \| iex` |
| Homebrew | `brew install flyctl` |

```sh
fly auth signup   # first time
# or
fly auth login
```

## 3. Create the Fly app

From the repo root:

```sh
fly launch --no-deploy --copy-config
```

When prompted:

- **App name:** anything globally unique (e.g. `memento-yourname`).
- **Region:** closest to your Neon project.
- **Provision Postgres / Redis / Tigris / Sentry:** **No** to all.
- **Deploy now:** **No** — we still need a volume and secrets.

`--copy-config` keeps the repo's `fly.toml` instead of overwriting it.

## 4. Create the persistent volume

```sh
fly volumes create recorder_data --size 1 --region <same-region-as-app>
```

The name **must** be `recorder_data` to match `[[mounts]] source` in
`fly.toml`. Without it, generated workspaces and baselines vanish on
every restart.

## 5. Set secrets

```sh
fly secrets set \
  DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" \
  SESSION_SECRET="$(openssl rand -hex 32)"
```

Do **not** set `APP_ENVIRONMENT=local` or `development` in production —
that re-enables the password-bypass `/api/auth/dev-login` route. The
default in `fly.toml` (`production`) keeps it disabled.

Optional vars:

- `LOG_LEVEL` (default `info`; bump to `debug` while debugging).
- `WORKSPACE_DIR` already wired to `/data` in `fly.toml`.

## 6. Deploy

```sh
fly deploy
```

First deploy: ~5–10 minutes (pulls the Playwright base image and builds
both artifacts). Subsequent deploys are much faster.

A successful deploy ends with:

```
✓ Machine <id> [app] update succeeded
✓ Machine started, waiting for health checks to pass
✓ 1/1 health checks passing
```

> **Heads up — Dockerfile fix already in place.** Earlier deploys
> failed at builder step 13/16 with
> `Cannot find module '/workspace/artifacts/api-server/scripts/install-chromium.mjs'`.
> The cached install layer was running the api-server's `postinstall`
> hook before `scripts/` had been copied. The `Dockerfile` now passes
> `--ignore-scripts` to that first `pnpm install`, and Chromium is
> provided by the `mcr.microsoft.com/playwright` runtime base image.
> Nothing for you to do here — just don't undo that flag.

## 7. Push the database schema

Neon starts empty. Push the Drizzle schema once (and again whenever
`lib/db/src/schema/` changes).

**From your laptop (recommended):**

```sh
DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" \
  pnpm --filter @workspace/db run push
```

**Or from inside the running container:**

```sh
fly ssh console -C "sh -lc 'cd /app && npx --yes drizzle-kit push --config lib/db/drizzle.config.ts'"
```

## 8. Seed / harden the first admin

The server seeds development fixtures (`admin@example.com` etc.) on
boot. Before sharing the URL:

1. Sign in as `admin@example.com`.
2. Change the password from **Admin → Users**.
3. Rotate or delete the other seeded accounts.

## 9. Verify

```sh
curl https://<your-app>.fly.dev/api/healthz   # → {"status":"ok"}
curl -I https://<your-app>.fly.dev/           # → HTML
```

Then open the URL, sign in as admin, and run the smoke test in
[`docs/publishing/09-verification.md`](docs/publishing/09-verification.md)
(create a project, record a step, generate code).

## 10. (Optional) Local container smoke test

```sh
docker build -t memento .

docker run --rm -p 8080:8080 \
  -e DATABASE_URL="postgresql://...neon.tech/...?sslmode=require" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  memento
```

Visit `http://localhost:8080/` (SPA) and `http://localhost:8080/api/healthz`
(API). Add `-v memento-data:/data` to persist state across runs.

---

## Common pitfalls

| Symptom | Fix |
| --- | --- |
| Build fails at `pnpm install` step with `Cannot find module .../install-chromium.mjs` | Make sure `Dockerfile`'s first `pnpm install --frozen-lockfile` still has `--ignore-scripts`. |
| First request after idle takes 5–10s | Cold start. Set `min_machines_running = 1` in `fly.toml` to keep one warm (uses free-tier hours faster). |
| OOM (137) when launching the recorder | Bump `[[vm]] memory` from `"1gb"` to `"2gb"` in `fly.toml` and redeploy. |
| `column "..." does not exist` after a code update | Re-run step 7 — schema changes don't ship with the image. |
| `SESSION_SECRET environment variable is required` in logs | You skipped step 5. `fly secrets set SESSION_SECRET=...` triggers a redeploy. |
| `Browser executable not found` in the recorder | Playwright runtime image tag in `Dockerfile` drifted from the `playwright` version in `artifacts/api-server/package.json`. Re-pin both, redeploy. |

Useful flyctl commands: `fly logs`, `fly status`, `fly ssh console`,
`fly releases`, `fly scale memory 2048`.

---

## Cost expectations

The defaults fit Fly.io's free allowance for one low-traffic app:

- 1× shared-cpu-1x with 1 GB RAM, scales to zero.
- 1 GB Fly volume.
- A few GB of egress/month.

What pushes you over: `min_machines_running = 1`, larger memory,
sustained traffic, big screenshot baselines.

Neon free tier covers ~0.5 GB and auto-suspends after 5 min idle.

Dashboards: <https://fly.io/dashboard> · <https://console.neon.tech/>.

---

## What's not covered here

- Custom domains (`fly certs create yourdomain.com`).
- CI/CD auto-deploy (tracked separately).
- Object storage for screenshots (today they live on the Fly volume).

For deeper background, troubleshooting tables, and per-env-var
documentation, see [`docs/PUBLISHING.md`](docs/PUBLISHING.md) and the
chapters under [`docs/publishing/`](docs/publishing/).
