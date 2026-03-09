# Run ERP + dual-domain setup on VPS
# Copies config files and runs setup script
# Usage: .\run-erp-dual-setup.ps1

$VpsIp = "187.77.187.213"
$VpsUser = "root"  # or "rentfoxxyteam" if root not available
$DeployDir = $PSScriptRoot

Write-Host "=== ERP Dual-Domain Setup ===" -ForegroundColor Cyan
Write-Host "VPS: ${VpsUser}@${VpsIp}" -ForegroundColor Gray
Write-Host ""

# Copy required files to VPS
$RemoteDir = "/tmp/erp-dual-deploy"
$ProjectRoot = Split-Path $DeployDir -Parent

Write-Host "Copying files to VPS..." -ForegroundColor Yellow
ssh "${VpsUser}@${VpsIp}" "mkdir -p $RemoteDir/deploy"

# Copy deploy files
scp (Join-Path $DeployDir "nginx.dual-phase1.conf") "${VpsUser}@${VpsIp}:${RemoteDir}/deploy/"
scp (Join-Path $DeployDir "nginx.dual-crm-erp.conf") "${VpsUser}@${VpsIp}:${RemoteDir}/deploy/"
scp (Join-Path $DeployDir "erp-landing.html") "${VpsUser}@${VpsIp}:${RemoteDir}/deploy/"
scp (Join-Path $DeployDir "Dockerfile.web.dual") "${VpsUser}@${VpsIp}:${RemoteDir}/deploy/"

# Copy frontend (required for Docker build)
$FrontendPath = Join-Path $ProjectRoot "frontend"
if (Test-Path $FrontendPath) {
    Write-Host "Copying frontend..." -ForegroundColor Gray
    scp -r $FrontendPath "${VpsUser}@${VpsIp}:${RemoteDir}/"
} else {
    Write-Host "  Warning: frontend not found - build may fail" -ForegroundColor Yellow
}

# Modify setup script to use /tmp/erp-dual-deploy
$SetupContent = Get-Content (Join-Path $DeployDir "setup-erp-dual-vps.sh") -Raw
$SetupContent = $SetupContent -replace 'APP_DIR="\$WORKDIR"', "APP_DIR=`"$RemoteDir`""
$SetupContent = $SetupContent -replace 'git clone --depth 1 "\$REPO_URL" "\$WORKDIR"', "echo 'Using pre-copied files at $RemoteDir'"
$SetupContent = $SetupContent -replace 'APP_DIR="\$WORKDIR"', "APP_DIR=`"$RemoteDir`""
# Simpler: just set APP_DIR to $RemoteDir when we don't find existing project
$SetupContent = $SetupContent -replace 'if \[ -z "\$APP_DIR" \]; then[\s\S]*?APP_DIR="\$WORKDIR"\nfi', @"
if [ -z "`$APP_DIR" ]; then
  if [ -d "$RemoteDir" ]; then
    APP_DIR="$RemoteDir"
  else
    echo "Cloning repo..."
    rm -rf "`$WORKDIR"
    git clone --depth 1 "`$REPO_URL" "`$WORKDIR"
    APP_DIR="`$WORKDIR"
  fi
fi
"@

# Run setup on VPS
Write-Host ""
Write-Host "Running setup on VPS (you may be prompted for password)..." -ForegroundColor Yellow
Write-Host ""

$InlineSetup = @'
set -e
ERP_PATH="/docker/rentfoxxy_erp"
NGINX_CONFIG_DIR="/docker/nginx-config"
REMOTE_DIR="/tmp/erp-dual-deploy"

# Use pre-copied files or find existing project
APP_DIR=""
for d in /root/laptop-erp /root/laptop-refurbishment /opt/laptop-erp /docker/laptop_erp; do
  [ -d "$d" ] && [ -f "$d/docker-compose.yaml" -o -f "$d/docker-compose.yml" ] && APP_DIR="$d" && break
done
[ -z "$APP_DIR" ] && [ -d "$REMOTE_DIR" ] && APP_DIR="$REMOTE_DIR"
[ -z "$APP_DIR" ] && echo "ERROR: No project found. Run from laptop-refurbishment repo." && exit 1

echo "Using: $APP_DIR"

# Copy deploy files to existing project if needed
if [ "$APP_DIR" != "$REMOTE_DIR" ] && [ -d "$REMOTE_DIR/deploy" ]; then
  cp "$REMOTE_DIR/deploy/nginx.dual-phase1.conf" "$APP_DIR/deploy/" 2>/dev/null || true
  cp "$REMOTE_DIR/deploy/nginx.dual-crm-erp.conf" "$APP_DIR/deploy/" 2>/dev/null || true
  cp "$REMOTE_DIR/deploy/erp-landing.html" "$APP_DIR/deploy/" 2>/dev/null || true
  cp "$REMOTE_DIR/deploy/Dockerfile.web.dual" "$APP_DIR/deploy/" 2>/dev/null || true
fi

# Create ERP landing
mkdir -p "$ERP_PATH"
cp "$APP_DIR/deploy/erp-landing.html" "$ERP_PATH/index.html" 2>/dev/null || cp "$REMOTE_DIR/deploy/erp-landing.html" "$ERP_PATH/index.html" 2>/dev/null || true
[ ! -f "$ERP_PATH/index.html" ] && echo '<!DOCTYPE html><html><head><title>RentFoxxy ERP</title></head><body><h1>RentFoxxy ERP</h1><p>Coming soon.</p></body></html>' > "$ERP_PATH/index.html"

# Nginx config
mkdir -p "$NGINX_CONFIG_DIR"
cp "$APP_DIR/deploy/nginx.dual-phase1.conf" "$NGINX_CONFIG_DIR/default.conf" 2>/dev/null || cp "$REMOTE_DIR/deploy/nginx.dual-phase1.conf" "$NGINX_CONFIG_DIR/default.conf"

# Certbot dirs
mkdir -p /var/www/certbot /etc/letsencrypt

# Network
NETWORK=$(docker inspect laptop-erp-backend --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null || echo "bridge")
echo "Network: $NETWORK"

# Stop web
docker stop laptop-erp-web 2>/dev/null || true
docker rm laptop-erp-web 2>/dev/null || true

# Build
cd "$APP_DIR"
if [ ! -d frontend ] && [ -d "$REMOTE_DIR/frontend" ]; then
  cp -r "$REMOTE_DIR/frontend" .
fi
docker build -f deploy/Dockerfile.web.dual -t laptop-erp-web:dual .

# Run
docker run -d --name laptop-erp-web --restart unless-stopped --network "$NETWORK" \
  -p 80:80 -p 443:443 \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  -v /var/www/certbot:/var/www/certbot \
  -v "$ERP_PATH":/usr/share/nginx/erp:ro \
  -v "$NGINX_CONFIG_DIR/default.conf":/etc/nginx/conf.d/default.conf:ro \
  laptop-erp-web:dual

# Cert for erp
[ ! -f /etc/letsencrypt/live/erp.rentfoxxy.com/fullchain.pem ] && docker run --rm -v /var/www/certbot:/var/www/certbot -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot certonly --webroot -w /var/www/certbot -d erp.rentfoxxy.com --email admin@rentfoxxy.com --agree-tos --non-interactive

# Switch to full config
cp "$APP_DIR/deploy/nginx.dual-crm-erp.conf" "$NGINX_CONFIG_DIR/default.conf" 2>/dev/null || cp "$REMOTE_DIR/deploy/nginx.dual-crm-erp.conf" "$NGINX_CONFIG_DIR/default.conf"
docker exec laptop-erp-web nginx -s reload

echo ""
echo "Done! CRM: https://crm.rentfoxxy.com  ERP: https://erp.rentfoxxy.com"
'@

ssh "${VpsUser}@${VpsIp}" $InlineSetup

Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Green
Write-Host "CRM: https://crm.rentfoxxy.com" -ForegroundColor White
Write-Host "ERP: https://erp.rentfoxxy.com" -ForegroundColor White
Write-Host ""
Write-Host "Ensure DNS A record: erp -> $VpsIp" -ForegroundColor Yellow
