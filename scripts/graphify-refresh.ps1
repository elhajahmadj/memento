# Keep the graphify knowledge graph fresh (Windows / PowerShell).
#
# Re-extracts the codebase AST into graphify-out/ (deterministic, no LLM/API cost) so the graph the
# team queries via `graphify explain/path/query` stays in sync with the code. Safe to run anytime.
#
# Idempotent + non-fatal by design: if `graphify` isn't on PATH it prints a hint and exits 0 (never
# blocks a commit/merge). `graphify update .` is incremental (only changed files re-extract).
#
# Manual run:  pwsh scripts/graphify-refresh.ps1   (or)   powershell -File scripts\graphify-refresh.ps1
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')

$graphify = Get-Command graphify -ErrorAction SilentlyContinue
if (-not $graphify) {
  Write-Host "[graphify-refresh] graphify not installed - skipping graph refresh."
  Write-Host "[graphify-refresh] Install once with:  uv tool install graphifyy   (then: graphify install --project)"
  exit 0
}

if (Test-Path 'graphify-out/graph.json') {
  Write-Host "[graphify-refresh] updating graphify-out/ (AST-only, no API cost)..."
  try { & graphify update . } catch { Write-Host "[graphify-refresh] update failed - non-fatal, continuing." }
} else {
  Write-Host "[graphify-refresh] no graph yet - building graphify-out/ (code-only, AST)..."
  try { & graphify extract . --code-only } catch { Write-Host "[graphify-refresh] build failed - non-fatal, continuing." }
}
exit 0
