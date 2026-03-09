# HTTPS Setup for crm.rentfoxxy.com

Follow these steps to enable HTTPS. Run from your local machine (PowerShell) or directly on the VPS (bash).

---

## Prerequisites

- DNS A record: `crm` → `187.77.187.213` (already done)
- HTTP working at http://crm.rentfoxxy.com
- SSH access to VPS: `ssh root@187.77.187.213`

---

## Step 1: Add ACME challenge volume (one-time)

The web container must serve `/.well-known/acme-challenge/` for Let's Encrypt. The base `nginx.deploy.conf` already includes this. If your Hostinger deployment doesn't mount the certbot path, add it manually when running the container, or skip to Step 2 and use the certbot standalone method (requires briefly stopping the web container).

---

## Step 2: Obtain certificate (run on VPS)

SSH to the VPS:

```bash
ssh root@187.77.187.213
```

### Option A: Webroot (no downtime – web container must serve ACME challenge)

```bash
# Create directory
mkdir -p /var/www/certbot

# Obtain cert (web container must have /var/www/certbot mounted)
docker run --rm -v /var/www/certbot:/var/www/certbot -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly --webroot -w /var/www/certbot -d crm.rentfoxxy.com \
  --email admin@rentfoxxy.com --agree-tos --non-interactive
```

If you get "Connection refused" or validation fails, the web container may not be serving the ACME path. Use Option B.

### Option B: Standalone (brief downtime – stops port 80)

```bash
# Stop the web container
docker stop laptop-erp-web

# Obtain cert
docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly --standalone -d crm.rentfoxxy.com \
  --email admin@rentfoxxy.com --agree-tos --non-interactive

# Start the web container again
docker start laptop-erp-web
```

---

## Step 3: Switch to SSL (run on VPS)

Navigate to your app directory (where docker-compose is):

```bash
cd /root/laptop-erp   # or wherever Hostinger deploys
```

Apply the SSL override and rebuild:

```bash
docker compose -f docker-compose.yaml -f docker-compose.ssl.yml down web
docker compose -f docker-compose.yaml -f docker-compose.ssl.yml build web
docker compose -f docker-compose.yaml -f docker-compose.ssl.yml up -d
```

Or if using `docker-compose` (older syntax):

```bash
docker-compose -f docker-compose.yaml -f docker-compose.ssl.yml down web
docker-compose -f docker-compose.yaml -f docker-compose.ssl.yml build web
docker-compose -f docker-compose.yaml -f docker-compose.ssl.yml up -d
```

---

## Step 4: Update FRONTEND_URL in Hostinger

1. **hPanel** → **VPS** → **Docker Manager** → your project
2. Edit the **backend** container environment
3. Set **FRONTEND_URL** = `https://crm.rentfoxxy.com`
4. Restart the backend container

---

## Step 5: Test

- Visit: **https://crm.rentfoxxy.com**
- HTTP should redirect to HTTPS automatically

---

## Certificate renewal

Let's Encrypt certs expire in 90 days. Add a cron job on the VPS:

```bash
crontab -e
```

Add:

```
0 3 1 * * docker run --rm -v /var/www/certbot:/var/www/certbot -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot renew --webroot -w /var/www/certbot && docker exec laptop-erp-web nginx -s reload
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Connection refused" during certbot | Use Option B (standalone) or ensure port 80 is open |
| "Certificate not found" when starting nginx | Run Step 2 first; ensure cert is at `/etc/letsencrypt/live/crm.rentfoxxy.com/` |
| Mixed content after HTTPS | Set FRONTEND_URL to `https://crm.rentfoxxy.com` in Hostinger |
