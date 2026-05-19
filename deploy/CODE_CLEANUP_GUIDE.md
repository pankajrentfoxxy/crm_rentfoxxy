# Code Cleanup Guide

Clean your project before deploying. These are safe to remove or ignore.

---

## What deploy already excludes (no action needed)

The deploy scripts **never copy** these to VPS:

- `node_modules/` – dependencies (rebuilt on VPS)
- `build/` (frontend) – build output (rebuilt on VPS)
- `.git/` – Git history (not needed on VPS)
- `.env` – secrets (preserved on VPS, never overwritten)

---

## Safe to delete locally (if not needed)

| Location | What | Why safe |
|----------|------|----------|
| `deploy/supabase_backup.sql` | Old DB backup | Large, already in .gitignore. Restore from elsewhere if needed. |
| `*.backup.sql` | Backup copies | Same as above |
| `deploy/archive/` | Old migration/deploy docs | Reference only; deploy uses current scripts |
| `*.log` | Log files | Usually temporary |
| `.DS_Store` | Mac metadata | Already in .gitignore |

---

## Do not delete

- `backend/` – app code
- `frontend/` – app code
- `deploy/*.ps1`, `deploy/*.sh` – deploy scripts
- `deploy/*.conf` – nginx configs
- `deploy/Dockerfile.*` – build configs
- `deploy/docker-compose*.yml` – compose config
- `backend/migrations/*.sql` – DB migrations
- `deploy/.env.example` – env template

---

## Git: do you need to push?

**Deploy uses local files** – it does NOT pull from GitHub. So:

- You can deploy without pushing to Git.
- Pushing to Git is still recommended for:
  - Backups
  - Version history
  - Working from another machine

**Workflow:**

1. Make changes locally
2. Deploy: `.\deploy\deploy-incremental.ps1 -BackendOnly` (or -FrontendOnly, or both)
3. Push to Git: `git add . && git commit -m "..." && git push` (optional but recommended)

---

## Quick cleanup commands (PowerShell)

```powershell
# Remove large backup files (be sure you have another copy if needed)
Remove-Item deploy/supabase_backup.sql -ErrorAction SilentlyContinue
Remove-Item *.backup.sql -ErrorAction SilentlyContinue

# Remove log files
Remove-Item *.log -ErrorAction SilentlyContinue -Recurse
```
