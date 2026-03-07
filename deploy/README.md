# VPS Deployment - Laptop Refurbishment ERP

## Prerequisites

- Hostinger VPS with Ubuntu 24.04 + Docker
- SSH access: `ssh root@187.77.187.213`

## Directory Structure

The deploy expects this structure (run from parent of backend/frontend):

```
/opt/laptop-erp/
  backend/          (git clone laptop-refurb-backend)
  frontend/         (git clone laptop-refurb-frontend)
  deploy/           (this folder - copy from your project)
    docker-compose.yml
    Dockerfile.backend
    Dockerfile.web
    nginx.conf
    .env.example
  .env              (your secrets - create from .env.example)
```

## Quick Start

### 1. On VPS - Clone repos and set up

```bash
ssh root@187.77.187.213

mkdir -p /opt/laptop-erp
cd /opt/laptop-erp

# Clone repos
git clone https://github.com/pankajrentfoxxy/laptop-refurb-backend.git backend
git clone https://github.com/pankajrentfoxxy/laptop-refurb-frontend.git frontend

# Copy deploy folder from your local project to /opt/laptop-erp/deploy/
# (use scp, rsync, or create a deploy repo and clone it)
```

### 2. Create .env file

```bash
cd /opt/laptop-erp
cp deploy/.env.example .env
nano .env   # Edit with your actual values
```

**Required values to set:**
- `DB_PASSWORD` - Strong password for PostgreSQL
- `JWT_SECRET` - Same as current (for existing tokens) or new 32+ char string
- `FRONTEND_URL` - `http://187.77.187.213` or `https://yourdomain.com`
- `PERPLEXITY_API_KEY`, `ERP_API_TOKEN`, `LEAD_EMAIL_*` - From your current .env

### 3. Deploy

```bash
cd /opt/laptop-erp
docker compose -f deploy/docker-compose.yml up -d --build
```

Wait ~30 seconds for services to start, then run migrations:

```bash
docker exec laptop-erp-backend node run-migrations.js
```

### 4. Restore Supabase backup

First, create backup from your local machine (see MIGRATION_GUIDE.md). Then:

```bash
# From your local machine - copy backup to VPS
scp supabase_backup_YYYYMMDD.sql root@187.77.187.213:/opt/

# On VPS - restore
docker exec -i laptop-erp-postgres psql -U postgres -d postgres < /opt/supabase_backup_YYYYMMDD.sql
```

### 5. Access

- App: http://187.77.187.213
- Health check: http://187.77.187.213/api/health

## Troubleshooting

- **Backend won't start**: `docker logs laptop-erp-backend`
- **Database connection**: `docker ps` - ensure postgres is healthy
- **Frontend 404**: `docker compose -f deploy/docker-compose.yml build web --no-cache && docker compose -f deploy/docker-compose.yml up -d web`
