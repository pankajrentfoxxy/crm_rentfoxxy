# Deploy Workflow: Push to Git → Hostinger

Simple workflow when you make changes and want to deploy.

---

## Your Setup

- **CRM:** https://crm.rentfoxxy.com (working)
- **VPS:** 187.77.187.213 (Hostinger)
- **Repos:** pankajrentfoxxy/laptop-refurb-backend, pankajrentfoxxy/laptop-refurb-frontend

---

## Workflow: Changes → Deploy

### 1. Make changes locally

Edit backend or frontend code as needed.

### 2. Push to Git

```bash
git add .
git commit -m "Your change description"
git push origin main
```

### 3. Redeploy on Hostinger

**Option A – SSH and pull + rebuild (recommended)**

```bash
ssh root@187.77.187.213
```

Then on the VPS:

```bash
cd /opt/laptop-erp   # or /docker/laptop_erp – your project path

# Pull latest (if using separate repos)
cd backend && git pull origin main && cd ..
cd frontend && git pull origin main && cd ..
# Or if monorepo: git pull origin main

# Rebuild and restart
docker compose down
docker compose up -d --build
```

**Option B – Backend only**

```bash
ssh root@187.77.187.213 "cd /opt/laptop-erp && git pull && docker compose up -d --build backend"
```

**Option C – Frontend only**

```bash
ssh root@187.77.187.213 "cd /opt/laptop-erp && git pull && docker compose up -d --build web"
```

---

## Run migrations (after schema changes)

If you changed the database schema:

```bash
ssh root@187.77.187.213
docker exec laptop-erp-backend node run-migrations.js
```

---

## Essential files (keep these)

| File | Purpose |
|------|---------|
| `deploy/Dockerfile.backend` | Backend build |
| `deploy/Dockerfile.web.root` | Frontend build |
| `deploy/nginx.conf` | Nginx config |
| `deploy/docker-compose.yml` | Compose for deploy folder |
| `deploy/.env.example` | Env template |
| `docker-compose.yaml` (root) | Main compose for Hostinger |

---

## Optional (use when needed)

| File | When to use |
|------|-------------|
| `setup-ssl.ps1` | First-time SSL or cert renewal |
| `redeploy-frontend-vps.ps1` | Redeploy frontend via Hostinger API |
| `backup-supabase.ps1` | Database backup |
| `restore-supabase.ps1` | Database restore |
| `run-migration-*.ps1` | Run migrations remotely |
