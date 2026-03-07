# Migration Steps - Complete

## ✅ Done (by AI)

1. **Deploy package pushed** to https://github.com/pankajrentfoxxy/laptop-refurb-backend
   - docker-compose.yaml, Dockerfiles, nginx config

2. **Hostinger deployment initiated** (VM ID: 1433305)
   - Backend, Frontend, PostgreSQL containers building
   - Takes ~5-10 minutes
   - Check status: hPanel → VPS → Projects

3. **Deployment .env** created in `laptop-erp-deploy/.env`
   - DB_PASSWORD, JWT_SECRET, PERPLEXITY_API_KEY, ERP_API_TOKEN, etc.
   - PostgreSQL runs in Docker (no separate install needed)

---

## 🔲 You Need To Do

### Step 1: Backup Supabase (when pg_dump is available)

**Option A - Install PostgreSQL client:**
- Download: https://www.postgresql.org/download/windows/
- Install (includes pg_dump)

**Option B - Use Supabase Dashboard:**
- Dashboard → SQL Editor → run queries to export data
- Or use Database → Backups (if on Pro plan)

**Option C - Run backup (after pg_dump installed):**
```powershell
cd deploy
.\backup-supabase.ps1 -ConnectionString "postgresql://postgres:YOUR_DB_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres"
```

Get connection string from: Supabase Dashboard → Settings → Database → Connection string (Session mode, port 5432)

### Step 2: Restore to VPS (after deployment completes)

Wait ~10 minutes for Hostinger build to finish. Then:

```powershell
cd deploy
.\restore-supabase.ps1 -BackupFile "path\to\supabase_backup.sql"
```

Or manually:
```powershell
scp supabase_backup.sql root@187.77.187.213:/tmp/
ssh root@187.77.187.213
docker exec -i laptop-erp-postgres psql -U postgres -d postgres < /tmp/supabase_backup.sql
docker exec laptop-erp-backend node run-migrations.js
```

### Step 3: Verify

- App: http://187.77.187.213
- API health: http://187.77.187.213/api/health

---

## PostgreSQL Note

**No separate PostgreSQL install needed.** The docker-compose runs PostgreSQL in a container. The DB user and database are created automatically from the .env variables passed to Hostinger API.
