# Schema export helper for RLMS corporate cutover prep.
# DO NOT run against the live personal Supabase project unless Bruce explicitly requests it.
# This script only prints the exact commands to run (and optionally executes if -Execute is passed).

param(
  [switch]$Execute,
  [string]$OutDir = (Join-Path $PSScriptRoot "..\schema")
)

$ErrorActionPreference = "Stop"
$date = Get-Date -Format "yyyyMMdd"
$schemaFile = Join-Path $OutDir "live_schema_$date.sql"
$rolesFile = Join-Path $OutDir "live_roles_$date.sql"

Write-Host "=== RLMS schema export (prep) ===" -ForegroundColor Cyan
Write-Host "Output dir: $OutDir"
Write-Host ""
Write-Host "Commands that would run:"
Write-Host "  supabase db dump --schema-only -f `"$schemaFile`""
Write-Host "  supabase db dump --role-only -f `"$rolesFile`"   # if supported by your CLI"
Write-Host ""

if (-not $Execute) {
  Write-Host "Dry run only. Re-run with -Execute after linking the Supabase project and confirming you intend a live dump." -ForegroundColor Yellow
  Write-Host "See script/export-schema.md for full notes."
  exit 0
}

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  throw "supabase CLI not found on PATH. Install it first, then re-run."
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "Running schema-only dump..." -ForegroundColor Green
supabase db dump --schema-only -f $schemaFile
if ($LASTEXITCODE -ne 0) { throw "schema dump failed with exit $LASTEXITCODE" }

Write-Host "Attempting roles dump (may fail on older CLIs)..." -ForegroundColor Green
supabase db dump --role-only -f $rolesFile
if ($LASTEXITCODE -ne 0) {
  Write-Host "Roles dump skipped/failed (exit $LASTEXITCODE). Schema dump is still at $schemaFile" -ForegroundColor Yellow
} else {
  Write-Host "Roles dump written to $rolesFile"
}

Write-Host "Done. Review and commit files under schema/." -ForegroundColor Green
