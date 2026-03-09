# Hostinger VPS Deployment via API

Deploy Backend, Frontend, and migrate Supabase data to your Hostinger VPS using the Hostinger API.

---

## What Gets Deployed

| Component | How |
|-----------|-----|
| **PostgreSQL** | Runs in Docker (postgres:16-alpine) – no separate install |
| **Backend** | Node.js in Docker |
| **Frontend** | React build served by nginx |
| **Supabase data** | Manual backup → restore (see below) |

---

## Required Details (Please Provide)

Before running the deployment, gather:

### 1. Hostinger API
- [ ] **API Token** – hPanel → Account → API → Create token
- [ ] **Virtual Machine ID** (optional) – script can auto-detect if you have one VPS

### 2. GitHub Repo
- [ ] Repo URL with `docker-compose.yaml` at root (e.g. `https://github.com/YOUR_USER/laptop-refurbishment`)
- [ ] Repo must contain: `backend/`, `frontend/`, `deploy/` (Dockerfiles, nginx.conf)

### 3. Environment Variables (.env)
Create `deploy/.env` or project root `.env` from `deploy/.env.example`:

| Variable | Required | Notes |
|----------|----------|-------|
| DB_PASSWORD | Yes | Strong password for PostgreSQL |
| JWT_SECRET | Yes | Same as current for existing tokens |
| FRONTEND_URL | Yes | `http://187.77.187.213` or `https://yourdomain.com` |
| PERPLEXITY_API_KEY | Yes | Lead research |
| ERP_BASE_URL | Yes | e.g. `https://erp.rentfoxxy.com/rentfoxxy-api` |
| ERP_API_TOKEN | Yes | |
| LEAD_EMAIL_* | Yes | Gmail IMAP for lead ingestion |

### 4. Supabase (for data migration)
- [ ] **Connection string** – Supabase Dashboard → Settings → Database → Connection string (Session mode, port 5432)
- [ ] Format: `postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`

---

## Step 1: Push Code to GitHub

Ensure your repo has:
- `docker-compose.yaml` at root
- `backend/`, `frontend/`, `deploy/` folders

```bash
git add docker-compose.yaml docker-compose.yml deploy/
git commit -m "Add Hostinger deployment"
git push origin main
```

---

## Step 2: Backup Supabase (Run Locally)

**On your machine** (requires `pg_dump` – install PostgreSQL client or use WSL):

```bash
# Windows: Use Git Bash, WSL, or install PostgreSQL
pg_dump "postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" \
  --no-owner --no-acl --clean --if-exists \
  -f supabase_backup_$(date +%Y%m%d).sql
```

Or use the script:
```bash
./deploy/backup-supabase.sh "postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres"
```

**Save the backup file** – you’ll need it for Step 5.

---

## Step 3: Deploy via Hostinger API

### Option A: Using the deploy script

```bash
cd deploy
# Set your API token
export API_TOKEN="your_hostinger_api_token"

# Optional: set GitHub repo if different
export GITHUB_REPO="https://github.com/YOUR_USER/laptop-refurbishment"

# Run (uses .env from project root if present)
node deploy-via-hostinger-api.js
```

### Option B: Using Hostinger MCP (if configured in Cursor)

1. **Get Virtual Machine ID**: Call `VPS_getVirtualMachinesV1`
2. **Create Project**: Call `VPS_createNewProjectV1` with:
   - `virtualMachineId`: from step 1
   - `project_name`: `laptop-erp`
   - `content`: `https://github.com/YOUR_USER/laptop-refurbishment`
   - `environment`: contents of your .env file (KEY=VALUE per line)

### Option C: Using curl

```bash
# 1. Get VM ID
curl -s -H "Authorization: Bearer $API_TOKEN" \
  "https://developers.hostinger.com/api/vps/v1/virtual-machines" | jq

# 2. Deploy (replace VM_ID)
curl -X POST \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project_name":"laptop-erp","content":"https://github.com/YOUR_USER/laptop-refurbishment","environment":"DB_PASSWORD=xxx\nJWT_SECRET=xxx\n..."}' \
  "https://developers.hostinger.com/api/vps/v1/virtual-machines/VM_ID/docker"
```

---

## Step 4: Wait for Deployment

Deployment can take **5–10 minutes** (Docker build). Check in hPanel or via API.

---

## Step 5: Restore Supabase Data

After the project is running:

```bash
# 1. Copy backup to VPS
scp supabase_backup_YYYYMMDD.sql root@187.77.187.213:/tmp/

# 2. SSH and restore
ssh root@187.77.187.213
docker exec -i laptop-erp-postgres psql -U postgres -d postgres < /tmp/supabase_backup_YYYYMMDD.sql

# 3. Run migrations (if any schema changes)
docker exec laptop-erp-backend node run-migrations.js
```

---

## Step 6: Verify

- App: http://187.77.187.213
- Health: http://187.77.187.213/api/health

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "No VPS found" | Create a VPS in Hostinger first |
| Build fails | Ensure GitHub repo has `backend/`, `frontend/`, `deploy/` |
| Backend won't start | Check `docker logs laptop-erp-backend` |
| DB connection error | Ensure postgres container is healthy: `docker ps` |
| 401 from API | Verify API token in hPanel → Account → API |

---

## Summary: What the API Does vs Manual

| Task | Hostinger API | Manual |
|------|---------------|--------|
| Deploy Docker Compose | ✅ | ❌ |
| Install PostgreSQL | ✅ (in container) | ❌ |
| Build Backend/Frontend | ✅ | ❌ |
| Set env vars | ✅ | ❌ |
| Backup Supabase | ❌ | ✅ (pg_dump) |
| Restore to VPS | ❌ | ✅ (scp + psql) |

The API deploys the stack. Supabase backup and restore must be done manually because the API cannot access your Supabase project.
