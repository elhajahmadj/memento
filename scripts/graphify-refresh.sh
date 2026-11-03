#!/bin/bash
# Keep the graphify knowledge graph fresh.
#
# Re-extracts the codebase AST into graphify-out/ (deterministic, no LLM/API cost) so the graph the
# team queries via `graphify explain/path/query` stays in sync with the code. Safe to run anytime.
#
# Idempotent + non-fatal by design:
#   - if `graphify` isn't installed, it prints a hint and exits 0 (never blocks a commit/merge/CI);
#   - `graphify update .` is incremental (only changed files re-extract).
#
# Manual: `bash scripts/graphify-refresh.sh`
set -uo pipefail
cd "$(dirname "$0")/.."

if ! command -v graphify >/dev/null 2>&1; then
  echo "[graphify-refresh] graphify not installed — skipping graph refresh."
  echo "[graphify-refresh] Install once with:  uv tool install graphifyy   (then: graphify install --project)"
  exit 0
fi

if [ -f graphify-out/graph.json ]; then
  echo "[graphify-refresh] updating graphify-out/ (AST-only, no API cost)…"
  graphify update . || echo "[graphify-refresh] update failed — non-fatal, continuing."
else
  echo "[graphify-refresh] no graph yet — building graphify-out/ (code-only, AST)…"
  graphify extract . --code-only || echo "[graphify-refresh] build failed — non-fatal, continuing."
fi
exit 0
