#!/bin/bash
# Run on VPS: syncs files and rebuilds. Called by deploy-crm-vps.ps1

set -e
REMOTE_DIR="/tmp/laptop-erp-deploy"
DEPLOY_PATH="/docker/laptop-erp"

echo 'Syncing to deploy path...'
mkdir -p "$DEPLOY_PATH/backend" "$DEPLOY_PATH/frontend" "$DEPLOY_PATH/deploy"
cp -r "$REMOTE_DIR/backend/"* "$DEPLOY_PATH/backend/"
cp -r "$REMOTE_DIR/frontend/"* "$DEPLOY_PATH/frontend/"
cp -r "$REMOTE_DIR/deploy/"* "$DEPLOY_PATH/deploy/"
# Dockerfile path is relative to build context (backend/), so place it there
cp "$DEPLOY_PATH/deploy/Dockerfile.backend" "$DEPLOY_PATH/backend/Dockerfile"
# Use only our compose file - remove old one to avoid "multiple config files" and wrong Dockerfiles
rm -f "$DEPLOY_PATH/docker-compose.yml"
cp "$REMOTE_DIR/docker-compose.yaml" "$DEPLOY_PATH/docker-compose.yaml"

# Register QC/Dispatch pipeline routes in server.js (idempotent)
# VPS often has no host Node — use Docker when node is not in PATH.
if [ -f "$DEPLOY_PATH/deploy/inject-sales-pipeline-routes.cjs" ] && [ -f "$DEPLOY_PATH/backend/server.js" ]; then
  echo 'Ensuring sales pipeline routes in server.js...'
  if command -v node >/dev/null 2>&1; then
    node "$DEPLOY_PATH/deploy/inject-sales-pipeline-routes.cjs" "$DEPLOY_PATH/backend/server.js" || true
  else
    docker run --rm -v "$DEPLOY_PATH:/work" node:20-alpine \
      node /work/deploy/inject-sales-pipeline-routes.cjs /work/backend/server.js || true
  fi
fi

if [ -f "$DEPLOY_PATH/.env" ]; then
  echo 'Preserving existing .env'
else
  echo 'WARNING: No .env - create from deploy/.env.example'
fi

cd "$DEPLOY_PATH"

if [ -d backend/migrations ] && ls backend/migrations/*.sql 1>/dev/null 2>&1; then
  echo 'Running migrations...'
  docker exec laptop-erp-postgres psql -U postgres -d postgres -c "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)" 2>/dev/null || true
  for f in backend/migrations/*.sql; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    applied=$(docker exec laptop-erp-postgres psql -U postgres -d postgres -t -A -c "SELECT 1 FROM schema_migrations WHERE name='$name' LIMIT 1" 2>/dev/null || echo "")
    if [ -z "$applied" ] || [ "$applied" != "1" ]; then
      echo "  Running: $name"
      docker exec -i laptop-erp-postgres psql -U postgres -d postgres < "$f"
      docker exec laptop-erp-postgres psql -U postgres -d postgres -c "INSERT INTO schema_migrations (name) VALUES ('$name') ON CONFLICT (name) DO NOTHING" 2>/dev/null || true
    fi
  done
fi

echo 'Building and starting containers...'
docker compose -f docker-compose.yaml build

# Remove old containers that may conflict (from manual docker run or previous setup)
docker stop laptop-erp-web laptop-erp-backend 2>/dev/null || true
docker rm laptop-erp-web laptop-erp-backend 2>/dev/null || true

docker compose -f docker-compose.yaml up -d

echo ''
echo 'Deploy complete. Test: https://crm.rentfoxxy.com'
