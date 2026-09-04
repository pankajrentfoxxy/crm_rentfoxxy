#!/usr/bin/env bash
# Print TaskFlow .env lines that must match CRM backend/.env (run on CRM server).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/.env"

: "${TASKFLOW_SSO_SECRET:?TASKFLOW_SSO_SECRET missing in backend/.env}"

cat <<EOF
# Paste into TaskFlow server backend/.env (then: pm2 reload taskflow --update-env)
CRM_SSO_SECRET=${TASKFLOW_SSO_SECRET}
CRM_SSO_ISSUER=${TASKFLOW_SSO_ISSUER:-rentfoxxy-crm}
CRM_SSO_AUDIENCE=${TASKFLOW_SSO_AUDIENCE:-taskflow}
EOF
