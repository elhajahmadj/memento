#!/usr/bin/env bash
# CI-style drift check for the generated role/page documentation matrix.
#
# Regenerates the matrix markdown into a temp file from the typed
# source at `artifacts/test-builder/src/lib/docs/matrix.ts` and diffs
# it against the committed `docs/role-page-matrix.md`. Exits non-zero
# (printing a unified diff) if the committed file is stale.
#
# To fix a failing run:
#   pnpm --filter @workspace/test-builder run docs:matrix
#
# Usage:
#   scripts/check-role-page-matrix.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

COMMITTED="docs/role-page-matrix.md"
if [[ ! -f "${COMMITTED}" ]]; then
  echo "ERROR: ${COMMITTED} is missing. Run: pnpm --filter @workspace/test-builder run docs:matrix" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
GENERATED="${TMP_DIR}/role-page-matrix.md"

pnpm --filter @workspace/test-builder exec tsx \
  ./scripts/gen-role-page-matrix.ts \
  --out "${GENERATED}" >/dev/null

if ! diff -u "${COMMITTED}" "${GENERATED}"; then
  echo "" >&2
  echo "ERROR: ${COMMITTED} is out of date with artifacts/test-builder/src/lib/docs/matrix.ts." >&2
  echo "Run: pnpm --filter @workspace/test-builder run docs:matrix" >&2
  echo "Then commit the updated ${COMMITTED}." >&2
  exit 1
fi

echo "OK: ${COMMITTED} is up to date."
