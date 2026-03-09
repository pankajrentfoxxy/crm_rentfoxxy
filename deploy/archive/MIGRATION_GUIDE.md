                                                                                    
                                                                                    # VPS Migration Guide - Laptop Refurbishment ERP

## Required Details Checklist

Before starting, gather these:

### 1. Domain (optional but recommended)
- [ ] Domain name for the app (e.g. `erp.rentfoxxy.com` or `laptop.rentfoxxy.com`)
- [ ] DNS A record pointing to `187.77.187.213`

### 2. Supabase Backup
- [ ] Supabase project URL (Dashboard → Settings → API)
- [ ] Database password (from Supabase Dashboard → Settings → Database)
- [ ] Connection string for direct PostgreSQL (not pooler) for pg_dump

### 3. Environment Variables to Prepare
Create a secure file with these (replace placeholders):

| Variable | Required | Notes |
|----------|----------|-------|
| JWT_SECRET | Yes | Keep same as current for existing tokens |
| PERPLEXITY_API_KEY | Yes | For lead research |
| ERP_BASE_URL | Yes | https://erp.rentfoxxy.com/rentfoxxy-api |
| ERP_API_TOKEN | Yes | |
| LEAD_EMAIL_* | Yes | Gmail IMAP for lead ingestion |
| DB_* | Yes | Will use local PostgreSQL on VPS |

### 4. GitHub Repos
- Backend: `https://github.com/pankajrentfoxxy/laptop-refurb-backend.git`
- Frontend: `https://github.com/pankajrentfoxxy/laptop-refurb-frontend.git`

---

## VPS Details (Hostinger)

| Item | Value |
|------|-------|
| IP | 187.77.187.213 |
| Hostname | srv1433305.hstgr.cloud |
| OS | Ubuntu 24.04 with Docker |
| SSH | `ssh root@187.77.187.213` |
| CPU | 4 cores |
| RAM | 16 GB |
| Disk | 200 GB |

---

## Migration Steps Overview

1. **Backup Supabase** (from your local machine)
2. **SSH into VPS** and install required packages
3. **Clone repos** and deploy with Docker
4. **Restore database** into VPS PostgreSQL
5. **Configure & start** services
6. **Verify** and test

---

## Step 1: Backup Supabase (Run Locally)

### Option A: Using pg_dump (recommended)

```bash
# Install PostgreSQL client if not installed (Windows: use Supabase SQL Editor or WSL)
# From Supabase Dashboard → Settings → Database → Connection string (Direct)
# Use "Session mode" connection string (port 5432, not 6543)

pg_dump "postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" \
  --no-owner --no-acl --clean --if-exists \
  -f supabase_backup_$(date +%Y%m%d).sql
```

### Option B: Using Supabase Dashboard
1. Go to Supabase Dashboard → SQL Editor
2. Export each table or use Supabase's built-in backup (if available in your plan)

### Option C: Supabase CLI (if installed)
```bash
supabase db dump -f supabase_backup.sql
```

**Save the backup file** - you'll need it for Step 4.

---

## Step 2: SSH into VPS

```bash
ssh root@187.77.187.213
```

---

## Step 3: Deploy on VPS

### Option A: Via Hostinger API (recommended)

Use the Hostinger API to deploy Backend, Frontend, and PostgreSQL in one step. See **`deploy/HOSTINGER_DEPLOY.md`** for full instructions.

```bash
# Quick start
export API_TOKEN="your_hostinger_api_token"
node deploy/deploy-via-hostinger-api.js
```

Then restore Supabase backup (Step 4).

### Option B: Manual SSH + Docker

Follow the instructions in `deploy/README.md` or run:

```bash
cd /opt
git clone https://github.com/pankajrentfoxxy/laptop-refurb-backend.git
git clone https://github.com/pankajrentfoxxy/laptop-refurb-frontend.git

# Copy deploy files to a deployment directory
mkdir -p /opt/laptop-erp
# Copy docker-compose.yml, .env.production from deploy/

cd /opt/laptop-erp
# Edit .env.production with your values
docker compose up -d
```

---

## Step 4: Restore Database

```bash
# Copy backup file to VPS
scp supabase_backup_YYYYMMDD.sql root@187.77.187.213:/opt/

# On VPS
docker exec -i laptop-erp-postgres psql -U postgres -d postgres < /opt/supabase_backup_YYYYMMDD.sql
```

---

## Post-Migration

1. **Run migrations** (in case backup missed schema changes):
   ```bash
   docker exec laptop-erp-backend node run-migrations.js
   ```

2. **Set up SSL** (optional, using Let's Encrypt):
   - Install certbot
   - Point domain to VPS IP
   - Run certbot for nginx

3. **Firewall**: Ensure ports 80, 443, 22 are open in Hostinger firewall

4. **Update DNS** if using domain

---

## Rollback

If issues occur, you can:
- Revert to Supabase by changing FRONTEND_URL and DATABASE_URL
- Keep Supabase running until VPS is fully verified
