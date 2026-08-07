# CI/CD — GitHub Actions → Dual VPS (staging + production)

Same branch (`new_crm_rentfoxxy`) deploys to **two servers** via GitHub Environments.

| Environment | Server | When it deploys |
|-------------|--------|-----------------|
| **staging** | `157.173.221.119` | Auto on every push to `new_crm_rentfoxxy`, or manual |
| **production** | `187.77.187.213` | Auto on every push (after staging succeeds), or manual |

| Domain (typical) | App |
|------------------|-----|
| https://staging.rentfoxxy.com | Admin CRM (`frontend`) |
| https://staging.rentfoxxy.com/api | Backend API (`backend`) |
| https://customer.rentfoxxy.com | Customer portal |
| https://vendor.rentfoxxy.com | Vendor portal |

**Workflow file:** `.github/workflows/deploy.yml`  
**VPS project path (both servers):** `/var/www/crm_rentfoxxy`  
**PM2 process name:** `crm-backend`  
**Each VPS keeps its own** `backend/.env` (DB, URLs, API keys).

---

## Deployment flow

```mermaid
flowchart TD
  A[Push to new_crm_rentfoxxy] --> B[deploy-staging]
  B --> C[SSH staging]
  C --> D[git reset + npm install/build + pm2 restart]
  D --> G[deploy-production]
  G --> H[SSH production]
  H --> I[git reset + npm install/build + pm2 restart]

  E[Actions → Run workflow] --> F{target?}
  F -->|staging| B
  F -->|production| G
  F -->|both| B
```

**Concurrency:** One deploy group at a time (`deploy-new-crm-rentfoxxy`).  
**Safety:** Remote script uses `set -euo pipefail`. If install/build fails, PM2 is not restarted.

---

## 1. GitHub Environments + Secrets

### Create environments

GitHub → **Settings → Environments** → create:

1. `staging`
2. `production` (recommended: enable **Required reviewers** so prod needs approval)

### Secrets on **each** environment

Add these three secrets **inside** the environment (not only at repo level), with **different values** per server:

| Secret | Staging example | Production example |
|--------|-----------------|--------------------|
| `VPS_HOST` | `157.173.221.119` | `187.77.187.213` |
| `VPS_USER` | `root` (or `deploy`) | `root` (or `deploy`) |
| `VPS_SSH_KEY` | Private key PEM | Same or separate private key |

> Do **not** commit private keys or `.env` files.

### Migrate from old single-server secrets

If you already have repo-level `VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` pointing at `187.77.187.213`:

1. Create Environments `staging` and `production`
2. Put **staging** secrets → `157.173.221.119`
3. Put **production** secrets → `187.77.187.213`
4. Optionally delete the old repo-level secrets so the wrong host cannot be used by accident

---

## 2. SSH key setup

### Generate a deploy key (local)

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/crm_rentfoxxy_deploy -N ""
```

- Private → GitHub Environment secret `VPS_SSH_KEY` (staging and/or production)
- Public → install on **both** VPS `authorized_keys` (or use one key per server)

### Install public key on a VPS

```bash
ssh YOUR_USER@YOUR_VPS_IP
mkdir -p ~/.ssh && chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys   # paste .pub line
chmod 600 ~/.ssh/authorized_keys
```

### Test both servers

```bash
ssh -i ~/.ssh/crm_rentfoxxy_deploy root@157.173.221.119 "echo staging-ok"
ssh -i ~/.ssh/crm_rentfoxxy_deploy root@187.77.187.213 "echo production-ok"
```

---

## 3. VPS one-time setup (each server)

Run on **staging** and **production**:

```bash
sudo apt update
sudo apt install -y git curl nginx certbot python3-certbot-nginx

curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

sudo mkdir -p /var/www/crm_rentfoxxy
sudo chown -R $USER:$USER /var/www/crm_rentfoxxy

cd /var/www
git clone -b new_crm_rentfoxxy https://github.com/YOUR_ORG/crm_rentfoxxy.git crm_rentfoxxy
cd crm_rentfoxxy
```

### Backend environment (per server — different values)

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

```env
NODE_ENV=production
PORT=5000

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=your_db
DB_USER=your_user
DB_PASSWORD=your_password
DB_SSL=false

JWT_SECRET=long-random-secret

FRONTEND_URL=https://staging.rentfoxxy.com,https://vendor.rentfoxxy.com,https://customer.rentfoxxy.com
VENDOR_PORTAL_URL=https://vendor.rentfoxxy.com
CUSTOMER_PORTAL_URL=https://customer.rentfoxxy.com
```

Adjust domains/DB for production if they differ.

### First PM2 start

```bash
cd /var/www/crm_rentfoxxy/backend
npm ci --omit=dev
pm2 start ecosystem.config.cjs --only crm-backend
pm2 save
pm2 startup
```

### Nginx / SSL

Point domains to the correct `build/` folders and proxy `/api` to the backend port. Example roots:

| Domain | `root` |
|--------|--------|
| CRM host | `/var/www/crm_rentfoxxy/frontend/build` |
| Customer portal | `/var/www/crm_rentfoxxy/customer-portal/build` |
| Vendor portal | `/var/www/crm_rentfoxxy/vendor-portal/build` |

---

## 4. How to run deployments

### Automatic (staging + production)

Every push to `new_crm_rentfoxxy` → **Deploy staging**, then **Deploy production** (only if staging succeeds).

### Manual

GitHub → **Actions** → **CI/CD Deploy to VPS** → **Run workflow**:

| Target | Result |
|--------|--------|
| `staging` | Staging only |
| `production` | Production only |
| `both` | Staging first, then production if staging succeeds |

---

## 5. Verify

```bash
# Staging
ssh root@157.173.221.119 "pm2 status && pm2 logs crm-backend --lines 30"

# Production
ssh root@187.77.187.213 "pm2 status && pm2 logs crm-backend --lines 30"
```

---

## 6. Troubleshooting

| Issue | Fix |
|-------|-----|
| Wrong server updated | Check Environment secrets: staging=`157…`, production=`187…` |
| SSH permission denied | Environment `VPS_SSH_KEY` / `VPS_USER` / `authorized_keys` |
| Job skipped unexpectedly | Push only runs staging; prod needs **Run workflow** |
| `both` skipped production | Staging job failed — fix staging first |
| Build OOM | Add swap on that VPS |
| CORS / wrong API URL | Fix that server’s `backend/.env` |

### Manual rollback on a VPS

```bash
cd /var/www/crm_rentfoxxy
git log --oneline -5
git reset --hard <previous-good-commit>
# rebuild frontends + pm2 restart, or re-run workflow
```

---

## 7. Security checklist

- [ ] Separate Environment secrets for staging vs production
- [ ] Production Environment has required reviewers (optional but recommended)
- [ ] Deploy SSH key is deploy-only
- [ ] `backend/.env` never committed
- [ ] Firewall: 22 / 80 / 443 only
- [ ] PostgreSQL not public

---

## 8. Files reference

| File | Purpose |
|------|---------|
| `.github/workflows/deploy.yml` | Dual-environment deploy workflow |
| `backend/ecosystem.config.cjs` | PM2 process definition |
| `deploy/CI_CD_SETUP.md` | This document |
