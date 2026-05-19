# Step-by-Step Deploy Guide

Follow this guide whenever you change backend or frontend code. The new flow updates only what changed and keeps your CRM running (no more "deploy from scratch" that stops the CRM).

---

## Git: do you need to push?

**No.** Deploy copies your **local** files to the VPS. It does NOT pull from GitHub.

- Push to Git when you want a backup or to work from another machine.
- Workflow: make changes → deploy → (optional) push to Git.

---

## QC / Dispatch pipeline APIs (no manual route edits)

Deploy scripts **patch `backend/server.js` on the VPS for you** (one time, idempotent):

- Script: `deploy/inject-sales-pipeline-routes.cjs`
- It inserts a block tagged `SALES_PIPELINE_ROUTES_AUTO` **immediately before** `app.listen(...)` so these routes exist:
  - `GET /api/sales/qc-pipeline-orders`
  - `GET /api/sales/dispatch-pipeline-orders`

**Full deploy** (`deploy-crm-vps.ps1`) and **incremental deploy** (`deploy-incremental.ps1`) both upload the script and run it during `run-deploy-on-vps.sh` / `run-deploy-incremental-on-vps.sh`.

**Requirements on the VPS**

- `backend/server.js` must exist under `/docker/laptop-erp/backend/` (your real Express entry).
- That file must use the variable name **`app`** for the Express instance and call **`app.listen(`** somewhere. If your file uses another name (e.g. only `http.createServer`), the injector will print the snippet to paste manually.

**Verify after deploy** (with a valid JWT):

```text
curl -sS -H "Authorization: Bearer YOUR_JWT" "https://YOUR_CRM_HOST/api/sales/qc-pipeline-orders?limit=1&offset=0"
```

You should see JSON with `orders` and `total`, not `404`.

---

## One-time setup (first time only)

If you have **never** run the new deploy scripts, run this **once** to update your VPS with the new config (SSL, incremental logic):

### Step 1: Open PowerShell

Open PowerShell in your project folder:

```
c:\Users\bibha\OneDrive\Desktop\laptop-refurbishment
```

### Step 2: Run full deploy

```powershell
.\deploy\deploy-crm-vps.ps1
```

- Copies backend, frontend, deploy configs
- Runs only new migrations (safe)
- Preserves your `.env`, database, SSL
- Takes 3–5 minutes
- **CRM will restart briefly** (backend + web containers). Postgres keeps running.

### Step 3: Verify

1. Open https://crm.rentfoxxy.com
2. Log in and check that tickets/leads load
3. If it works → setup is complete. Use the daily workflow below for future deploys.

---

## Daily workflow – when you change code

### Scenario A: You changed **backend only** (API, controllers, migrations, etc.)

1. Save your changes locally.
2. Open PowerShell in the project folder.
3. Run:
   ```powershell
   .\deploy\deploy-incremental.ps1 -BackendOnly
   ```
4. Wait 1–2 minutes. Only the backend container restarts. Frontend and postgres stay up.
5. Test https://crm.rentfoxxy.com

---

### Scenario B: You changed **frontend only** (React components, UI, etc.)

1. Save your changes locally.
2. Open PowerShell in the project folder.
3. Run:
   ```powershell
   .\deploy\deploy-incremental.ps1 -FrontendOnly
   ```
4. Wait 2–3 minutes. Only the web container rebuilds. Backend and postgres stay up.
5. Test https://crm.rentfoxxy.com (hard refresh: Ctrl+Shift+R if you don’t see changes)

---

### Scenario C: You changed **both backend and frontend**

1. Save your changes locally.
2. Open PowerShell in the project folder.
3. Run:
   ```powershell
   .\deploy\deploy-incremental.ps1
   ```
4. Wait 3–5 minutes. Backend and web containers rebuild. Postgres stays up.
5. Test https://crm.rentfoxxy.com

---

## Quick reference

| What you changed   | Command |
|--------------------|---------|
| Backend only       | `.\deploy\deploy-incremental.ps1 -BackendOnly` |
| Frontend only      | `.\deploy\deploy-incremental.ps1 -FrontendOnly` |
| Both               | `.\deploy\deploy-incremental.ps1` |
| Something is wrong | `.\deploy\deploy-incremental.ps1 -FullRebuild` |

---

## What each command does

| Command | Copies | Rebuilds | Restarts | Downtime |
|---------|--------|----------|----------|----------|
| `-BackendOnly` | Backend + deploy configs | Backend | Backend only | ~10–30 sec |
| `-FrontendOnly` | Frontend + deploy configs | Web | Web only | ~30–60 sec |
| (no flag) | Backend + frontend + deploy | Backend + web | Both | ~30–60 sec |

**Postgres and database are never touched.**

---

## If something goes wrong

### CRM shows blank page or API errors

1. Check backend is running:
   ```bash
   ssh root@187.77.187.213 "docker ps"
   ```
   You should see `laptop-erp-backend` and `laptop-erp-web` with status "Up".

2. Rebuild and restart:
   ```powershell
   .\deploy\deploy-incremental.ps1 -FullRebuild
   ```

### HTTPS not working

```bash
ssh root@187.77.187.213 "curl -sSL https://raw.githubusercontent.com/pankajrentfoxxy/laptop-refurb-backend/main/deploy/fix-https-vps.sh | bash"
```

### Clean your code first

See `deploy/CODE_CLEANUP_GUIDE.md` for what you can safely remove before deploying.

### Still broken

1. SSH to the VPS:
   ```bash
   ssh root@187.77.187.213
   cd /docker/laptop-erp
   ```
2. Check logs:
   ```bash
   docker logs laptop-erp-backend --tail 50
   docker logs laptop-erp-web --tail 50
   ```
3. Restart containers:
   ```bash
   docker restart laptop-erp-backend laptop-erp-web
   ```

---

## Checklist before deploy

- [ ] Backend/frontend changes saved locally
- [ ] PowerShell opened in project folder: `c:\Users\bibha\OneDrive\Desktop\laptop-refurbishment`
- [ ] Chose correct command: `-BackendOnly`, `-FrontendOnly`, or none
- [ ] Ran the command and waited for "Deploy complete"
- [ ] Tested https://crm.rentfoxxy.com
