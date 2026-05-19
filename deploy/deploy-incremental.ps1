# Incremental deploy – only updates what changed. Preserves existing setup (SSL, .env).
# Usage:
#   .\deploy\deploy-incremental.ps1              # Deploy backend + frontend
#   .\deploy\deploy-incremental.ps1 -BackendOnly  # Backend only (migrations + backend container)
#   .\deploy\deploy-incremental.ps1 -FrontendOnly # Frontend only (web container)
#   .\deploy\deploy-incremental.ps1 -FullRebuild  # Force full rebuild (no Docker cache)

param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$FullRebuild
)

$VpsIp = "187.77.187.213"
$VpsUser = "root"
$RemoteDir = "/tmp/laptop-erp-deploy"
$DeployPath = "/docker/laptop-erp"

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$BackendPath = Join-Path $ProjectRoot "backend"
$FrontendPath = Join-Path $ProjectRoot "frontend"
$DeployDir = Join-Path $ProjectRoot "deploy"

$DeployBackend = -not $FrontendOnly
$DeployFrontend = -not $BackendOnly

Write-Host "=== Incremental Deploy CRM ===" -ForegroundColor Cyan
Write-Host "VPS: ${VpsUser}@${VpsIp}" -ForegroundColor Gray
if ($DeployBackend) { Write-Host "  - Backend" -ForegroundColor Gray }
if ($DeployFrontend) { Write-Host "  - Frontend" -ForegroundColor Gray }
if ($FullRebuild) { Write-Host "  - Full rebuild (no cache)" -ForegroundColor Yellow }
Write-Host ""

if ($DeployBackend -and -not (Test-Path $BackendPath)) {
    Write-Host "ERROR: backend folder not found at $BackendPath" -ForegroundColor Red
    exit 1
}
if ($DeployFrontend -and -not (Test-Path $FrontendPath)) {
    Write-Host "ERROR: frontend folder not found at $FrontendPath" -ForegroundColor Red
    exit 1
}

ssh "${VpsUser}@${VpsIp}" "mkdir -p $RemoteDir/backend $RemoteDir/frontend $RemoteDir/deploy"

# Copy only what's needed
if ($DeployBackend) {
    Write-Host "Copying backend..." -ForegroundColor Yellow
    $BackendTemp = Join-Path $env:TEMP "laptop-erp-backend-deploy"
    if (Test-Path $BackendTemp) { Remove-Item -Recurse -Force $BackendTemp }
    New-Item -ItemType Directory -Path $BackendTemp -Force | Out-Null
    $null = robocopy $BackendPath $BackendTemp /E /XD node_modules .git /XF .env /NFL /NDL /NJH /NJS /nc /ns /np
    scp -r "$BackendTemp\*" "${VpsUser}@${VpsIp}:${RemoteDir}/backend/" 2>$null
    Remove-Item -Recurse -Force $BackendTemp -ErrorAction SilentlyContinue
}

if ($DeployFrontend) {
    Write-Host "Copying frontend..." -ForegroundColor Yellow
    $FrontendTemp = Join-Path $env:TEMP "laptop-erp-frontend-deploy"
    if (Test-Path $FrontendTemp) { Remove-Item -Recurse -Force $FrontendTemp }
    New-Item -ItemType Directory -Path $FrontendTemp -Force | Out-Null
    $null = robocopy $FrontendPath $FrontendTemp /E /XD node_modules build .git /NFL /NDL /NJH /NJS /nc /ns /np
    scp -r "$FrontendTemp\*" "${VpsUser}@${VpsIp}:${RemoteDir}/frontend/" 2>$null
    Remove-Item -Recurse -Force $FrontendTemp -ErrorAction SilentlyContinue
}

# Deploy configs always needed when building (Dockerfile, nginx, compose)
Write-Host "Copying deploy configs..." -ForegroundColor Yellow
$DeployFiles = @(
    "Dockerfile.backend",
    "Dockerfile.web.root",
    "nginx.conf",
    "nginx.http-only.conf",
    "nginx.ssl.conf",
    "docker-entrypoint.sh",
    "run-deploy-incremental-on-vps.sh",
    "inject-sales-pipeline-routes.cjs",
    "docker-compose.deploy.yml"
)
foreach ($f in $DeployFiles) {
    $p = Join-Path $DeployDir $f
    if (Test-Path $p) {
        scp $p "${VpsUser}@${VpsIp}:${RemoteDir}/deploy/" 2>$null
    }
}
scp (Join-Path $DeployDir "docker-compose.deploy.yml") "${VpsUser}@${VpsIp}:${RemoteDir}/docker-compose.yaml" 2>$null

Write-Host ""
Write-Host "Running incremental deploy on VPS..." -ForegroundColor Yellow

$Mode = if ($FrontendOnly) { "frontend" } elseif ($BackendOnly) { "backend" } else { "both" }
$FullFlag = if ($FullRebuild) { " full" } else { "" }

ssh "${VpsUser}@${VpsIp}" "sed -i 's/\r$//' $RemoteDir/deploy/run-deploy-incremental-on-vps.sh 2>/dev/null; bash $RemoteDir/deploy/run-deploy-incremental-on-vps.sh $Mode$FullFlag"

Write-Host ""
Write-Host "=== Deploy complete ===" -ForegroundColor Green
Write-Host "Test: https://crm.rentfoxxy.com" -ForegroundColor White
