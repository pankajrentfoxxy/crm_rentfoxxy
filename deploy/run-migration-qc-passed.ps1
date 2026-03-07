# Run order_items qc_passed migration on Hostinger VPS
# Usage: .\run-migration-qc-passed.ps1

$VpsIp = "187.77.187.213"
$VpsUser = "root"
$MigrationFile = Join-Path $PSScriptRoot "..\backend\migrations\002_order_items_qc_passed.sql"

if (-not (Test-Path $MigrationFile)) {
    Write-Host "ERROR: Migration file not found: $MigrationFile" -ForegroundColor Red
    exit 1
}

Write-Host "Running qc_passed migration on $VpsIp..." -ForegroundColor Yellow
Write-Host "(Enter root password when prompted)" -ForegroundColor Gray

Get-Content $MigrationFile | ssh "${VpsUser}@${VpsIp}" "docker exec -i laptop-erp-postgres psql -U postgres -d postgres"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Migration completed." -ForegroundColor Green
} else {
    Write-Host "Migration may have had errors. Check output above." -ForegroundColor Yellow
}
