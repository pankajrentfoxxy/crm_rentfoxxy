# Dummy Landing Page Setup: erp.rentfoxxy.com

Guide to set up a dummy landing page on your VPS for **erp.rentfoxxy.com** (ports 80 and 443), sharing the same server as **crm.rentfoxxy.com**.

---

## Quick Automated Setup (Recommended)

From your **laptop-refurbishment** project folder, run:

```powershell
cd deploy
.\run-erp-dual-setup.ps1
```

You will be prompted for the **root** (or **rentfoxxyteam**) SSH password when copying files and running commands. The script will:

1. Copy nginx configs and ERP landing page to the VPS
2. Rebuild the web container with dual-domain support
3. Obtain SSL cert for erp.rentfoxxy.com
4. Enable HTTPS for both crm and erp

**Prerequisites:** DNS A record `erp` → `187.77.187.213` must be set in Hostinger.

---

## Overview

| Item | Value |
|------|-------|
| **VPS IP** | 187.77.187.213 |
| **SSH User** | rentfoxxyteam |
| **Project Path** | /docker/rentfoxxy_erp |
| **Domain** | erp.rentfoxxy.com |
| **Ports** | 80 (HTTP), 443 (HTTPS) |

---

## Part 1: DNS – Point erp.rentfoxxy.com to the New VPS

Your subdomain **erp.rentfoxxy.com** is currently pointing to another Hostinger server. To use the new VPS, update DNS:

### In Hostinger hPanel

1. Go to **Domains** → **rentfoxxy.com** → **DNS / Nameservers**
2. Find the **A record** for `erp` (or create it if missing)
3. Set:
   - **Type:** A
   - **Name:** `erp` (or `erp.rentfoxxy.com` depending on UI)
   - **Value:** `187.77.187.213`
   - **TTL:** 300 (or default)

4. Save changes

**Propagation:** Usually 5–30 minutes. Check with: `nslookup erp.rentfoxxy.com`

---

## Part 2: Create Project Directory and Landing Page on VPS

### Step 1: SSH into the VPS

```bash
ssh rentfoxxyteam@187.77.187.213
# Enter password when prompted
```

### Step 2: Create project directory and files

```bash
# Create project directory
sudo mkdir -p /docker/rentfoxxy_erp
sudo chown $USER:$USER /docker/rentfoxxy_erp
cd /docker/rentfoxxy_erp

# Create a simple HTML landing page
cat > index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RentFoxxy ERP - Coming Soon</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 100%);
      color: #fff;
      text-align: center;
      padding: 2rem;
    }
    .card {
      background: rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 3rem;
      max-width: 480px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    p { color: #94a3b8; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>RentFoxxy ERP</h1>
    <p>Coming soon. We're setting things up.</p>
  </div>
</body>
</html>
EOF
```

---

## Part 3: Serve with Nginx (HTTP + HTTPS)

### Option A: Nginx installed directly on the server

```bash
# Install Nginx (if not installed)
sudo apt update
sudo apt install -y nginx

# Create Nginx config for erp.rentfoxxy.com
sudo tee /etc/nginx/sites-available/erp.rentfoxxy.com << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name erp.rentfoxxy.com;
    root /docker/rentfoxxy_erp;
    index index.html;
    location / {
        try_files $uri $uri/ =404;
    }
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/erp.rentfoxxy.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Option B: Nginx in Docker (matches your other projects)

```bash
cd /docker/rentfoxxy_erp

# Create nginx config
cat > nginx.conf << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name erp.rentfoxxy.com;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files $uri $uri/ =404;
    }
}
EOF

# Create Dockerfile
cat > Dockerfile << 'EOF'
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
EOF

# Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
services:
  web:
    build: .
    ports:
      - "80:80"
    restart: unless-stopped
EOF

# Build and run
docker compose up -d --build
```

---

## Part 4: Add SSL (HTTPS on Port 443)

**Prerequisite:** DNS must point to 187.77.187.213 and HTTP must work first.

### Step 1: Get Let's Encrypt certificate

```bash
# Stop anything using port 80 (if using Docker)
cd /docker/rentfoxxy_erp
docker compose stop web

# Get certificate
sudo docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly --standalone -d erp.rentfoxxy.com \
  --email admin@rentfoxxy.com --agree-tos --non-interactive

# Start web again
docker compose start web
```

### Step 2: Update Nginx for HTTPS

**If using system Nginx:**

```bash
sudo tee /etc/nginx/sites-available/erp.rentfoxxy.com << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name erp.rentfoxxy.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name erp.rentfoxxy.com;
    ssl_certificate /etc/letsencrypt/live/erp.rentfoxxy.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/erp.rentfoxxy.com/privkey.pem;
    root /docker/rentfoxxy_erp;
    index index.html;
    location / {
        try_files $uri $uri/ =404;
    }
}
EOF
sudo nginx -t && sudo systemctl reload nginx
```

**If using Docker:** Update `nginx.conf` and `docker-compose.yml` to add port 443 and mount certs. (See your existing `setup-ssl.ps1` pattern for crm.rentfoxxy.com.)

---

## Port 80 Already in Use?

If **crm.rentfoxxy.com** (or another app) is already using port 80 on this VPS, you have two options:

1. **Use a different port** (e.g. 8080) and put Cloudflare or Hostinger in front to proxy to it.
2. **Single Nginx reverse proxy**: Run one Nginx that listens on 80/443 and routes by `server_name`:
   - `erp.rentfoxxy.com` → landing page
   - `crm.rentfoxxy.com` → existing app

For option 2, add a new `server` block for `erp.rentfoxxy.com` to your existing Nginx config instead of running a separate container on port 80.

---

## Part 5: Hostinger Subdomain – Where to Change DNS

If **erp.rentfoxxy.com** was created as a subdomain in Hostinger:

1. **hPanel** → **Domains** → **rentfoxxy.com**
2. **Subdomains** or **DNS Zone**
3. Edit the subdomain `erp`:
   - Change its A record from the old IP to **187.77.187.213**
   - Or remove the subdomain and add a new A record: `erp` → `187.77.187.213`

If the domain uses **external nameservers** (e.g. Cloudflare), update the A record in that DNS provider instead.

---

## Checklist

- [ ] DNS A record: `erp` → `187.77.187.213`
- [ ] Wait for DNS propagation (5–30 min)
- [ ] SSH to VPS and create `/docker/rentfoxxy_erp` with `index.html`
- [ ] Configure Nginx (system or Docker)
- [ ] Test HTTP: http://erp.rentfoxxy.com
- [ ] Obtain Let's Encrypt cert
- [ ] Configure HTTPS and test: https://erp.rentfoxxy.com

---

## Security Note

Do not commit passwords or secrets to git. Use SSH keys where possible:

```bash
ssh-copy-id rentfoxxyteam@187.77.187.213
```

Then you can SSH without entering the password each time.
