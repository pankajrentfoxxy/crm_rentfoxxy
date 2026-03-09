# Redeploy frontend on Hostinger VPS
# Usage: .\redeploy-frontend-vps.ps1
# Prompts for root password, then runs enable-https-vps.sh on the VPS

$VpsIp = "187.77.187.213"
$VpsUser = "root"

Write-Host "Redeploying frontend on $VpsIp..." -ForegroundColor Yellow
Write-Host "This will pull latest frontend from GitHub and rebuild the web container." -ForegroundColor Gray
Write-Host "(Enter root password when prompted)" -ForegroundColor Gray
Write-Host ""

ssh "${VpsUser}@${VpsIp}" "curl -sSL https://raw.githubusercontent.com/pankajrentfoxxy/laptop-refurb-backend/main/enable-https-vps.sh | bash"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Frontend redeployed. Test: https://crm.rentfoxxy.com" -ForegroundColor Green
} else {
    Write-Host "Redeploy may have had errors. Check output above." -ForegroundColor Yellow
}
