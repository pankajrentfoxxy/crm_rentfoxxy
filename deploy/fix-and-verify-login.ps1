# Fix login and verify database - run after restore
# Usage: .\fix-and-verify-login.ps1

$VpsIp = "187.77.187.213"
$VpsUser = "root"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "1. Copying fix script to VPS..." -ForegroundColor Yellow
scp (Join-Path $ScriptDir "fix-login.sql") "${VpsUser}@${VpsIp}:/tmp/fix-login.sql"

Write-Host "2. Activating admin user and verifying users table..." -ForegroundColor Yellow
ssh "${VpsUser}@${VpsIp}" "cat /tmp/fix-login.sql | docker exec -i laptop-erp-postgres psql -U postgres -d postgres"

Write-Host ""
Write-Host "Try login: admin@rentfoxxy.com / admin123" -ForegroundColor Green
