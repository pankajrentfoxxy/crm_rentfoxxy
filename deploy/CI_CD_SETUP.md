# CI/CD — GitHub Actions → Hostinger VPS

Automated deployment for the Rentfoxxy MERN stack when code is pushed to `new_crm_rentfoxxy`.

| Domain | App |
|--------|-----|
| https://staging.rentfoxxy.com | Admin CRM (`frontend`) |
| https://staging.rentfoxxy.com/api | Backend API (`backend`) |
| https://customer.rentfoxxy.com | Customer portal |
| https://vendor.rentfoxxy.com | Vendor portal |

**Workflow file:** `.github/workflows/deploy.yml`  
**VPS project path:** `/var/www/crm_rentfoxxy`  
**PM2 process name:** `crm-backend`

---

## Deployment flow

```mermaid
flowchart TD
  A[Push to new_crm_rentfoxxy<br/>or workflow_dispatch] --> B[GitHub Actions: deploy.yml]
  B --> C[preflight: npm ci with Actions cache]
  C --> D{Deps OK?}
  D -->|No| E[Fail — VPS untouched]
  D -->|Yes| F[SSH into VPS]
  F --> G{skip_git_pull?}
  G -->|No| H[git fetch + reset --hard]
  G -->|Yes| I[Use current checkout]
  H --> J[backend: npm ci --omit=dev]
  I --> J
  J --> K[frontend: npm ci + build]
  K --> L[customer-portal: npm ci + build]
  L --> M[vendor-portal: npm ci + build]
  M --> N{All steps OK?}
  N -->|No| O[Exit 1 — PM2 NOT restarted]
  N -->|Yes| P[pm2 reload crm-backend]
  P --> Q[pm2 save]
  Q --> R[curl /api/health]
  R --> S[Deployment success]
```

**Rollback protection:** The remote script uses `set -euo pipefail`. If any `npm ci`, `npm run build`, or health check fails, the script exits immediately and **PM2 is never restarted**.

**Concurrency:** Only one deployment runs at a time (`concurrency.group: deploy-new-crm-rentfoxxy`).

**npm caching:**

- **GitHub Actions:** `preflight` job uses `actions/setup-node@v4` with `cache: npm` for all four `package-lock.json` files.
- **VPS:** Persistent cache at `/var/www/crm_rentfoxxy/.npm-cache` via `NPM_CONFIG_CACHE` during deploy.

---

## 1. GitHub Secrets

In GitHub: **Repository → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Description | Example |
|--------|-------------|---------|
| `VPS_HOST` | VPS public IP or hostname | `187.77.187.213` |
| `VPS_USER` | SSH user with deploy permissions | `deploy` or `root` |
| `VPS_SSH_KEY` | **Private** SSH key (full PEM contents) | See SSH setup below |

> Do **not** commit private keys or `.env` files to the repository.

### Optional (recommended): GitHub Environment

Create an environment named `production` in **Settings → Environments** and attach the secrets there for approval gates and audit logs.

---

## 2. SSH key setup

### On your local machine (Windows PowerShell or Git Bash)

```bash
# Generate a deploy-only key (no passphrase for CI; store private key only in GitHub Secrets)
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/crm_rentfoxxy_deploy -N ""
```

This creates:

- `~/.ssh/crm_rentfoxxy_deploy` — **private** → paste into GitHub secret `VPS_SSH_KEY`
- `~/.ssh/crm_rentfoxxy_deploy.pub` — **public** → install on VPS

### Install public key on VPS

```bash
ssh YOUR_USER@YOUR_VPS_IP

# As deploy user:
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
# Paste the contents of crm_rentfoxxy_deploy.pub on its own line
chmod 600 ~/.ssh/authorized_keys
```

### Test SSH (from local)

```bash
ssh -i ~/.ssh/crm_rentfoxxy_deploy YOUR_USER@YOUR_VPS_IP "echo OK"
```

### Add private key to GitHub

Copy the **entire** private key file including headers:

```
-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----
```

Paste into GitHub secret `VPS_SSH_KEY`.

---

## 3. VPS one-time setup (Ubuntu)

SSH into the VPS and run:

```bash
# System packages
sudo apt update
sudo apt install -y git curl nginx certbot python3-certbot-nginx

# Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# PM2
sudo npm install -g pm2

# Project directory
sudo mkdir -p /var/www/crm_rentfoxxy
sudo chown -R $USER:$USER /var/www/crm_rentfoxxy

# Clone repository (first time only)
cd /var/www
git clone -b new_crm_rentfoxxy https://github.com/YOUR_ORG/crm_rentfoxxy.git crm_rentfoxxy
cd crm_rentfoxxy
```

### Backend environment

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Minimum production values:

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

### First PM2 start

```bash
cd /var/www/crm_rentfoxxy/backend
npm ci --omit=dev
pm2 start ecosystem.config.cjs --only crm-backend
pm2 save
pm2 startup    # run the command it prints
```

### Nginx (summary)

Point each domain to the correct `build/` folder and proxy `/api` on staging to `127.0.0.1:5000`. See the multi-domain deploy guide for full server blocks.

| Domain | `root` |
|--------|--------|
| `staging.rentfoxxy.com` | `/var/www/crm_rentfoxxy/frontend/build` |
| `customer.rentfoxxy.com` | `/var/www/crm_rentfoxxy/customer-portal/build` |
| `vendor.rentfoxxy.com` | `/var/www/crm_rentfoxxy/vendor-portal/build` |

SSL:

```bash
sudo certbot --nginx \
  -d staging.rentfoxxy.com \
  -d customer.rentfoxxy.com \
  -d vendor.rentfoxxy.com
```

### Deploy user permissions (recommended)

```bash
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG www-data deploy
sudo chown -R deploy:www-data /var/www/crm_rentfoxxy
```

Allow PM2 for deploy user without sudo:

```bash
pm2 startup systemd -u deploy --hp /home/deploy
```

Use `deploy` as `VPS_USER` in GitHub Secrets.

---

## 4. How deployment works

### Automatic

Every push to `new_crm_rentfoxxy` triggers `.github/workflows/deploy.yml`.

### Manual

GitHub → **Actions** → **Deploy to Hostinger VPS** → **Run workflow**

- Leave **skip git pull** unchecked for a normal deploy (pull latest code).
- Check **skip git pull** to rebuild the current VPS checkout without `git reset`.

### What the workflow does

**Job 1 — `preflight` (GitHub runner, cached npm):**

1. Checkout code
2. `npm ci` in all four packages (validates lockfiles before touching VPS)

**Job 2 — `deploy` (VPS via SSH):**

1. `git fetch origin new_crm_rentfoxxy`
2. `git reset --hard origin/new_crm_rentfoxxy`
3. `npm ci` in `backend`, `frontend`, `customer-portal`, `vendor-portal`
4. `npm run build` for all three frontends with `REACT_APP_API_URL=https://staging.rentfoxxy.com/api`
5. `pm2 reload crm-backend` (only if all builds succeed)
6. `pm2 save`
7. `curl https://staging.rentfoxxy.com/api/health`

---

## 5. Verify after first deploy

```bash
# On VPS
pm2 status
pm2 logs crm-backend --lines 50

# From anywhere
curl https://staging.rentfoxxy.com/api/health
```

Open in browser:

- https://staging.rentfoxxy.com
- https://vendor.rentfoxxy.com
- https://customer.rentfoxxy.com

---

## 6. Troubleshooting

| Issue | Fix |
|-------|-----|
| SSH permission denied | Verify `VPS_SSH_KEY`, `VPS_USER`, `authorized_keys` on VPS |
| `git reset` fails | Ensure repo exists at `/var/www/crm_rentfoxxy` and branch is fetched |
| Build OOM on small VPS | Add swap or build locally and rsync `build/` folders |
| CORS errors on portals | Set `FRONTEND_URL` in `backend/.env` with all three domains |
| PM2 not found | `sudo npm i -g pm2` and ensure `VPS_USER` PATH includes global npm bin |
| Health check fails | Check `pm2 logs crm-backend`, DB connection in `.env`, nginx `/api` proxy |

### Manual rollback on VPS

```bash
cd /var/www/crm_rentfoxxy
git log --oneline -5
git reset --hard <previous-good-commit>
# Re-run builds manually or trigger workflow with skip_git_pull after reset
```

---

## 7. Security checklist

- [ ] Deploy SSH key is **deploy-only** (not your personal key)
- [ ] `backend/.env` is never committed (in `.gitignore`)
- [ ] VPS firewall allows 22, 80, 443 only
- [ ] PostgreSQL not exposed publicly
- [ ] GitHub branch protection on `new_crm_rentfoxxy` (optional)
- [ ] Rotate `VPS_SSH_KEY` periodically

---

## 8. Files reference

| File | Purpose |
|------|---------|
| `.github/workflows/deploy.yml` | GitHub Actions workflow |
| `backend/ecosystem.config.cjs` | PM2 process definition |
| `deploy/CI_CD_SETUP.md` | This document |
