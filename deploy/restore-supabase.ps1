# Restore Supabase backup to VPS PostgreSQL
# Run AFTER Hostinger deployment is complete
# Usage: .\restore-supabase.ps1 -BackupFile "supabase_backup.sql"

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupFile,
    [string]$VpsIp = "187.77.187.213",
    [string]$VpsUser = "root"
)

if (-not (Test-Path $BackupFile)) {
    Write-Error "Backup file not found: $BackupFile"
    exit 1
}

Write-Host "1. Copying backup to VPS..."
scp $BackupFile "${VpsUser}@${VpsIp}:/tmp/supabase_backup.sql"

Write-Host "2. Restoring to PostgreSQL container..."
ssh "${VpsUser}@${VpsIp}" "docker exec -i laptop-erp-postgres psql -U postgres -d postgres < /tmp/supabase_backup.sql"

Write-Host "3. Running migrations..."
ssh "${VpsUser}@${VpsIp}" "docker exec laptop-erp-backend node run-migrations.js 2>/dev/null || true"

Write-Host "Done! App: http://$VpsIp"
