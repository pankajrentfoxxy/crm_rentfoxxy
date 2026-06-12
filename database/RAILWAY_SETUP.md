# Railway PostgreSQL — setup for local CRM development

## Part 1 — Create database on Railway

1. Go to [railway.app](https://railway.app) and sign in.
2. **New Project** → **Deploy PostgreSQL** (or **+ New** → **Database** → **PostgreSQL**).
3. Open the **PostgreSQL** service → **Variables** tab.
4. Copy these (names may vary slightly):
   - `PGHOST`
   - `PGPORT`
   - `PGUSER`
   - `PGPASSWORD`
   - `PGDATABASE` (often `railway`)
   - Or copy **`DATABASE_URL`** (single connection string)

5. **Enable public access** (required to connect from your PC / DBeaver):
   - PostgreSQL service → **Settings** → **Networking**
   - Turn on **Public Networking** (or **TCP Proxy**)
   - Note the public host (e.g. `*.proxy.rlwy.net`) and port

## Part 2 — Configure this project

Edit **`backend/.env`** (never commit real passwords):

```env
DB_HOST=<PGHOST from Railway>
DB_PORT=<PGPORT — often 5432 or a proxy port like 12345>
DB_NAME=<PGDATABASE — usually railway>
DB_USER=<PGUSER — usually postgres>
DB_PASSWORD=<PGPASSWORD>
DB_SSL=true

DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>?sslmode=require

JWT_SECRET=local-dev-jwt-secret-rentfoxxy-crm-phase1
PORT=5001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000,http://localhost:3001
VENDOR_PORTAL_URL=http://localhost:3001
```

**Password special characters:** If the password contains `@`, `#`, `%`, etc., URL-encode them in `DATABASE_URL` or use separate `DB_*` vars instead.

## Part 3 — Load schema into Railway

From project root (uses SSL automatically with `--railway`):

```powershell
cd c:\Users\bibha\Downloads\new_crm_rentfoxxy\crm_rentfoxxy
node database/setup_local_database.js --railway
```

This runs `master_setup.sql`, all migrations (including Phase 1), and seeds admin.

**Do not use `--recreate` on Railway** — you cannot drop Railway’s default database.

If tables already exist and you only need Phase 1 patch:

```powershell
# Connect via DBeaver and run: database/phase1_schema_patch.sql
```

## Part 4 — DBeaver connection

| Field | Value |
|-------|--------|
| Host | Railway `PGHOST` |
| Port | Railway `PGPORT` |
| Database | Railway `PGDATABASE` |
| Username | `PGUSER` |
| Password | `PGPASSWORD` |
| SSL | **Require** (or enable SSL tab) |

Test connection → browse **public** schema → tables.

## Part 5 — Run the app locally

```powershell
cd backend
npm start
```

```powershell
cd frontend
npm start
```

- API health: http://localhost:5001/api/health  
- CRM: http://localhost:3000  
- Login: `admin@rentfoxxy.com` / `admin123`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Connection timeout | Enable **Public Networking** on Railway Postgres |
| SSL required | Set `DB_SSL=true` in `.env` |
| `password authentication failed` | Re-copy vars from Railway Variables tab |
| `relation already exists` | DB already migrated; safe to ignore or use fresh Railway project |
| Slow queries | Railway free tier + remote latency; normal for dev |

## Switch back to local Postgres

```env
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=rentfoxxy_crm_local
DB_USER=rentfoxxyb2b
DB_PASSWORD=<local password>
DB_SSL=false
```
