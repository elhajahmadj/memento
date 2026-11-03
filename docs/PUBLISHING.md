# Publishing memento to Fly.io + Neon

This runbook walks you through publishing memento to the public internet
the cheapest way that stays up: a single **Fly.io** machine for the app
and a free **Neon** project for Postgres. Follow it top-to-bottom — every
command is meant to be copy-pasted from your shell.

> Looking for the broader publishing reference (other hosts, CI, env vars
> per service)? See [`/PUBLISHING.md`](../PUBLISHING.md) and the chapters
> under [`docs/publishing/`](publishing/). This file is the *one specific
> path* — Fly + Neon — written as a runbook.

## What you'll end up with

- One Fly app named e.g. `memento-yourname` running both the Express API
  and the Vite-built SPA on port `8080`, behind Fly's automatic
  `https://<app>.fly.dev` TLS.
- One Neon Postgres project holding all application data + sessions.
- A 1 GB Fly volume mounted at `/data` for generated test workspaces,
  validation traces, and screenshot baselines.
- Free-tier-friendly defaults: the machine scales to zero when idle.

## Prerequisites

- A free [Neon](https://neon.tech/) account.
- A free [Fly.io](https://fly.io/) account (a credit card is required for
  signup but the configuration here fits inside the free allowance — see
  [Cost expectations](#cost-expectations)).
- This repo cloned locally; you do **not** need Node installed unless you
  want to run the optional schema push from your laptop. Docker is only
  needed for the optional local smoke test.

---

## 1. Create the Neon database

1. Sign in at <https://neon.tech/> and click **New Project**.
2. Pick the region closest to where you'll run the Fly machine
   (e.g. `AWS us-east-2` if you'll deploy to Fly's `iad`).
3. Accept defaults for compute size and Postgres version (16+).
4. Open the **Connection Details** panel and copy the **Pooled connection**
   string. It looks like:
   ```
   postgresql://USER:PASSWORD@ep-XXXX-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   The pooled host is required because the api-server uses `pg.Pool`; the
   direct (non-pooled) host will exhaust idle connections under load.

Save that string somewhere private — you'll feed it to Fly as
`DATABASE_URL` in step 5.

## 2. Install flyctl and sign in

| OS | Install command |
| --- | --- |
| macOS / Linux | `curl -L https://fly.io/install.sh \| sh` |
| Windows (PowerShell) | `iwr https://fly.io/install.ps1 -useb \| iex` |
| Homebrew | `brew install flyctl` |

Then:

```sh
fly auth signup     # first time only
# or
fly auth login
```

## 3. Create the Fly app

From the repo root:

```sh
fly launch --no-deploy --copy-config
```

When prompted:

- **App name:** anything globally unique (e.g. `memento-yourname`). Edit
  `app = "..."` in `fly.toml` afterwards if you accept Fly's
  auto-generated name.
- **Region:** the region closest to your Neon project.
- **Provision Postgres?** **No.** We're using Neon.
- **Provision Redis / Tigris / Sentry?** **No.**
- **Deploy now?** **No** — we still need to create the volume and set
  secrets.

`--copy-config` tells flyctl to keep the `fly.toml` already in this repo
instead of overwriting it with its auto-generated one. If it prompts to
overwrite, decline.

## 4. Create the persistent volume

The api-server writes generated test solutions, validation traces, and
visual-regression baselines to `/data`. Without a volume, those vanish on
every deploy or machine restart.

```sh
fly volumes create recorder_data --size 1 --region <same-region-as-app>
```

The volume name **must** be `recorder_data` — that matches the
`[[mounts]] source` entry in `fly.toml`.

## 5. Set secrets

```sh
fly secrets set \
  DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" \
  SESSION_SECRET="$(openssl rand -hex 32)"
```

That's the **minimum** set the application needs. The full list of
variables the code reads (and what's optional) is in
[`docs/publishing/03-environment.md`](publishing/03-environment.md). Two
worth knowing about for a Fly deploy:

- `LOG_LEVEL` — defaults to `info`; set to `debug` while debugging a
  deploy, then unset.
- `WORKSPACE_DIR` — already set to `/data` in `fly.toml`; only override
  if you change the mount path.

Do **not** set `APP_ENVIRONMENT=local` or `development` in production —
that re-enables the password-bypass `/api/auth/dev-login` route. The
default in `fly.toml` (`production`) keeps it disabled.

### Optional: Enable SSO

memento can additionally accept "Sign in with SSO" through any
OpenID Connect provider. The four secrets below must all be set together —
omitting any one of them disables the SSO button without breaking
local username/password sign-in. The api-server logs a single warning
at boot if some are set but not all, naming the missing variables.

```sh
fly secrets set \
  OIDC_CLIENT_ID="<client id from your identity provider>" \
  OIDC_CLIENT_SECRET="<client secret from your identity provider>" \
  OIDC_ISSUER_URL="https://your-idp.example.com/" \
  OIDC_REDIRECT_URL="https://<your-app>.fly.dev/api/auth/sso/callback"
```

With your identity provider, register memento's redirect URI as the
value you used for `OIDC_REDIRECT_URL` — it must end in
`/api/auth/sso/callback` (e.g.
`https://<your-app>.fly.dev/api/auth/sso/callback`).

### Optional: Enable IdP user provisioning

The "Add user" dialog in Settings → Users can create accounts directly
in your identity provider via the partner endpoint
`POST /api/users/provision`. memento authenticates as the integration
itself with an **IdP partner API key**; there is no per-admin
OAuth2 token forwarded. Set all three secrets together:

```sh
fly secrets set \
  IDP_PROVISIONING_ENABLED=1 \
  IDP_API_BASE_URL="https://your-idp.example.com" \
  IDP_API_KEY="<partner key minted in your identity provider>"
```

The key carries an organization scope set at the identity provider when
it is minted. That scope must match the calling admin's active SSO org
(memento sends that org's id as `organizationId` on every provisioning
call); the identity provider rejects mismatches.

When `IDP_PROVISIONING_ENABLED=1` is set but `IDP_API_BASE_URL` or
`IDP_API_KEY` is missing, the api-server logs a single warning at
boot listing the missing variable(s), the dialog hides the IdP path
for the caller, and the route returns HTTP 503 with
`"IdP API key not configured"` so the misconfiguration is obvious.

### Optional: Authenticate `/api/*` with a bearer token

Once the four SSO env vars above are set, memento additionally
accepts an identity-provider-issued OAuth2 access token in the
`Authorization: Bearer <token>` header on any `/api/*` request — no
session cookie required. This is the path machine-to-machine and
external script callers should use.

The token is verified against the identity provider's JWKS (issuer +
audience pinned to your client id, expiry enforced); on success memento
provisions or updates the matching user the same way the SSO callback
does, so a bearer-authed user and an SSO-authed user end up identical in
the database. Missing, malformed, expired, or wrong-audience tokens
return `401`. No additional env vars are required — bearer auth
reuses the SSO config.

Example:

```sh
curl -H "Authorization: Bearer $OIDC_ACCESS_TOKEN" \
  https://<your-app>.fly.dev/api/auth/me
```

## 6. Deploy

```sh
fly deploy
```

Expect 5–10 minutes the first time (it pulls the Playwright base image,
installs `pnpm` deps, builds both artifacts). Subsequent deploys are
much faster thanks to layer caching.

A successful deploy ends with:

```
✓ Machine <id> [app] update succeeded
✓ Machine started, waiting for health checks to pass
✓ 1/1 health checks passing
```

If it doesn't, jump to [Troubleshooting](#troubleshooting).

## 7. Push the database schema

Neon starts empty. Push the Drizzle schema once on first deploy, **and
again every time `lib/db/src/schema/` changes in a release** — schema
changes do not ship with the container image. Symptoms of skipping
this step are 500s like `column "..." does not exist` on the routes
that touch the new column (e.g. SSO callback failing with
`column "role" does not exist` when `user_organizations.role` is
missing).

**Option A — from your laptop, pulling the prod URL from Fly**
(recommended; works without having Neon credentials on hand):

```sh
# 1. Make sure at least one machine is started so `fly ssh` works.
fly status -a <your-app>

# 2. Pull DATABASE_URL out of the running machine's env and push.
PROD_DB_URL=$(fly ssh console -a <your-app> \
  -C "printenv DATABASE_URL" 2>/dev/null \
  | tr -d '\r' | grep -E '^postgres' | head -1)

DATABASE_URL="$PROD_DB_URL" pnpm --filter @workspace/db run push
```

You only need Node 24 + pnpm + a one-time `pnpm install` for this.

**Option A' — from your laptop, with the Neon URL on hand:**

```sh
DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" \
  pnpm --filter @workspace/db run push
```

**Option B — from inside the running container** (no local Node needed):

```sh
fly ssh console -C "sh -lc 'cd /app && node -e \"require(\\\"child_process\\\").execSync(\\\"npx --yes drizzle-kit push --config lib/db/drizzle.config.ts\\\", {stdio:\\\"inherit\\\"})\"'"
```

Drizzle is interactive when it's unsure; run it from your laptop the
first time so you can answer prompts.

> Tip: if `fly ssh console` reports "app … has no started VMs",
> wake the machine first with `curl https://<your-app>.fly.dev/api/healthz`
> and retry — Fly auto-stops idle apps.

## 8. Seed the first admin user

memento ships a seed routine (`artifacts/api-server/src/features/auth/infrastructure/seed.ts`)
that runs **on every server boot** and creates the development fixture
accounts (`admin@example.com`, etc.) if they don't already exist. After
the first deploy those users will be present in Neon.

> ⚠️ **Known gap:** the seed currently uses development-grade passwords
> for the fixture users. Before you give the URL to anyone, sign in as
> `admin@example.com`, change the password from the Admin → Users page,
> and rotate or delete the other seeded accounts. There is no
> production-only seed today — see follow-up work in `replit.md`.

## 9. Verify

```sh
# 1. Health endpoint should return JSON `{"status":"ok"}`.
curl https://<your-app>.fly.dev/api/healthz

# 2. The SPA should load (HTML, not JSON).
curl -I https://<your-app>.fly.dev/
```

Then open `https://<your-app>.fly.dev/` in a browser, sign in with the
admin account, and run the smoke test in
[`docs/publishing/09-verification.md`](publishing/09-verification.md)
(create a project, record a step, generate code).

## 10. (Optional) Smoke-test the container locally first

If you want to catch SPA / API wiring problems *before* a Fly deploy,
build and run the image on your laptop. You need Docker Desktop or
equivalent.

```sh
docker build -t memento .

docker run --rm -p 8080:8080 \
  -e DATABASE_URL="postgresql://...neon.tech/...?sslmode=require" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  memento
```

Then visit `http://localhost:8080/` (SPA) and
`http://localhost:8080/api/healthz` (API) — both should respond from the
same port. State written to `/data` won't persist across `docker run`
invocations unless you add a `-v memento-data:/data` mount.

You can also do a non-Docker smoke test of just the production wiring:

```sh
pnpm install
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/test-builder run build
NODE_ENV=production PORT=8080 SESSION_SECRET=local DATABASE_URL=... \
  node artifacts/api-server/dist/index.mjs
```

Hitting `/` should return the SPA `index.html`; `/api/healthz` should
return JSON.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| First request after a quiet period takes 5–10s | Cold start — the machine was scaled to zero. Set `min_machines_running = 1` in `fly.toml` to keep one warm (consumes free-tier hours faster). |
| `fly deploy` fails with "Out of memory (137)" while running Chromium | Bump `[[vm]] memory` in `fly.toml` from `"1gb"` to `"2gb"` and redeploy. Headless Chromium needs the headroom; smaller machines OOM-kill on the first recording. |
| API responds but DB calls hang or 500 | Neon's free tier idles the database after ~5 minutes; the first query after idle takes 1–3 seconds. If it persistently fails, double-check you used the **pooled** connection string. |
| `SESSION_SECRET environment variable is required` in logs | You skipped step 5. Run `fly secrets set SESSION_SECRET=...` and Fly will redeploy automatically. |
| `column "..." does not exist` errors after a code update | Re-run step 7 — schema changes don't ship with the image. |
| `Browser executable not found` in the recorder | The Playwright runtime image tag in `Dockerfile` drifted from the `playwright` version in `artifacts/api-server/package.json`. Re-pin both to the same version, then `fly deploy`. |
| Nothing in `fly logs` and the URL just hangs | The machine may have failed health checks and stopped. `fly status`, then `fly logs --no-tail` to read the last boot. |

Useful flyctl commands:

- `fly logs` — live tail.
- `fly status` — machine state, health, IP.
- `fly ssh console` — shell into the running container (e.g. to inspect
  `/data` or run a one-off Drizzle push).
- `fly releases` — deploy history; `fly deploy --image-label vN` to roll
  back.
- `fly scale memory 2048` — quick memory bump without editing `fly.toml`.

---

## Cost expectations

The configuration in `fly.toml` is sized to fit inside Fly.io's free
allowance for a single low-traffic app:

- 1× shared-cpu-1x with 1 GB RAM, scaled to zero when idle.
- 1 GB Fly volume.
- A few GB of egress per month.

Things that will push you over the free allowance:

- Setting `min_machines_running = 1` (always-on costs ~\$5/mo for the
  1 GB machine).
- Bumping memory to 2 GB or larger.
- Sustained traffic / large screenshot baselines pushing past 1 GB on
  the volume.

Neon's free tier covers a single project with ~0.5 GB of storage and
auto-suspend after 5 minutes of idle — plenty for a personal deployment.
For real team usage, both providers have inexpensive paid tiers.

Monitor usage on each provider's dashboard:

- Fly: <https://fly.io/dashboard> → your org → **Billing**.
- Neon: <https://console.neon.tech/> → **Billing**.

---

## What's not covered

- **Custom domains.** Stick with `*.fly.dev` for the default cert.
  Adding a domain is a one-time `fly certs create yourdomain.com`; see
  Fly's docs.
- **CI/CD auto-deploy on push.** Tracked separately under the GitHub
  Actions deploy workflow task — for now `fly deploy` from your laptop
  is the entire release process.
- **Object storage for screenshots.** Today they live on the Fly
  volume. If you outgrow 1 GB, swap to S3-compatible storage and point
  `WORKSPACE_DIR` at a mounted bucket — application code changes are
  not yet in scope.
- **`APP_ENVIRONMENT=production` hardening beyond the dev-login route.**
  Anything else in the codebase keyed on `APP_ENVIRONMENT` is treated
  as production by default.
