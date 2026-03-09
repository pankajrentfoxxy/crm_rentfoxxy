#!/bin/bash
# Setup ERP landing page + dual-domain nginx on VPS
# Run on VPS: bash setup-erp-dual-vps.sh
# Or from local: ssh root@187.77.187.213 'bash -s' < setup-erp-dual-vps.sh

set -e

VPS_IP="187.77.187.213"
REPO_URL="https://github.com/pankajrentfoxxy/laptop-refurbishment.git"
WORKDIR="/tmp/erp-dual-setup"
ERP_PATH="/docker/rentfoxxy_erp"
NGINX_CONFIG_DIR="/docker/nginx-config"

echo "=== ERP + Dual-Domain Setup ==="
echo ""

# Find existing project (laptop-erp)
APP_DIR=""
for d in /root/laptop-erp /root/laptop-refurbishment /opt/laptop-erp /home/*/laptop-erp /docker/laptop_erp; do
  if [ -d "$d" ] && [ -f "$d/docker-compose.yaml" -o -f "$d/docker-compose.yml" ]; then
    APP_DIR="$d"
    break
  fi
done

if [ -z "$APP_DIR" ]; then
  echo "Cloning repo..."
  rm -rf "$WORKDIR"
  git clone --depth 1 "$REPO_URL" "$WORKDIR"
  APP_DIR="$WORKDIR"
fi

echo "Using app dir: $APP_DIR"

# 1. Create ERP landing page
echo ""
echo "Step 1: Creating ERP landing page at $ERP_PATH"
sudo mkdir -p "$ERP_PATH"
sudo chown "$USER:$USER" "$ERP_PATH" 2>/dev/null || true

if [ -f "$APP_DIR/deploy/erp-landing.html" ]; then
  cp "$APP_DIR/deploy/erp-landing.html" "$ERP_PATH/index.html"
else
  cat > "$ERP_PATH/index.html" << 'HTMLEOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RentFoxxy ERP - Coming Soon</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui,sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg,#1e3a5f 0%,#0d1b2a 100%); color: #fff; text-align: center; padding: 2rem; }
    .card { background: rgba(255,255,255,0.08); border-radius: 16px; padding: 3rem; max-width: 480px; border: 1px solid rgba(255,255,255,0.1); }
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
HTMLEOF
fi

# 2. Create nginx config directory
echo ""
echo "Step 2: Creating nginx config directory"
sudo mkdir -p "$NGINX_CONFIG_DIR"
sudo chown "$USER:$USER" "$NGINX_CONFIG_DIR" 2>/dev/null || true

if [ -f "$APP_DIR/deploy/nginx.dual-phase1.conf" ]; then
  cp "$APP_DIR/deploy/nginx.dual-phase1.conf" "$NGINX_CONFIG_DIR/default.conf"
else
  echo "ERROR: nginx.dual-phase1.conf not found. Ensure deploy/nginx.dual-phase1.conf exists in repo."
  exit 1
fi

# 3. Ensure certbot dirs exist
sudo mkdir -p /var/www/certbot
sudo mkdir -p /etc/letsencrypt

# 4. Get network from backend
NETWORK=$(docker inspect laptop-erp-backend --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null || true)
if [ -z "$NETWORK" ]; then
  echo "WARNING: laptop-erp-backend not found. Using default network."
  NETWORK="bridge"
fi
echo "Docker network: $NETWORK"

# 5. Stop existing web container
echo ""
echo "Step 3: Stopping existing web container"
docker stop laptop-erp-web 2>/dev/null || true
docker rm laptop-erp-web 2>/dev/null || true

# 6. Build dual web image
echo ""
echo "Step 4: Building dual-domain web image"
cd "$APP_DIR"
docker build -f deploy/Dockerfile.web.dual -t laptop-erp-web:dual .

# 7. Run new web container
echo ""
echo "Step 5: Starting web container with dual config"
docker run -d \
  --name laptop-erp-web \
  --restart unless-stopped \
  --network "$NETWORK" \
  -p 80:80 \
  -p 443:443 \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  -v /var/www/certbot:/var/www/certbot \
  -v "$ERP_PATH":/usr/share/nginx/erp:ro \
  -v "$NGINX_CONFIG_DIR/default.conf":/etc/nginx/conf.d/default.conf:ro \
  laptop-erp-web:dual

# 8. Get SSL cert for erp.rentfoxxy.com
echo ""
echo "Step 6: Obtaining SSL cert for erp.rentfoxxy.com"
if [ -f /etc/letsencrypt/live/erp.rentfoxxy.com/fullchain.pem ]; then
  echo "Cert already exists. Skipping."
else
  docker run --rm \
    -v /var/www/certbot:/var/www/certbot \
    -v /etc/letsencrypt:/etc/letsencrypt \
    certbot/certbot certonly --webroot -w /var/www/certbot \
    -d erp.rentfoxxy.com \
    --email admin@rentfoxxy.com \
    --agree-tos \
    --non-interactive
fi

# 9. Switch to full config (with erp HTTPS)
echo ""
echo "Step 7: Enabling HTTPS for ERP"
if [ -f "$APP_DIR/deploy/nginx.dual-crm-erp.conf" ]; then
  cp "$APP_DIR/deploy/nginx.dual-crm-erp.conf" "$NGINX_CONFIG_DIR/default.conf"
  docker exec laptop-erp-web nginx -s reload
  echo "Nginx reloaded with HTTPS for erp.rentfoxxy.com"
else
  echo "WARNING: nginx.dual-crm-erp.conf not found. ERP will work on HTTP only."
fi

# Cleanup
[ "$APP_DIR" = "$WORKDIR" ] && rm -rf "$WORKDIR"

echo ""
echo "=== Done! ==="
echo "CRM: https://crm.rentfoxxy.com"
echo "ERP: https://erp.rentfoxxy.com (or http://erp.rentfoxxy.com)"
echo ""
echo "Ensure DNS A record: erp -> $VPS_IP"
