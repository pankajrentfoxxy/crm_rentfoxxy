# Backup Supabase PostgreSQL
# Requires: PostgreSQL client (install from https://www.postgresql.org/download/windows/)
# Or use WSL: wsl pg_dump "..."

param(
    [Parameter(Mandatory=$true)]
    [string]$ConnectionString,
    [string]$OutputFile = "supabase_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
)

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
    Write-Host "pg_dump not found. Install PostgreSQL client or use WSL."
    Write-Host "Connection string format: postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres"
    Write-Host ""
    Write-Host "From Supabase Dashboard: Settings -> Database -> Connection string (Session mode, port 5432)"
    exit 1
}

Write-Host "Backing up to $OutputFile..."
& pg_dump $ConnectionString --no-owner --no-acl --clean --if-exists -f $OutputFile
Write-Host "Done. Size: $((Get-Item $OutputFile).Length / 1KB) KB"
