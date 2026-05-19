# Deploy Workflow: Push to Git → Hostinger

Simple workflow when you make changes and want to deploy.

> **Step-by-step guide:** See [deploy/DEPLOY_STEP_BY_STEP.md](DEPLOY_STEP_BY_STEP.md) for copy-paste commands and a daily workflow.

---

## Deploy safety – what is preserved

| Item | Preserved | Notes |
|------|-----------|-------|
| **Database** | ✅ Yes | Postgres data lives in `postgres_data` volume. Deploy never runs `down -v` or removes volumes. |
| **Migrations** | ✅ Incremental only | Only **new** migrations run (tracked in `schema_migrations`). Already-applied migrations are skipped. |
| **`.env`** | ✅ Yes | Never overwritten. Scripts explicitly skip it. |
| **SSL certs** | ✅ Yes | Mounted from `/etc/letsencrypt`. Deploy does not touch them. |
| **Backend uploads** | ✅ Yes | Stored in `backend_uploads` volume. Preserved across deploys. |
| **Postgres container** | ✅ Not restarted | Only backend and web are rebuilt/restarted when changed. Postgres stays running. |

**The deploy flow never runs:** `docker compose down`, `down -v`, or any command that removes volumes or wipes data.

**Optional before first deploy with new migrations:** For extra safety with critical data, run a DB backup first:
```bash
ssh root@187.77.187.213 "docker exec laptop-erp-postgres pg_dump -U postgres postgres > /tmp/crm-backup-\$(date +%Y%m%d).sql"
```

---

## Your Setup

- **CRM:** https://crm.rentfoxxy.com (working)
- **VPS:** 187.77.187.213 (Hostinger)
- **Repos:** pankajrentfoxxy/laptop-refurb-backend, pankajrentfoxxy/laptop-refurb-frontend

---

## Workflow: Changes → Deploy

### 1. Make changes locally

Edit backend or frontend code as needed.

### 2. Push to Git (optional)

```bash
git add .
git commit -m "Your change description"
git push origin main
```

### 3. Deploy on Hostinger

**Preferred: Incremental deploy** – only updates what changed, preserves SSL and .env, uses Docker cache for faster builds:

```powershell
# Deploy backend + frontend (default)
.\deploy\deploy-incremental.ps1

# Backend only (migrations + backend container)
.\deploy\deploy-incremental.ps1 -BackendOnly

# Frontend only (web container)
.\deploy\deploy-incremental.ps1 -FrontendOnly

# Force full rebuild (no cache) when something is wrong
.\deploy\deploy-incremental.ps1 -FullRebuild
```

- Migrations run only when backend is deployed.
- HTTPS/SSL is preserved (docker-compose includes port 443 and cert mounts).
- Uses Docker layer cache for faster builds.

**Option B – Full deploy from local files**

```powershell
.\deploy\deploy-crm-vps.ps1
```

Copies backend, frontend, and deploy configs, runs migrations, and rebuilds all containers. Preserves `.env`. Uses incremental build (no `--no-cache`).

**Option C – Curl scripts (pulls from GitHub)**

```bash
# Backend (clones repo, runs migrations, rebuilds container)
ssh root@187.77.187.213 "curl -sSL https://raw.githubusercontent.com/pankajrentfoxxy/laptop-refurb-backend/main/redeploy-backend-vps.sh | bash"

# Frontend (web container)
ssh root@187.77.187.213 "curl -sSL https://raw.githubusercontent.com/pankajrentfoxxy/laptop-refurb-backend/main/deploy/redeploy-vps.sh | bash"
```

**Option D – SSH and manual rebuild**

```bash
ssh root@187.77.187.213
cd /docker/laptop-erp
docker compose build
docker compose up -d
```

---

## ERP API Token (JWT) – Inventory Sync

The CRM syncs inventory from the external ERP (`erp.rentfoxxy.com`) when laptops pass QC. If the ERP server was migrated, the API token may have changed.

### Where to change the token

| Location | File | Variable |
|---------|------|----------|
| **Local dev** | `backend/.env` | `ERP_API_TOKEN=...` |
| **VPS production** | `/docker/laptop-erp/.env` | `ERP_API_TOKEN=...` |

### Update token on VPS (after ERP migration)

1. SSH to VPS: `ssh root@187.77.187.213`
2. Create the env file (if it doesn’t exist):
   ```bash
   mkdir -p /docker/laptop-erp
   docker inspect laptop-erp-backend --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -v '^$' > /docker/laptop-erp/.env
   ```
3. Edit the file: `nano /docker/laptop-erp/.env`
4. Set `ERP_API_TOKEN` to the new token from the migrated ERP.
5. Redeploy backend so it picks up the new env:
   ```bash
   curl -sSL https://raw.githubusercontent.com/pankajrentfoxxy/laptop-refurb-backend/main/redeploy-backend-vps.sh | bash
   ```

### Enable HTTPS (SSL)

If HTTP works but HTTPS does not:

1. **Obtain SSL certificate** (run on VPS; web container must be running):
   ```bash
   ssh root@187.77.187.213 "curl -sSL https://raw.githubusercontent.com/pankajrentfoxxy/laptop-refurb-backend/main/deploy/setup-ssl-vps.sh | bash"
   ```

2. **Restart web container** so it picks up the SSL config:
   ```bash
   ssh root@187.77.187.213 "docker restart laptop-erp-web"
   ```

3. Or **redeploy** (rebuilds image with entrypoint that auto-detects certs):
   ```bash
   ssh root@187.77.187.213 "curl -sSL https://raw.githubusercontent.com/pankajrentfoxxy/laptop-refurb-backend/main/deploy/redeploy-vps.sh | bash"
   ```

4. **Quick fix** when HTTP works but HTTPS does not (restarts web with SSL mounts):
   ```bash
   ssh root@187.77.187.213 "curl -sSL https://raw.githubusercontent.com/pankajrentfoxxy/laptop-refurb-backend/main/deploy/fix-https-vps.sh | bash"
   ```

---

### ERP sync behavior

- **Automatic:** Runs on startup and every 2 minutes (configurable via `ERP_SYNC_INTERVAL_MS`).
- **Manual (API):** POST `/api/inventory/sync` (admin/manager only). Add `?async=1` to avoid timeout.
- **Manual (VPS script):** Trigger sync from command line:
  ```bash
  ssh root@187.77.187.213 "curl -sSL https://raw.githubusercontent.com/pankajrentfoxxy/laptop-refurb-backend/main/deploy/trigger-inventory-sync-vps.sh | bash"
  ```
- **Debug:** GET `/api/inventory/trace/:machineNumber` to inspect ERP data for a machine.

### “Unknown” laptop details

If brand/model show as “Unknown”, the ERP API may be returning incomplete data or the token may be invalid. Check the trace endpoint and ERP API responses.

---

## Run migrations (after schema changes)

Migrations run automatically when you redeploy the backend (see curl commands below).  
To run manually, clone the repo first, then:

```bash
# On VPS - DB name on Hostinger is 'postgres'
cd /tmp && rm -rf laptop-refurb-backend && git clone --depth 1 https://github.com/pankajrentfoxxy/laptop-refurb-backend.git
docker exec -i laptop-erp-postgres psql -U postgres -d postgres < /tmp/laptop-refurb-backend/migrations/003_stage_categories_ttspl_id.sql
# Or run a specific migration: .../migrations/015_hardware_software_team.sql
```

---

## Essential files (keep these)

| File | Purpose |
|------|---------|
| `deploy/Dockerfile.backend` | Backend build |
| `deploy/Dockerfile.web.root` | Frontend build |
| `deploy/nginx.conf` | Nginx config |
| `deploy/nginx.http-only.conf` | Nginx HTTP fallback (no SSL) |
| `deploy/nginx.ssl.conf` | Nginx HTTPS config |
| `deploy/docker-entrypoint.sh` | SSL auto-detect for web container |
| `deploy/docker-compose.deploy.yml` | Compose for deploy |
| `deploy/.env.example` | Env template |

---

## Optional (use when needed)

| File | When to use |
|------|-------------|
| `deploy-incremental.ps1` | **Preferred** – incremental deploy, preserves SSL |
| `deploy-crm-vps.ps1` | Full deploy (backend + frontend) |
| `setup-ssl.ps1` | First-time SSL or cert renewal |
| `redeploy-frontend-vps.ps1` | Redeploy frontend via Hostinger API |
| `backup-supabase.ps1` | Database backup |
| `restore-supabase.ps1` | Database restore |
| `run-migration-*.ps1` | Run migrations remotely |
