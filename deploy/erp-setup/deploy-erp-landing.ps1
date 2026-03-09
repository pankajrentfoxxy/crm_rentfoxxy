# Deploy dummy landing page for erp.rentfoxxy.com
# Run: .\deploy-erp-landing.ps1
# Prerequisites: DNS A record erp -> 187.77.187.213

$VpsIp = "187.77.187.213"
$VpsUser = "rentfoxxyteam"
$ProjectPath = "/docker/rentfoxxy_erp"
$Domain = "erp.rentfoxxy.com"

$LandingHtml = @'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RentFoxxy ERP - Coming Soon</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 100%);
      color: #fff;
      text-align: center;
      padding: 2rem;
    }
    .card {
      background: rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 3rem;
      max-width: 480px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    p { color: #94a3b8; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>RentFoxxy ERP</h1>
    <p>Coming soon. We're setting things up.</p>
  </div>
</body>
</html>
'@

$NginxConf = @"
server {
    listen 80;
    listen [::]:80;
    server_name $Domain;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files `$uri `$uri/ =404;
    }
}
"@

$Dockerfile = @'
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
'@

$DockerCompose = @'
services:
  web:
    build: .
    ports:
      - "80:80"
    restart: unless-stopped
'@

Write-Host "=== Deploy Landing Page: $Domain ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "VPS: ${VpsUser}@${VpsIp}" -ForegroundColor Gray
Write-Host "Path: $ProjectPath" -ForegroundColor Gray
Write-Host ""
Write-Host "Ensure DNS A record: erp -> $VpsIp" -ForegroundColor Yellow
Write-Host ""

$Confirm = Read-Host "Continue? (y/n)"
if ($Confirm -ne "y" -and $Confirm -ne "Y") {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

# Create temp files
$TempDir = Join-Path $env:TEMP "erp-landing-deploy"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$LandingHtml | Out-File -FilePath (Join-Path $TempDir "index.html") -Encoding utf8
$NginxConf | Out-File -FilePath (Join-Path $TempDir "nginx.conf") -Encoding utf8
$Dockerfile | Out-File -FilePath (Join-Path $TempDir "Dockerfile") -Encoding utf8
$DockerCompose | Out-File -FilePath (Join-Path $TempDir "docker-compose.yml") -Encoding utf8

Write-Host "Copying files to VPS..." -ForegroundColor Yellow
scp (Join-Path $TempDir "index.html") "${VpsUser}@${VpsIp}:/tmp/erp-index.html"
scp (Join-Path $TempDir "nginx.conf") "${VpsUser}@${VpsIp}:/tmp/erp-nginx.conf"
scp (Join-Path $TempDir "Dockerfile") "${VpsUser}@${VpsIp}:/tmp/erp-Dockerfile"
scp (Join-Path $TempDir "docker-compose.yml") "${VpsUser}@${VpsIp}:/tmp/erp-docker-compose.yml"

$RemoteScript = @"
set -e
echo 'Creating project directory...'
sudo mkdir -p $ProjectPath
sudo chown `$USER:`$USER $ProjectPath
cd $ProjectPath

echo 'Copying files...'
mv /tmp/erp-index.html index.html
mv /tmp/erp-nginx.conf nginx.conf
mv /tmp/erp-Dockerfile Dockerfile
mv /tmp/erp-docker-compose.yml docker-compose.yml

echo 'Building and starting container...'
docker compose up -d --build

echo ''
echo 'Done! Test: http://$Domain'
echo 'For HTTPS, run certbot and update nginx config.'
"@

Write-Host "Running setup on VPS..." -ForegroundColor Yellow
ssh "${VpsUser}@${VpsIp}" $RemoteScript

# Cleanup
Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== Next steps ===" -ForegroundColor Green
Write-Host "1. Visit http://$Domain to verify" -ForegroundColor White
Write-Host "2. For HTTPS: SSH to VPS, run certbot, then add SSL to nginx config" -ForegroundColor White
Write-Host "   See deploy/ERP_LANDING_PAGE_SETUP.md for full SSL instructions" -ForegroundColor Gray
Write-Host ""
