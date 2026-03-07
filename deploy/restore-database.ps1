# Restore Supabase backup to Hostinger VPS
# Run this script - you will be prompted for VPS root password (twice: for scp and ssh)
# Requires: OpenSSH client (built-in on Windows 10/11) or PuTTY

$BackupFile = Join-Path $PSScriptRoot "supabase_backup.sql"
$VpsIp = "187.77.187.213"
$VpsUser = "root"

if (-not (Test-Path $BackupFile)) {
    Write-Host "ERROR: Backup file not found: $BackupFile" -ForegroundColor Red
    Write-Host "Run backup first: .\backup-supabase.ps1 -ConnectionString '...'"
    exit 1
}

$size = (Get-Item $BackupFile).Length / 1MB
Write-Host "Backup file: $BackupFile ($([math]::Round($size, 2)) MB)" -ForegroundColor Cyan
Write-Host ""

# Step 1: Copy to VPS
Write-Host "Step 1/3: Copying backup to VPS..." -ForegroundColor Yellow
Write-Host "(Enter root password when prompted)" -ForegroundColor Gray
scp $BackupFile "${VpsUser}@${VpsIp}:/tmp/supabase_backup.sql"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to copy. Check SSH connection and password." -ForegroundColor Red
    exit 1
}

# Step 2: Restore
Write-Host ""
Write-Host "Step 2/3: Restoring to PostgreSQL..." -ForegroundColor Yellow
Write-Host "(Enter root password again when prompted)" -ForegroundColor Gray
ssh "${VpsUser}@${VpsIp}" "cat /tmp/supabase_backup.sql | docker exec -i laptop-erp-postgres psql -U postgres -d postgres"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Restore may have had errors. Check above output." -ForegroundColor Yellow
}

# Step 3: Migrations
Write-Host ""
Write-Host "Step 3/3: Running migrations..." -ForegroundColor Yellow
ssh "${VpsUser}@${VpsIp}" "docker exec laptop-erp-backend node run-migrations.js 2>/dev/null || true"

Write-Host ""
Write-Host "Done! App: http://$VpsIp" -ForegroundColor Green
Write-Host "API health: http://$VpsIp/api/health" -ForegroundColor Green
