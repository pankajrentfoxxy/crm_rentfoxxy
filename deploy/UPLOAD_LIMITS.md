# File Upload Limits — RentFoxxy CRM

## Application defaults (after fix)

| Setting | Default | Env override |
|---------|---------|--------------|
| Max file size (multer) | **50 MB** per file | `UPLOAD_MAX_FILE_MB` |
| Max files per request | **25** | `UPLOAD_MAX_FILES` |
| JSON / urlencoded body | **50 MB** | `BODY_PARSER_LIMIT` |

Shared config: `backend/config/uploadLimits.js`

## Upload endpoints (all use shared limits unless noted)

| Module | Route | Field |
|--------|-------|-------|
| Customer Management | `POST /api/customer-management/customers` | `upload_docs`, `profile` |
| Customer Documents | `POST /api/customer-documents/:customerId/upload` | `file` |
| Sales (legacy) | `POST /api/sales/customers/upload` | `file` |
| Leads | `POST /api/leads/upload` | `file` |
| Inventory | `POST /api/inventory/upload`, `/catalog/upload` | `file` |
| Diagnosis | `POST /api/diagnosis/ticket/:id/images` | `image` |
| QC (floor) | `POST /api/tickets/qc/:qc_id/upload-photo` | `photo` |
| QC Management | `POST /api/qc-management/return-and-repare-check` | `files` |
| Sales Management | `POST/PATCH .../delivery-challans/.../deliver` | `pod_photo` |
| Delivery Register | `POST /api/delivery-register-management/:dcNumber/pod` | `files` |
| Delivery Register | `POST/PATCH .../technicians` | `image`, `identity_image` |
| Support | `POST /api/support/tickets/:id/items/:itemId/pod` | `pod` |
| Vendor Management | Vendor create/update | `image`, `licenses_and_permits`, `logo`, `banner` |
| Vendor Management | PO / GRN / SPO bill uploads | `files` |
| Vendor Portal | PO invoice upload | `file` |

## Nginx (required on VPS / staging / production)

Default Nginx `client_max_body_size` is **1 MB**, which blocks large uploads **before** they reach Node.

Add inside the `server { }` block (or in the `location /api/` block):

```nginx
client_max_body_size 50M;
```

Then reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

If the frontend is served by the same Nginx host, the same directive applies to `/api` proxy passes.

## PM2 / Node

No special PM2 limit is required beyond the Express/multer settings above.

Restart backend after changing env:

```bash
pm2 restart crm-backend
```

Optional `.env` entries:

```env
UPLOAD_MAX_FILE_MB=50
UPLOAD_MAX_FILES=25
BODY_PARSER_LIMIT=50mb
```

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| **413 Request Entity Too Large** (Nginx HTML page) | Nginx `client_max_body_size` too small |
| **400** `File is too large. Maximum allowed size is 50 MB` | Multer limit — increase `UPLOAD_MAX_FILE_MB` |
| **500** with no JSON body on upload | Missing `wrapMulter` on route — should return 400 JSON |
| Upload works locally but fails on staging | Nginx not updated on server |

## Verify locally

```bash
cd backend
node scripts/test-upload-limits.js
```
