# Hostinger - Environment Variables

## Where to Add Variables

**hPanel** → **VPS** → **Docker Manager** → **laptop-erp** → **Edit** (backend service)

Or use the **.yaml editor** tab to add/update environment variables in the docker-compose.

---

## Required Variables for Backend

| Variable | Value | Notes |
|----------|-------|-------|
| NODE_ENV | production | |
| PORT | 5001 | |
| DB_HOST | postgres | Container name |
| DB_PORT | 5432 | |
| DB_NAME | postgres | |
| DB_USER | postgres | |
| DB_PASSWORD | *(your password)* | Same as postgres container |
| DATABASE_URL | postgresql://postgres:PASSWORD@postgres:5432/postgres | Replace PASSWORD |
| DB_SSL | false | |
| JWT_SECRET | *(32+ chars)* | Same as in backup for existing tokens |
| FRONTEND_URL | http://187.77.187.213 | Or https://yourdomain.com |
| PERPLEXITY_API_KEY | *(your key)* | |
| ERP_BASE_URL | https://erp.rentfoxxy.com/rentfoxxy-api | |
| ERP_API_TOKEN | *(your token)* | |
| LEAD_EMAIL_* | *(from .env)* | |

---

## Postgres Container Variables

| Variable | Value |
|----------|-------|
| POSTGRES_USER | postgres |
| POSTGRES_PASSWORD | *(same as DB_PASSWORD)* |
| POSTGRES_DB | postgres |

---

## After Changing Variables

**Restart** the backend container (or restart the whole project) for changes to take effect.
