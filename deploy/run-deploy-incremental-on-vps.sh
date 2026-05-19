#!/bin/bash
# Run on VPS: incremental deploy. Called by deploy-incremental.ps1
# Usage: bash run-deploy-incremental-on-vps.sh [backend|frontend|both]

set -e
REMOTE_DIR="/tmp/laptop-erp-deploy"
DEPLOY_PATH="/docker/laptop-erp"
MODE="${1:-both}"

echo "Syncing to deploy path (mode=$MODE)..."
mkdir -p "$DEPLOY_PATH/backend" "$DEPLOY_PATH/frontend" "$DEPLOY_PATH/deploy"

[ "$MODE" = "backend" ] || [ "$MODE" = "both" ] && [ -d "$REMOTE_DIR/backend" ] && cp -r "$REMOTE_DIR/backend/"* "$DEPLOY_PATH/backend/"

# Register QC/Dispatch pipeline routes in server.js (idempotent; no manual edits)
# VPS often has no host Node — use Docker when node is not in PATH.
if [ "$MODE" = "backend" ] || [ "$MODE" = "both" ]; then
  if [ -f "$DEPLOY_PATH/deploy/inject-sales-pipeline-routes.cjs" ] && [ -f "$DEPLOY_PATH/backend/server.js" ]; then
    echo "Ensuring sales pipeline routes in server.js..."
    if command -v node >/dev/null 2>&1; then
      node "$DEPLOY_PATH/deploy/inject-sales-pipeline-routes.cjs" "$DEPLOY_PATH/backend/server.js" || true
    else
      docker run --rm -v "$DEPLOY_PATH:/work" node:20-alpine \
        node /work/deploy/inject-sales-pipeline-routes.cjs /work/backend/server.js || true
    fi
  fi
fi
[ "$MODE" = "frontend" ] || [ "$MODE" = "both" ] && [ -d "$REMOTE_DIR/frontend" ] && cp -r "$REMOTE_DIR/frontend/"* "$DEPLOY_PATH/frontend/"
cp -r "$REMOTE_DIR/deploy/"* "$DEPLOY_PATH/deploy/" 2>/dev/null || true
[ -f "$DEPLOY_PATH/deploy/Dockerfile.backend" ] && cp "$DEPLOY_PATH/deploy/Dockerfile.backend" "$DEPLOY_PATH/backend/Dockerfile"
rm -f "$DEPLOY_PATH/docker-compose.yml"
cp "$REMOTE_DIR/docker-compose.yaml" "$DEPLOY_PATH/docker-compose.yaml"

if [ -f "$DEPLOY_PATH/.env" ]; then
  echo 'Preserving existing .env'
else
  echo 'WARNING: No .env found'
fi

cd "$DEPLOY_PATH"

if [ "$MODE" = "backend" ] || [ "$MODE" = "both" ]; then
  if [ -d backend/migrations ] && ls backend/migrations/*.sql 1>/dev/null 2>&1; then
    echo 'Running pending migrations...'
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
fi

BUILD_OPTS=""
[ "$2" = "full" ] && BUILD_OPTS="--no-cache"

# Remove old containers that may conflict before creating new ones
if [ "$MODE" = "backend" ]; then
  docker stop laptop-erp-backend 2>/dev/null || true
  docker rm laptop-erp-backend 2>/dev/null || true
elif [ "$MODE" = "frontend" ]; then
  docker stop laptop-erp-web 2>/dev/null || true
  docker rm laptop-erp-web 2>/dev/null || true
else
  docker stop laptop-erp-web laptop-erp-backend 2>/dev/null || true
  docker rm laptop-erp-web laptop-erp-backend 2>/dev/null || true
fi

if [ "$MODE" = "backend" ]; then
  echo 'Building backend...'
  docker compose -f docker-compose.yaml build $BUILD_OPTS backend
  docker compose -f docker-compose.yaml up -d backend
elif [ "$MODE" = "frontend" ]; then
  echo 'Building web...'
  docker compose -f docker-compose.yaml build $BUILD_OPTS web
  docker compose -f docker-compose.yaml up -d web
else
  echo 'Building backend and web...'
  docker compose -f docker-compose.yaml build $BUILD_OPTS backend web
  docker compose -f docker-compose.yaml up -d backend web
fi

echo ''
echo 'Deploy complete. Test: https://crm.rentfoxxy.com'
