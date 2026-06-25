# AGENTS.md

## Cursor Cloud specific instructions

RentFoxxy CRM is a monorepo: one Node/Express backend API plus three React (CRA) frontends, backed by PostgreSQL 16. The update script already runs `npm install` in every package and `prisma generate` in `backend`, so dependencies are ready on startup. The notes below cover the non-obvious startup steps the update script intentionally does NOT do.

### Services / ports

| Service | Path | Dev command | Port | Required? |
|---|---|---|---|---|
| PostgreSQL 16 | system | `sudo pg_ctlcluster 16 main start` | 5432 | yes |
| Backend API | `backend` | `npm run dev` | 5001 | yes |
| CRM frontend | `frontend` | `BROWSER=none npm start` | 3000 | yes (main UI) |
| Vendor portal | `vendor-portal` | `npm start` | 3001 | optional |
| Customer portal | `customer-portal` | `npm start` | 3002 | optional |

### Startup steps (not in the update script)

1. PostgreSQL is not auto-started on boot. Start it: `sudo pg_ctlcluster 16 main start`. The DB role is `rentfoxxy` / `rentfoxxy` (superuser) on `127.0.0.1:5432`.
2. `backend/.env` is gitignored — if missing on a fresh clone, recreate it (from `backend/.env.example`). Critical values: `PORT=5001` (the `.env.example` default of `5000` breaks the frontends, which expect `5001`), `DB_NAME=rentfoxxy_crm_local`, `DB_USER=rentfoxxy`, `DB_PASSWORD=rentfoxxy`, `DB_HOST=127.0.0.1`, `DB_SSL=false`, and `DATABASE_URL=postgresql://rentfoxxy:rentfoxxy@127.0.0.1:5432/rentfoxxy_crm_local?sslmode=disable`. The vendor/customer portals each need a `.env` with `PORT=300x` and `REACT_APP_API_URL=http://localhost:5001/api`.
3. Seed the database (idempotent): `node database/setup_local_database.js`. This creates `rentfoxxy_crm_local`, applies `backend/master_setup.sql` + `backend/migrations/*.sql` + phase patches, and seeds the admin login **`admin@rentfoxxy.com` / `admin123`**. Use `--recreate` to drop and rebuild. The script reads creds from `backend/.env`, so create `.env` first.

### Notes

- Node 22 is installed and works fine, even though the frontend `package.json` declares `engines.node: 24.x` (not enforced).
- There is no automated test suite (no `*.test.js` files); `npm test` in a frontend uses CRA/Jest and will report "no tests". ESLint runs as part of `npm start`/`npm run build` and currently emits warnings only (no errors).
- Background workers (email/ERP sync) are commented out in `backend/server.js`; only the in-process billing cron runs. Redis is not used.
- `frontend/src/utils/api.js` auto-falls back to `http://localhost:5001/api` for localhost, so `frontend/.env` is optional.
