#!/bin/bash
# Deploy Laptop ERP on Hostinger VPS
# Run this script ON THE VPS after cloning repos

set -e

DEPLOY_DIR="${1:-/opt/laptop-erp}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Deploy directory: $DEPLOY_DIR"
echo "Repo directory: $REPO_DIR"

if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo "ERROR: Create $DEPLOY_DIR/.env from .env.example first"
  echo "  cp $REPO_DIR/deploy/.env.example $DEPLOY_DIR/.env"
  echo "  Then edit $DEPLOY_DIR/.env with your values"
  exit 1
fi

mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

# Copy docker-compose and configs
cp "$REPO_DIR/deploy/docker-compose.yml" .
cp "$REPO_DIR/deploy/nginx.conf" .
cp "$REPO_DIR/deploy/Dockerfile.backend" .
cp "$REPO_DIR/deploy/Dockerfile.web" .

# Build and run
docker compose down 2>/dev/null || true
docker compose build --no-cache
docker compose up -d

echo "Waiting for services to start..."
sleep 10

# Run migrations
docker exec laptop-erp-backend node run-migrations.js
echo "Migrations complete."

echo ""
echo "Deployment complete!"
echo "Access the app at: http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_VPS_IP')"
echo ""
echo "To restore Supabase backup:"
echo "  docker exec -i laptop-erp-postgres psql -U postgres -d postgres < /path/to/backup.sql"
