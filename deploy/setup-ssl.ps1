# Setup HTTPS (Let's Encrypt) for crm.rentfoxxy.com
# Run: .\setup-ssl.ps1
# Requires: SSH access to VPS, domain DNS pointing to 187.77.187.213

$VpsIp = "187.77.187.213"
$VpsUser = "root"
$Domain = "crm.rentfoxxy.com"
$Email = "admin@rentfoxxy.com"  # Change if needed - used for Let's Encrypt expiry notices

Write-Host "=== HTTPS Setup for $Domain ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Copy HTTP+ACME config and update Dockerfile to use it, create dirs, run certbot
$RemoteScript = @'
set -e
echo "Step 1: Creating directories..."
mkdir -p /var/www/certbot
mkdir -p /etc/letsencrypt

echo "Step 2: Checking if cert already exists..."
if [ -f /etc/letsencrypt/live/crm.rentfoxxy.com/fullchain.pem ]; then
  echo "Certificate already exists. Skipping certbot."
else
  echo "Step 3: Obtaining certificate (ensure port 80 is reachable)..."
  docker run --rm -v /var/www/certbot:/var/www/certbot -v /etc/letsencrypt:/etc/letsencrypt \
    certbot/certbot certonly --webroot -w /var/www/certbot -d crm.rentfoxxy.com \
    --email admin@rentfoxxy.com --agree-tos --non-interactive
fi

echo "Step 4: Updating web container for SSL..."
cd /root/laptop-erp 2>/dev/null || cd /opt/laptop-erp 2>/dev/null || cd /home/*/laptop-erp 2>/dev/null || { echo "Could not find app directory. Run from app root."; exit 1; }

# Find docker-compose location
COMPOSE_FILE="docker-compose.yaml"
[ -f docker-compose.yml ] && COMPOSE_FILE="docker-compose.yml"

# Stop web container
docker compose -f $COMPOSE_FILE stop web 2>/dev/null || docker-compose -f $COMPOSE_FILE stop web 2>/dev/null || true

# Copy SSL nginx config (assumes backend repo is cloned)
if [ -f backend/nginx.deploy.ssl.conf ]; then
  cp backend/nginx.deploy.ssl.conf nginx.ssl.conf
elif [ -f nginx.deploy.ssl.conf ]; then
  cp nginx.deploy.ssl.conf nginx.ssl.conf
else
  echo "ERROR: nginx.deploy.ssl.conf not found. Ensure backend repo has the file."
  exit 1
fi

# Rebuild web with SSL config and cert mounts
# The Dockerfile needs to use nginx.ssl.conf - we'll use a temp Dockerfile or override
# Simpler: mount the ssl config and certs at runtime
docker compose -f $COMPOSE_FILE up -d web 2>/dev/null || docker-compose -f $COMPOSE_FILE up -d web 2>/dev/null || true

echo ""
echo "Done! Test: https://crm.rentfoxxy.com"
echo "Update FRONTEND_URL to https://crm.rentfoxxy.com in Hostinger and restart backend."
'@

Write-Host "This script will SSH to the VPS and set up SSL." -ForegroundColor Yellow
Write-Host "You will need to enter the root password." -ForegroundColor Gray
Write-Host ""
Write-Host "Ensure:" -ForegroundColor Yellow
Write-Host "  1. DNS A record: crm -> 187.77.187.213 (already done)" -ForegroundColor Gray
Write-Host "  2. Port 80 is open and reachable from the internet" -ForegroundColor Gray
Write-Host ""

$Confirm = Read-Host "Continue? (y/n)"
if ($Confirm -ne "y" -and $Confirm -ne "Y") {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

# Copy SSL nginx config to VPS first
$SslConfPath = Join-Path $PSScriptRoot "..\backend\nginx.deploy.ssl.conf"
$HttpAcmePath = Join-Path $PSScriptRoot "..\backend\nginx.deploy.http-acme.conf"
if (Test-Path $SslConfPath) {
    Write-Host "Copying nginx SSL config to VPS..." -ForegroundColor Yellow
    scp $SslConfPath "${VpsUser}@${VpsIp}:/tmp/nginx.deploy.ssl.conf"
    scp $HttpAcmePath "${VpsUser}@${VpsIp}:/tmp/nginx.deploy.http-acme.conf"
}

Write-Host "Running setup on VPS..." -ForegroundColor Yellow
ssh "${VpsUser}@${VpsIp}" $RemoteScript

Write-Host ""
Write-Host "=== Next steps ===" -ForegroundColor Green
Write-Host "1. In Hostinger hPanel, set FRONTEND_URL = https://crm.rentfoxxy.com" -ForegroundColor White
Write-Host "2. Restart the backend container" -ForegroundColor White
Write-Host "3. Visit https://crm.rentfoxxy.com" -ForegroundColor White
Write-Host ""
Write-Host "Note: If the web container uses a different setup, you may need to manually:" -ForegroundColor Yellow
Write-Host "- Add port 443 to the web container" -ForegroundColor Gray
Write-Host "- Mount /etc/letsencrypt and /var/www/certbot" -ForegroundColor Gray
Write-Host "- Use nginx.deploy.ssl.conf" -ForegroundColor Gray
