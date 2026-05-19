# Deploy CRM to Hostinger VPS using local files (no GitHub pull)
# Usage: .\deploy\deploy-crm-vps.ps1
# Copies backend, frontend, deploy configs from local machine to VPS, then rebuilds containers.

$VpsIp = "187.77.187.213"
$VpsUser = "root"
$RemoteDir = "/tmp/laptop-erp-deploy"
$DeployPath = "/docker/laptop-erp"

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$BackendPath = Join-Path $ProjectRoot "backend"
$FrontendPath = Join-Path $ProjectRoot "frontend"
$DeployDir = Join-Path $ProjectRoot "deploy"

Write-Host "=== Deploy CRM to VPS (local files) ===" -ForegroundColor Cyan
Write-Host "VPS: ${VpsUser}@${VpsIp}" -ForegroundColor Gray
Write-Host "Target: $DeployPath" -ForegroundColor Gray
Write-Host "Source: $ProjectRoot" -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path $BackendPath)) {
    Write-Host "ERROR: backend folder not found at $BackendPath" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $FrontendPath)) {
    Write-Host "ERROR: frontend folder not found at $FrontendPath" -ForegroundColor Red
    exit 1
}

Write-Host "Copying files to VPS..." -ForegroundColor Yellow
ssh "${VpsUser}@${VpsIp}" "mkdir -p $RemoteDir/backend $RemoteDir/frontend $RemoteDir/deploy"

# Copy backend (exclude node_modules, .env, .git via robocopy)
Write-Host "  - backend..." -ForegroundColor Gray
$BackendTemp = Join-Path $env:TEMP "laptop-erp-backend-deploy"
if (Test-Path $BackendTemp) { Remove-Item -Recurse -Force $BackendTemp }
New-Item -ItemType Directory -Path $BackendTemp -Force | Out-Null
$null = robocopy $BackendPath $BackendTemp /E /XD node_modules .git /XF .env /NFL /NDL /NJH /NJS /nc /ns /np
scp -r "$BackendTemp\*" "${VpsUser}@${VpsIp}:${RemoteDir}/backend/"
Remove-Item -Recurse -Force $BackendTemp -ErrorAction SilentlyContinue

# Copy frontend (exclude node_modules, build, .git)
Write-Host "  - frontend..." -ForegroundColor Gray
$FrontendTemp = Join-Path $env:TEMP "laptop-erp-frontend-deploy"
if (Test-Path $FrontendTemp) { Remove-Item -Recurse -Force $FrontendTemp }
New-Item -ItemType Directory -Path $FrontendTemp -Force | Out-Null
$null = robocopy $FrontendPath $FrontendTemp /E /XD node_modules build .git /NFL /NDL /NJH /NJS /nc /ns /np
scp -r "$FrontendTemp\*" "${VpsUser}@${VpsIp}:${RemoteDir}/frontend/"
Remove-Item -Recurse -Force $FrontendTemp -ErrorAction SilentlyContinue

# Copy deploy configs
Write-Host "  - deploy configs..." -ForegroundColor Gray
$DeployFiles = @("Dockerfile.backend", "Dockerfile.web.root", "nginx.conf", "nginx.http-only.conf", "nginx.ssl.conf", "docker-entrypoint.sh", "run-deploy-on-vps.sh", "inject-sales-pipeline-routes.cjs")
foreach ($f in $DeployFiles) {
    $p = Join-Path $DeployDir $f
    if (Test-Path $p) { scp $p "${VpsUser}@${VpsIp}:${RemoteDir}/deploy/" }
}
scp (Join-Path $DeployDir "docker-compose.deploy.yml") "${VpsUser}@${VpsIp}:${RemoteDir}/docker-compose.yaml"

Write-Host ""
Write-Host "Running deploy on VPS..." -ForegroundColor Yellow

ssh "${VpsUser}@${VpsIp}" "sed -i 's/\r$//' $RemoteDir/deploy/run-deploy-on-vps.sh 2>/dev/null; bash $RemoteDir/deploy/run-deploy-on-vps.sh"

Write-Host ""
Write-Host "=== Deploy complete ===" -ForegroundColor Green
Write-Host "Test: https://crm.rentfoxxy.com" -ForegroundColor White
