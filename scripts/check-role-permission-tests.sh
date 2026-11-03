#!/usr/bin/env bash
# CI-style execution of the C# role-permission UX tests.
#
# Runs the subset of `Memento.UxTests.Tests` that exercises role gating:
#   - RoleAccessMatrixTests.cs   -> Admin/LimitedAdmin/User RouteMatrix + TopNav fixtures
#   - AuthTests.cs               -> LimitedAdminSignOutTests, UserSignOutTests
#
# These cover the role x surface matrix from Task #58 (Tools nav, Settings
# sections, sign-out parity, redirects). The api-server and test-builder
# artifacts must already be running and reachable through the shared proxy
# (`http://localhost:80`), and the api-server must have `APP_ENVIRONMENT`
# set to `local` or `development` so `/api/auth/dev-login` is enabled and
# the seeded AdminRole / LimitedAdminRole / UserRole users exist.
#
# Usage:
#   scripts/check-role-permission-tests.sh
#
# Optional env:
#   ROLE_TESTS_BASE_URL       default http://localhost:80
#   ROLE_TESTS_TRX_PATH       default <repo>/memento-ux-tests/TestResults/role-permission.trx
#   SKIP_PLAYWRIGHT_INSTALL=1 skip the one-shot Playwright browser install

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

BASE_URL="${ROLE_TESTS_BASE_URL:-http://localhost:80}"
TRX_PATH="${ROLE_TESTS_TRX_PATH:-${REPO_ROOT}/memento-ux-tests/TestResults/role-permission.trx}"

if ! command -v dotnet >/dev/null 2>&1; then
  echo "ERROR: dotnet SDK not found on PATH. Ensure 'dotnet-8.0' is in .replit modules." >&2
  exit 1
fi

if ! curl --silent --show-error --fail --max-time 5 "${BASE_URL}/api/healthz" >/dev/null; then
  echo "ERROR: ${BASE_URL}/api/healthz did not respond. Start the api-server workflow before re-running." >&2
  exit 1
fi

DEV_LOGIN_STATUS="$(curl -o /dev/null -s -w "%{http_code}" "${BASE_URL}/api/auth/dev-login")"
if [[ "${DEV_LOGIN_STATUS}" == "404" ]]; then
  echo "ERROR: GET /api/auth/dev-login is disabled. Set APP_ENVIRONMENT=development on the api-server." >&2
  exit 1
fi

if ! curl --silent --show-error --fail --max-time 5 "${BASE_URL}/" >/dev/null; then
  echo "ERROR: ${BASE_URL}/ did not respond. Start the test-builder workflow before re-running." >&2
  exit 1
fi

SLN="memento-ux-tests/Memento.UxTests.sln"
TEST_PROJECT="memento-ux-tests/Memento.UxTests.Tests/Memento.UxTests.Tests.csproj"

echo "Restoring ${SLN}..."
dotnet restore "${SLN}" >/dev/null

echo "Building ${SLN} (Release)..."
dotnet build "${SLN}" --configuration Release --no-restore >/dev/null

if [[ "${SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]]; then
  echo "Ensuring Playwright Chromium (C# driver build) is installed..."
  "${REPO_ROOT}/scripts/install-playwright-csharp.sh" chromium
fi

# NUnit filter targeting only the role-permission fixtures. `~` is
# substring match on FullyQualifiedName, `|` is OR.
FILTER='FullyQualifiedName~RouteMatrixTests|FullyQualifiedName~TopNavTests|FullyQualifiedName~LimitedAdminSignOutTests|FullyQualifiedName~UserSignOutTests'

mkdir -p "$(dirname "${TRX_PATH}")"

echo "Running role-permission UX tests..."
echo "  filter: ${FILTER}"
echo "  base URL: ${BASE_URL}"
echo "  trx: ${TRX_PATH}"

dotnet test "${TEST_PROJECT}" \
  --configuration Release \
  --no-build \
  --filter "${FILTER}" \
  --logger "trx;LogFileName=${TRX_PATH}" \
  --logger "console;verbosity=normal"

echo "OK: role-permission UX tests passed."
