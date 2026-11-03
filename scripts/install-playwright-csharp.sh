#!/usr/bin/env bash
# Install the Playwright browser build that the C# `Microsoft.Playwright`
# NuGet package is pinned to. The Node-side Playwright on this machine is
# usually a different driver version, so `pnpm exec playwright install` does
# not place the binary the C# tests look for (e.g.
# `.cache/ms-playwright/chromium_headless_shell-1187/...`).
#
# We can't use the bundled `playwright.ps1` shim because PowerShell isn't
# available in the Replit Nix environment. Instead we invoke the same
# `Microsoft.Playwright` entry point directly with `dotnet exec`, borrowing
# the test project's runtimeconfig + depsfile so the framework-dependent
# library can resolve its dependencies.
#
# Idempotent: Playwright skips browsers that are already on disk.
#
# Usage:
#   scripts/install-playwright-csharp.sh           # installs chromium (default + headless shell)
#   SKIP_PLAYWRIGHT_CSHARP_INSTALL=1 scripts/...   # no-op, for offline/sandboxed envs

set -euo pipefail

if [[ "${SKIP_PLAYWRIGHT_CSHARP_INSTALL:-0}" == "1" ]]; then
  echo "SKIP_PLAYWRIGHT_CSHARP_INSTALL=1 set; skipping C# Playwright browser install."
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

if ! command -v dotnet >/dev/null 2>&1; then
  echo "WARN: dotnet SDK not found on PATH; skipping C# Playwright browser install." >&2
  exit 0
fi

SLN="memento-ux-tests/Memento.UxTests.sln"
BIN_DIR="memento-ux-tests/Memento.UxTests.Tests/bin/Release/net8.0"
PW_DLL="${BIN_DIR}/Microsoft.Playwright.dll"

if [[ ! -f "${PW_DLL}" ]]; then
  echo "Building ${SLN} (Release) so Microsoft.Playwright.dll is available..."
  dotnet restore "${SLN}" >/dev/null
  dotnet build "${SLN}" --configuration Release --no-restore >/dev/null
fi

if [[ ! -f "${PW_DLL}" ]]; then
  echo "ERROR: ${PW_DLL} still missing after build; cannot install Playwright browsers." >&2
  exit 1
fi

BROWSERS=("${@}")
if [[ ${#BROWSERS[@]} -eq 0 ]]; then
  BROWSERS=("chromium")
fi

echo "Installing Playwright browsers for C# tests: ${BROWSERS[*]}"
(
  cd "${BIN_DIR}"
  dotnet exec \
    --runtimeconfig Memento.UxTests.Tests.runtimeconfig.json \
    --depsfile Memento.UxTests.Tests.deps.json \
    Microsoft.Playwright.dll install "${BROWSERS[@]}"
)

echo "OK: Playwright browsers installed for C# tests."
