# Run ERP dual setup with password auth (uses Posh-SSH)
# Usage: .\run-erp-dual-with-password.ps1 -Password "yourpassword"
# Or: $p = Read-Host -AsSecureString; .\run-erp-dual-with-password.ps1 -PasswordSecure $p

param(
    [string]$Password,
    [SecureString]$PasswordSecure
)

$VpsIp = "187.77.187.213"
$VpsUser = "root"
$DeployDir = $PSScriptRoot
$RemoteDir = "/tmp/erp-dual-deploy"
$ProjectRoot = Split-Path $DeployDir -Parent

if (-not $Password -and -not $PasswordSecure) {
    Write-Host "Usage: .\run-erp-dual-with-password.ps1 -Password 'yourpassword'" -ForegroundColor Yellow
    exit 1
}
if ($PasswordSecure) {
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($PasswordSecure)
    $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

# Load Posh-SSH
if (-not (Get-Module -ListAvailable Posh-SSH)) {
    Write-Host "Installing Posh-SSH module..." -ForegroundColor Yellow
    Install-Module -Name Posh-SSH -Scope CurrentUser -Force -SkipPublisherCheck
}
Import-Module Posh-SSH -ErrorAction Stop

$secpass = ConvertTo-SecureString $Password -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($VpsUser, $secpass)

Write-Host "=== ERP Dual-Domain Setup ===" -ForegroundColor Cyan
Write-Host "VPS: ${VpsUser}@${VpsIp}" -ForegroundColor Gray
Write-Host ""

# Create SSH session (Posh-SSH uses Session, not ComputerName)
Write-Host "Connecting to VPS..." -ForegroundColor Yellow
$null = New-SSHSession -ComputerName $VpsIp -Credential $cred -AcceptKey -Force
$session = Get-SSHSession | Where-Object { $_.Host -eq $VpsIp } | Select-Object -First 1
if (-not $session) { Write-Host "Failed to create SSH session" -ForegroundColor Red; exit 1 }

# Create remote dir
Write-Host "Creating remote directory..." -ForegroundColor Yellow
$null = Invoke-SSHCommand -SessionId $session.SessionId -Command "mkdir -p $RemoteDir/deploy"

# Copy files via SCP (Set-SCPItem uses ComputerName)
Write-Host "Copying files..." -ForegroundColor Yellow
Set-SCPItem -ComputerName $VpsIp -Credential $cred -Path (Join-Path $DeployDir "nginx.dual-phase1.conf") -Destination "$RemoteDir/deploy/nginx.dual-phase1.conf" -AcceptKey
Set-SCPItem -ComputerName $VpsIp -Credential $cred -Path (Join-Path $DeployDir "nginx.dual-crm-erp.conf") -Destination "$RemoteDir/deploy/nginx.dual-crm-erp.conf" -AcceptKey
Set-SCPItem -ComputerName $VpsIp -Credential $cred -Path (Join-Path $DeployDir "erp-landing.html") -Destination "$RemoteDir/deploy/erp-landing.html" -AcceptKey
Set-SCPItem -ComputerName $VpsIp -Credential $cred -Path (Join-Path $DeployDir "Dockerfile.web.dual") -Destination "$RemoteDir/deploy/Dockerfile.web.dual" -AcceptKey

# Copy frontend (zip first - Set-SCPItem doesn't recurse folders)
$FrontendPath = Join-Path $ProjectRoot "frontend"
if (Test-Path $FrontendPath) {
    Write-Host "Copying frontend (zipping first)..." -ForegroundColor Gray
    $zipPath = Join-Path $env:TEMP "frontend-deploy.zip"
    Compress-Archive -Path "$FrontendPath\*" -DestinationPath $zipPath -Force
    Set-SCPItem -ComputerName $VpsIp -Credential $cred -Path $zipPath -Destination "$RemoteDir/frontend.zip" -AcceptKey
    Remove-Item $zipPath -Force
    $null = Invoke-SSHCommand -SessionId $session.SessionId -Command "cd $RemoteDir && mkdir -p frontend && unzip -o frontend.zip -d frontend && rm -f frontend.zip"
}

# Run setup
$SetupScript = @'
set -e
ERP_PATH="/docker/rentfoxxy_erp"
NGINX_CONFIG_DIR="/docker/nginx-config"
REMOTE_DIR="/tmp/erp-dual-deploy"
APP_DIR=""
for d in /root/laptop-erp /root/laptop-refurbishment /opt/laptop-erp /docker/laptop_erp; do
  [ -d "$d" ] && [ -f "$d/docker-compose.yaml" -o -f "$d/docker-compose.yml" ] && APP_DIR="$d" && break
done
[ -z "$APP_DIR" ] && [ -d "$REMOTE_DIR" ] && APP_DIR="$REMOTE_DIR"
[ -z "$APP_DIR" ] && echo "ERROR: No project found." && exit 1
echo "Using: $APP_DIR"
if [ "$APP_DIR" != "$REMOTE_DIR" ] && [ -d "$REMOTE_DIR/deploy" ]; then
  cp "$REMOTE_DIR/deploy/nginx.dual-phase1.conf" "$REMOTE_DIR/deploy/nginx.dual-crm-erp.conf" "$REMOTE_DIR/deploy/erp-landing.html" "$REMOTE_DIR/deploy/Dockerfile.web.dual" "$APP_DIR/deploy/" 2>/dev/null || true
fi
mkdir -p "$ERP_PATH"
cp "$APP_DIR/deploy/erp-landing.html" "$ERP_PATH/index.html" 2>/dev/null || cp "$REMOTE_DIR/deploy/erp-landing.html" "$ERP_PATH/index.html" 2>/dev/null || true
[ ! -f "$ERP_PATH/index.html" ] && echo '<!DOCTYPE html><html><head><title>RentFoxxy ERP</title></head><body><h1>RentFoxxy ERP</h1><p>Coming soon.</p></body></html>' > "$ERP_PATH/index.html"
mkdir -p "$NGINX_CONFIG_DIR"
cp "$APP_DIR/deploy/nginx.dual-phase1.conf" "$NGINX_CONFIG_DIR/default.conf" 2>/dev/null || cp "$REMOTE_DIR/deploy/nginx.dual-phase1.conf" "$NGINX_CONFIG_DIR/default.conf"
mkdir -p /var/www/certbot /etc/letsencrypt
NETWORK=$(docker inspect laptop-erp-backend --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null || echo "bridge")
echo "Network: $NETWORK"
docker stop laptop-erp-web 2>/dev/null || true
docker rm laptop-erp-web 2>/dev/null || true
cd "$APP_DIR"
[ ! -d frontend ] && [ -d "$REMOTE_DIR/frontend" ] && cp -r "$REMOTE_DIR/frontend" .
docker build -f deploy/Dockerfile.web.dual -t laptop-erp-web:dual .
docker run -d --name laptop-erp-web --restart unless-stopped --network "$NETWORK" -p 80:80 -p 443:443 -v /etc/letsencrypt:/etc/letsencrypt:ro -v /var/www/certbot:/var/www/certbot -v "$ERP_PATH":/usr/share/nginx/erp:ro -v "$NGINX_CONFIG_DIR/default.conf":/etc/nginx/conf.d/default.conf:ro laptop-erp-web:dual
[ ! -f /etc/letsencrypt/live/erp.rentfoxxy.com/fullchain.pem ] && docker run --rm -v /var/www/certbot:/var/www/certbot -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot certonly --webroot -w /var/www/certbot -d erp.rentfoxxy.com --email admin@rentfoxxy.com --agree-tos --non-interactive
cp "$APP_DIR/deploy/nginx.dual-crm-erp.conf" "$NGINX_CONFIG_DIR/default.conf" 2>/dev/null || cp "$REMOTE_DIR/deploy/nginx.dual-crm-erp.conf" "$NGINX_CONFIG_DIR/default.conf"
docker exec laptop-erp-web nginx -s reload
echo "Done! CRM: https://crm.rentfoxxy.com  ERP: https://erp.rentfoxxy.com"
'@

Write-Host "Running setup on VPS (build may take 2-5 min)..." -ForegroundColor Yellow
$result = Invoke-SSHCommand -SessionId $session.SessionId -Command $SetupScript -TimeOut 600
Write-Host $result.Output
if ($result.Error) { Write-Host $result.Error -ForegroundColor Red }
if ($result.ExitStatus -ne 0) { Write-Host "Exit status: $($result.ExitStatus)" -ForegroundColor Red }

# Cleanup session
Remove-SSHSession -SessionId $session.SessionId -ErrorAction SilentlyContinue | Out-Null

Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Green
Write-Host "CRM: https://crm.rentfoxxy.com" -ForegroundColor White
Write-Host "ERP: https://erp.rentfoxxy.com" -ForegroundColor White
