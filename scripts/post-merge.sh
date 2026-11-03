#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Backstop: ensure Playwright's Chromium binary is present even if the
# api-server's `postinstall` hook was skipped (e.g. when pnpm decides nothing
# changed and short-circuits scripts). The recorder, in-app Validate, and
# architecture preview all launch Chromium via Playwright; without the binary
# on disk those features 400 the moment a user clicks "Start Recording".
# The script itself is idempotent and tolerates sandboxed environments.
node artifacts/api-server/scripts/install-chromium.mjs || true

# C# UX tests pin Microsoft.Playwright to a different driver version than
# the Node Playwright above, so they need their own browser build under
# `.cache/ms-playwright/chromium-<rev>/`. Idempotent and tolerant of
# environments without `dotnet`.
bash scripts/install-playwright-csharp.sh || true
