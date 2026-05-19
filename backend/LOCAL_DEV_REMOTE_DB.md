# Run backend locally, database on server (Docker)

The API uses **`pg`** with **`DB_*`** env vars (`config/db.js`). **Prisma** (leads and related features) reads **`DATABASE_URL`** only (`prisma/schema.prisma`). Both must point at the **same** database.

## Why SSH tunnel?

On the server, `laptop-erp-deploy/docker-compose.yaml` maps Postgres like this:

`127.0.0.1:5432 → container`

Postgres is only reachable **on the VPS itself**, not from the public internet. From your laptop the reliable approach is:

1. Open an **SSH tunnel** from your PC to the server.
2. Point `DB_*` + `DATABASE_URL` at **`127.0.0.1`** and a **local** port that the tunnel listens on.

## One-time setup (your PC)

From the **`backend`** folder:

```powershell
cd C:\rentfoxxy\crm_rentfoxxy\backend
npm install
npx prisma generate
```

Copy `.env.example` → `.env` and fill DB values **from the server** (same `DB_USER`, `DB_PASSWORD`, `DB_NAME` as in the server’s compose / `.env`).

## Tunnel (pick a local port, e.g. 5433)

Use your real SSH user and host (IP or hostname):

```powershell
ssh -N -L 5433:127.0.0.1:5432 YOUR_SSH_USER@YOUR_SERVER_IP_OR_HOST
```

Leave this terminal open while you dev. `-N` means “no remote shell”, only forwarding.

If your local Postgres already uses port `5432`, **5433** avoids a clash.

## `backend\.env` for tunnel mode

Set (values must match production DB on server):

```env
DB_HOST=127.0.0.1
DB_PORT=5433
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=same-password-as-server
DB_SSL=false
```

Prisma **`DATABASE_URL`** must use the **same port** and credentials. Encode special characters in the password ([URL-encoding](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent) for `#`, `@`, `:`, `%`, spaces, etc.):

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5433/postgres
```

(Optional) If PostgreSQL rejects SSL from Prisma, append:

```text
?sslmode=disable
```

## Run API

```powershell
cd C:\rentfoxxy\crm_rentfoxxy\backend
npm run dev
```

Default scripts: `npm run dev` (nodemon) or `npm start` (`node server.js`). API port comes from **`PORT`** in `.env` (often `5001`).

Frontend can stay `FRONTEND_URL=http://localhost:3000`; CORS already allows localhost in development.

---

## Alternative: publish Postgres on the server (advanced)

Only if you **must** skip SSH: change compose to expose `5432` on `0.0.0.0`, lock **firewall** to **your IP**, and fix **`pg_hba.conf`** for remote auth. Easier to misconfigure; prefer tunnel when possible.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Connection refused on `127.0.0.1:5433` | Tunnel running? Correct local port vs `DB_PORT`? |
| Password / user errors | Same `DB_USER` / `DB_PASSWORD` as server container env |
| “SSL connections” errors | Keep `DB_SSL=false` for this Docker Postgres; add `?sslmode=disable` on `DATABASE_URL` |
| Prisma fails, `pg` works | **`DATABASE_URL`** wrong or mismatched host/port/password vs `DB_*` |
