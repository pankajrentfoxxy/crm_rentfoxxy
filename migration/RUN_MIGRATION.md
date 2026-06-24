# Run Migration — Step by Step

> **Your CRM DB:** `postgresql://postgres@localhost:5433/postgres` (configured in `migration/.env`)  
> **Status:** Infrastructure ready; business modules (`006`–`030`) are stubs until implemented.

---

## Step 1 — Prerequisites

Install on your machine:

- **Node.js** 18+ (you already have this)
- **MySQL** 8.x (for ERP source)
- **PostgreSQL** client tools (`psql`, `pg_dump`) — port **5433** on your machine

From repo root:

```powershell
cd C:\rentfoxxy\crm_rentfoxxy\migration
npm install
```

---

## Step 2 — Load ERP data (MySQL)

### Windows: `mysql` not recognized?

You have **XAMPP MySQL** at `C:\xampp\mysql\bin\mysql.exe` but it is **not on PATH** and the service may be **stopped**.

**A. Start MySQL (XAMPP)**

1. Open **XAMPP Control Panel**
2. Click **Start** next to **MySQL**
3. Wait until it shows green “Running”

**B. Use full path (PowerShell)**

```powershell
$mysql = "C:\xampp\mysql\bin\mysql.exe"

# XAMPP default: root with NO password (empty)
& $mysql -u root -e "CREATE DATABASE IF NOT EXISTS erp_rentfoxxy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Import the dump (large file — may take several minutes):

```powershell
Get-Content C:\rentfoxxy\crm_rentfoxxy\erp_rentfoxxy_db.sql -Raw | & $mysql -u root erp_rentfoxxy
```

If root has a password:

```powershell
& $mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS erp_rentfoxxy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
Get-Content C:\rentfoxxy\crm_rentfoxxy\erp_rentfoxxy_db.sql -Raw | & $mysql -u root -p erp_rentfoxxy
```

Verify:

```powershell
& $mysql -u root -e "USE erp_rentfoxxy; SELECT COUNT(*) AS customers FROM customers;"
```

**C. Optional — add MySQL to PATH for this session**

```powershell
$env:Path += ";C:\xampp\mysql\bin"
mysql -u root -e "SELECT 1"
```

**D. Alternative — MySQL in Docker** (if you prefer not to use XAMPP)

```powershell
docker run --name erp-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=erp_rentfoxxy -p 3306:3306 -d mysql:8.0

# Wait ~30 seconds for MySQL to start, then:
Get-Content C:\rentfoxxy\crm_rentfoxxy\erp_rentfoxxy_db.sql -Raw | docker exec -i erp-mysql mysql -uroot -proot erp_rentfoxxy
```

Then in `migration/.env`:

```env
ERP_MYSQL_PASSWORD=root
```

### Linux / macOS (if `mysql` is on PATH)

```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS erp_rentfoxxy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p erp_rentfoxxy < /path/to/erp_rentfoxxy_db.sql
```

Update `migration/.env` if MySQL password is not empty:

```env
ERP_MYSQL_PASSWORD=your_mysql_password
```

---

## Step 3 — Confirm CRM PostgreSQL (already configured)

Your `migration/.env` points at the same DB as the CRM backend:

```env
DATABASE_URL=postgresql://postgres:password123@localhost:5433/postgres?schema=public
```

Test connection:

```powershell
cd C:\rentfoxxy\crm_rentfoxxy\migration
node -e "const {getCrmPool,closePools}=require('./lib/db'); getCrmPool().query('SELECT current_database() db').then(r=>{console.log('OK',r.rows[0]);closePools();});"
```

Expected: `OK { db: 'postgres' }`

If CRM schema is empty, import the backup once:

```powershell
psql -U postgres -p 5433 -d postgres -f C:\rentfoxxy\crm_rentfoxxy\crm_backup.sql
```

Or run backend migrations:

```powershell
cd C:\rentfoxxy\crm_rentfoxxy\backend
# run your usual migration runner if schema is not applied yet
```

---

## Step 4 — Backup CRM (mandatory)

```powershell
pg_dump -U postgres -p 5433 -Fc -d postgres -f C:\backups\crm_before_erp_migration.dump
```

Keep this file until migration is verified in the app.

---

## Step 5 — Capture baseline counts

```powershell
cd C:\rentfoxxy\crm_rentfoxxy\migration
node validate-migration.js --baseline
```

Creates `migration-validation-baseline.json` (RBAC + business row counts).

**Requires:** ERP MySQL running and reachable. If MySQL is not up yet, baseline will fail on ERP queries — fix Step 2 first.

---

## Step 6 — Dry run (no database writes)

```powershell
node migrate-all.js --dry-run
```

Lists modules that will run: `000`, `002`, `006`, `007`, `010`, …

---

## Step 7 — Review preservation rules

Read before any real migration:

1. `AUTH_TABLES.md` — do not overwrite users, roles, permissions, teams
2. `SYSTEM_TABLES.md` — do not overwrite config, stages, leads
3. `PRE_MIGRATION_REVIEW.md` — confirm manual decisions

---

## Step 8 — Enable migration (after review)

Edit `migration/.env`:

```env
MIGRATION_APPROVED=true
```

Without this, `migrate-all.js` exits immediately with a blocked message.

---

## Step 9 — Run migration

### 9a — Test infrastructure only (safe first step)

Creates `erp_id_map` and `migration_runs` tables:

```powershell
node migrate-all.js --only=000
```

Check log:

```powershell
type logs\migration.log
```

### 9b — Single module (when implemented)

```powershell
node migrate-all.js --only=007
```

### 9c — Full migration (when all modules are implemented)

```powershell
node migrate-all.js
```

Re-run a completed module after a fix:

```powershell
node migrate-all.js --force --only=007
```

**Current limitation:** Modules `002`, `006`, `007`, `010`, `013`, `014`, `017`, `020`, `023`, `026`, `030` are **stubs** and will stop with “not implemented yet”. Only `000` completes today.

---

## Step 10 — File sync (optional, separate from SQL migration)

Module `030` and other scripts store **ERP file paths only** (e.g. `pod_files/…`, `billsFiles/…`). Physical files under Laravel `storage/app/public` are **not** copied during `migrate-all.js`.

### 10a — Fetch files from ERP VPS

When ERP storage lives on the production VPS:

```powershell
# migration/.env
VPS_SSH_KEY=C:/Users/Dell/Downloads/LightsailDefaultKey-ap-south-1.pem
VPS_HOST=ubuntu@43.205.189.249
VPS_ERP_PUBLIC=/www/wwwroot/erp.rentfoxxy.com/api/storage/app/public
ERP_STORAGE_ROOT=./erp-storage

cd C:\rentfoxxy\crm_rentfoxxy\migration
node tools/fetch-erp-from-vps.js --dry-run
node tools/fetch-erp-from-vps.js --apply
```

This downloads only CRM-referenced files (~3k paths, ~3 GB) into `migration/erp-storage/`.

### 10b — Copy into CRM uploads + rewrite DB paths

```powershell
CRM_UPLOAD_ROOT=../backend/uploads

node tools/sync-erp-files.js --dry-run
node tools/sync-erp-files.js --apply
node tools/fix-file-paths.js          # if a prior sync used partial REPLACE
node tools/verify-file-sync.js
```

Files land in `backend/uploads/legacy/…`; DB paths become `uploads/legacy/…` (served by the backend `/uploads` route).

---

## Step 11 — Validate after migration

```powershell
node validate-migration.js
```

Open:

- `migration-validation-report.md`
- `migration-validation-report.json`

**Must pass:**

- RBAC counts (users, roles, permissions) **≥ baseline**
- No FK violations on vendors / customers / serials
- Business table counts match or exceed ERP

---

## Step 12 — Smoke test CRM app

```powershell
cd C:\rentfoxxy\crm_rentfoxxy\backend
npm run dev
```

1. Log in with an **existing CRM user** (password unchanged)
2. Check customers, inventory, vendors, one PO, one sales order
3. Confirm leads and settings still work

---

## Step 13 — Rollback (if needed)

```powershell
pg_restore -U postgres -p 5433 -d postgres --clean C:\backups\crm_before_erp_migration.dump
```

See `ROLLBACK_PLAN.md`. Never truncate auth/RBAC tables during rollback.

---

## Quick command reference

| Action | Command |
| --- | --- |
| Install deps | `cd migration` → `npm install` |
| Test CRM DB | `node -e "require('./lib/db').getCrmPool().query('SELECT 1')..."` |
| Baseline | `node validate-migration.js --baseline` |
| Dry run | `node migrate-all.js --dry-run` |
| Meta tables | `node migrate-all.js --only=000` |
| Full run | `node migrate-all.js` (after `MIGRATION_APPROVED=true`) |
| Validate | `node validate-migration.js` |
| File sync (dry) | `node tools/sync-erp-files.js --dry-run` |
| File sync (apply) | `node tools/sync-erp-files.js --apply` |

---

## Recommended order for first real data (when scripts exist)

1. `000` migration_meta  
2. `002` ERP admins → CRM users (additive, email match)  
3. `006` vendors  
4. `007` customers  
5. `010` purchase orders  
6. `013` serial numbers  
7. `014` inventory  
8. `017` sales orders  
9. `020` delivery challans  
10. `023` support tickets  
11. `025` billing  
12. `026` allocation logs  
13. `030` attachments  

Full dependency graph: `MIGRATION_ORDER.md`
