# Deploy

## Quick: Push → Deploy

1. Push changes to Git
2. SSH to VPS: `ssh root@187.77.187.213`
3. Run: `cd /opt/laptop-erp && git pull && docker compose up -d --build`

**Full guide:** [DEPLOY_WORKFLOW.md](DEPLOY_WORKFLOW.md)

---

## Essential Files

| File | Purpose |
|------|---------|
| `Dockerfile.backend` | Backend image |
| `Dockerfile.web.root` | Frontend + nginx |
| `nginx.conf` | Web server config |
| `docker-compose.yml` | Services (deploy context) |
| `.env.example` | Env template |

---

## Folders

- **archive/** – Old migration/setup docs (reference only)
- **erp-setup/** – ERP landing page (for later)
