#!/bin/bash
# Run directly on VPS - NO file copy from your PC
#
# OPTION 1 - One command (after pushing this file to GitHub):
#   ssh root@187.77.187.213 'curl -sSL https://raw.githubusercontent.com/pankajrentfoxxy/laptop-refurbishment/main/deploy/run-on-vps-standalone.sh | bash'
#
# OPTION 2 - Copy script only (fast - one small file), then run:
#   scp deploy/run-on-vps-standalone.sh root@187.77.187.213:/tmp/
#   ssh root@187.77.187.213 'bash /tmp/run-on-vps-standalone.sh'
#
# OPTION 3 - Paste: SSH in, then paste this script and run

set -e
# Frontend repo - public repos need NO login. If private, use: https://YOUR_TOKEN@github.com/pankajrentfoxxy/laptop-refurb-frontend.git
FRONTEND_REPO="https://github.com/pankajrentfoxxy/laptop-refurb-frontend.git"
WORK="/tmp/erp-setup-$$"
ERP_PATH="/docker/rentfoxxy_erp"
NGINX_CFG="/docker/nginx-config"

echo "=== ERP Dual-Domain Setup (standalone) ==="

# Find existing project or clone from backend + frontend repos
APP_DIR=""
for d in /root/laptop-erp /root/laptop-refurbishment /opt/laptop-erp /docker/laptop_erp; do
  [ -d "$d" ] && [ -f "$d/docker-compose.yaml" -o -f "$d/docker-compose.yml" ] && [ -d "$d/frontend" ] && APP_DIR="$d" && break
done

if [ -z "$APP_DIR" ]; then
  echo "Cloning from pankajrentfoxxy/laptop-refurb-frontend (public, no login)..."
  mkdir -p "$WORK"
  git clone --depth 1 "$FRONTEND_REPO" "$WORK/frontend"
  mkdir -p "$WORK/deploy"
  APP_DIR="$WORK"
fi
echo "Using: $APP_DIR"

# Create deploy files (overwrite to ensure correct config)
mkdir -p "$APP_DIR/deploy"
cat > "$APP_DIR/deploy/nginx.dual-phase1.conf" << 'NGINX1'
server {
    listen 80;
    server_name crm.rentfoxxy.com 187.77.187.213;
    location /.well-known/acme-challenge/ { root /var/www/certbot; allow all; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 80;
    server_name erp.rentfoxxy.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; allow all; }
    root /usr/share/nginx/erp;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
server {
    listen 443 ssl http2;
    server_name crm.rentfoxxy.com 187.77.187.213;
    ssl_certificate /etc/letsencrypt/live/crm.rentfoxxy.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.rentfoxxy.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    gzip on;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location /api {
        proxy_pass http://laptop-erp-backend:5001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
    client_max_body_size 20M;
}
NGINX1

cat > "$APP_DIR/deploy/nginx.dual-crm-erp.conf" << 'NGINX2'
server {
    listen 80;
    server_name crm.rentfoxxy.com 187.77.187.213;
    location /.well-known/acme-challenge/ { root /var/www/certbot; allow all; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 80;
    server_name erp.rentfoxxy.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; allow all; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl http2;
    server_name crm.rentfoxxy.com 187.77.187.213;
    ssl_certificate /etc/letsencrypt/live/crm.rentfoxxy.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.rentfoxxy.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    gzip on;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location /api {
        proxy_pass http://laptop-erp-backend:5001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
    client_max_body_size 20M;
}
server {
    listen 443 ssl http2;
    server_name erp.rentfoxxy.com;
    ssl_certificate /etc/letsencrypt/live/erp.rentfoxxy.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/erp.rentfoxxy.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    root /usr/share/nginx/erp;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
NGINX2

cat > "$APP_DIR/deploy/erp-landing.html" << 'HTMLEOF'
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>RentFoxxy ERP</title><style>body{font-family:system-ui;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f,#0d1b2a);color:#fff;text-align:center}.card{background:rgba(255,255,255,0.08);border-radius:16px;padding:3rem;max-width:480px}h1{font-size:1.75rem}p{color:#94a3b8;margin-top:1rem}</style></head><body><div class="card"><h1>RentFoxxy ERP</h1><p>Coming soon.</p></div></body></html>
HTMLEOF

cat > "$APP_DIR/deploy/Dockerfile.web.dual" << 'DFEOF'
FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG REACT_APP_API_URL=/api
ENV REACT_APP_API_URL=${REACT_APP_API_URL}
RUN npm run build
FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY deploy/nginx.dual-phase1.conf /etc/nginx/conf.d/default.conf
COPY deploy/erp-landing.html /usr/share/nginx/erp/index.html
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
DFEOF

# ERP landing + nginx config
mkdir -p "$ERP_PATH" "$NGINX_CFG"
cp "$APP_DIR/deploy/erp-landing.html" "$ERP_PATH/index.html"
cp "$APP_DIR/deploy/nginx.dual-phase1.conf" "$NGINX_CFG/default.conf"
mkdir -p /var/www/certbot /etc/letsencrypt

# Network
NETWORK=$(docker inspect laptop-erp-backend --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null || echo "bridge")
echo "Network: $NETWORK"

# Stop, build, run
docker stop laptop-erp-web 2>/dev/null || true
docker rm laptop-erp-web 2>/dev/null || true
cd "$APP_DIR"
echo "Building (2-5 min)..."
docker build -f deploy/Dockerfile.web.dual -t laptop-erp-web:dual .
docker run -d --name laptop-erp-web --restart unless-stopped --network "$NETWORK" -p 80:80 -p 443:443 -v /etc/letsencrypt:/etc/letsencrypt:ro -v /var/www/certbot:/var/www/certbot -v "$ERP_PATH":/usr/share/nginx/erp:ro -v "$NGINX_CFG/default.conf":/etc/nginx/conf.d/default.conf:ro laptop-erp-web:dual

# SSL for erp
[ ! -f /etc/letsencrypt/live/erp.rentfoxxy.com/fullchain.pem ] && docker run --rm -v /var/www/certbot:/var/www/certbot -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot certonly --webroot -w /var/www/certbot -d erp.rentfoxxy.com --email admin@rentfoxxy.com --agree-tos --non-interactive

# Switch to full config
cp "$APP_DIR/deploy/nginx.dual-crm-erp.conf" "$NGINX_CFG/default.conf"
docker exec laptop-erp-web nginx -s reload

[ "$APP_DIR" = "$WORK" ] && rm -rf "$WORK"
echo ""
echo "Done! CRM: https://crm.rentfoxxy.com  ERP: https://erp.rentfoxxy.com"
