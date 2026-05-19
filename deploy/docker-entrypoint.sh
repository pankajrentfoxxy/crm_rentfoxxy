#!/bin/sh
# Auto-detect SSL certs and pick nginx config
CERT_DIR="/etc/letsencrypt/live/crm.rentfoxxy.com"
if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
  echo "Using HTTPS config (SSL certs found)"
  cp /etc/nginx/conf.d/nginx.ssl.conf /etc/nginx/conf.d/default.conf
else
  echo "Using HTTP-only config (no SSL certs yet)"
  cp /etc/nginx/conf.d/nginx.http-only.conf /etc/nginx/conf.d/default.conf
fi
exec nginx -g "daemon off;"
