# Domain Setup: crm.rentfoxxy.com

## Step 1: DNS (Do this first)

Add an **A record** in your domain DNS:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | crm | 187.77.187.213 | 300 |

- **Where:** Your domain registrar (e.g. GoDaddy, Namecheap) or Hostinger DNS
- **Result:** crm.rentfoxxy.com → 187.77.187.213

Wait 5–30 minutes for DNS to propagate.

---

## Step 2: Update FRONTEND_URL in Hostinger

1. **hPanel** → **VPS** → **Docker Manager** → **laptop-erp**
2. Edit the **backend** container
3. Set **FRONTEND_URL** = `https://crm.rentfoxxy.com`
4. Restart the backend container

---

## Step 3: SSL (HTTPS)

### Option A: Hostinger SSL (if available)

If your domain is on Hostinger, check hPanel for SSL options.

### Option B: Let's Encrypt (manual)

SSH into the VPS and run:

```bash
# Install certbot
apt update && apt install -y certbot

# Get certificate (nginx must be running)
certbot certonly --standalone -d crm.rentfoxxy.com --non-interactive --agree-tos -m your@email.com

# Certificates will be at:
# /etc/letsencrypt/live/crm.rentfoxxy.com/fullchain.pem
# /etc/letsencrypt/live/crm.rentfoxxy.com/privkey.pem
```

Then update nginx to use SSL. Or use Hostinger's built-in SSL if available.

---

## Step 4: Test

After DNS propagates:

- **HTTP:** http://crm.rentfoxxy.com
- **HTTPS:** https://crm.rentfoxxy.com (after SSL is set up)

---

## Quick Start (HTTP only)

If you want to use the domain without SSL first:

1. Add DNS A record: crm → 187.77.187.213
2. Update FRONTEND_URL to `http://crm.rentfoxxy.com` in Hostinger
3. Restart backend
4. Access app at http://crm.rentfoxxy.com
