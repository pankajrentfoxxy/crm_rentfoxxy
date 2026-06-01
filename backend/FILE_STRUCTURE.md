# Backend File Structure

Node.js / Express API (`laptop-refurbishment-backend`) for the RentFoxxy CRM — PostgreSQL via `pg` pool and Prisma, JWT auth, ERP sync workers, and background services.

> Generated structure excludes `node_modules/` and runtime upload files under `uploads/`.

## Directory tree

```
backend/
├── assets/
│   └── rentfoxxy-logo.png
├── config/
│   └── db.js
├── constants/
│   └── leadStages.js
├── controllers/
│   ├── vendorManagement/
│   │   ├── billing.controller.js
│   │   ├── purchaseOrders.controller.js
│   │   ├── replacedProducts.controller.js
│   │   ├── serialNumbers.controller.js
│   │   ├── sparePartsOrders.controller.js
│   │   └── vendors.controller.js
│   ├── analyticsController.js
│   ├── authController.js
│   ├── chipLevelController.js
│   ├── customerInventoryController.js
│   ├── diagnosisController.js
│   ├── inventoryController.js
│   ├── inventoryStockSummary.js
│   ├── leadController.js
│   ├── partController.js
│   ├── partsDropdownController.js
│   ├── procurementController.js
│   ├── qcController.js
│   ├── reportsController.js
│   ├── salesController.js
│   ├── stageController.js
│   ├── supportController.js
│   ├── teamController.js
│   ├── ticketController.js
│   ├── vendorManagementSchema.js
│   └── warehouseController.js
├── docs/
│   └── ERP_INVENTORY_SYNC_FLOW.md
├── middleware/
│   ├── auth.js
│   ├── errorHandler.js
│   └── supportAccess.js
├── migrations/
│   ├── 000_schema_migrations.sql
│   ├── 001_user_teams.sql
│   ├── 002_order_items_qc_passed.sql
│   ├── … (003–036 numbered migrations)
│   ├── 037_vendor_serial_inventory_meta.sql
│   ├── add_qc_round_robin_state.sql
│   ├── diagnosis_tables.sql
│   └── seed_dummy_inventory.sql
├── prisma/
│   ├── client.js
│   └── schema.prisma
├── routes/
│   ├── analytics.js
│   ├── auth.js
│   ├── chipLevel.js
│   ├── customerInventory.js
│   ├── diagnosis.js
│   ├── inventory.js
│   ├── leads.js
│   ├── parts.js
│   ├── procurement.js
│   ├── quotationPublic.js
│   ├── reports.js
│   ├── sales.js
│   ├── salesPipeline.js
│   ├── stages.js
│   ├── support.js
│   ├── teams.js
│   ├── tickets.js
│   ├── vendorManagement.js
│   └── warehouse.js
├── scripts/
│   ├── run-inventory-sync.js
│   └── test-erp-connection.js
├── services/
│   ├── customerInventoryErpSyncService.js
│   ├── emailQueueService.js
│   ├── inventoryErpSyncService.js
│   ├── inventoryLinkedSyncService.js
│   ├── leadAutoAssignService.js
│   ├── leadEmailIngestionService.js
│   ├── leadQuotationService.js
│   ├── leadResearchService.js
│   ├── perplexityService.js
│   ├── qcRoundRobinService.js
│   ├── supportInventoryService.js
│   ├── supportQuery.js
│   ├── supportTicketFlow.js
│   ├── ticketWorkLogService.js
│   ├── vendorAuditLogService.js
│   ├── vendorInventoryAssetCodeService.js
│   └── vendorNumberService.js
├── uploads/
│   ├── customers/
│   ├── support/
│   ├── vendor-po-bills/
│   └── vendor-spo-bills/
├── utils/
│   └── purchaseOrderGst.js
├── .dockerignore
├── .env
├── .env.example
├── backup.sql
├── docker-compose.yaml
├── Dockerfile
├── master_setup.sql
├── package.json
├── package-lock.json
└── server.js
```

## Root

| File | Purpose |
|------|---------|
| `server.js` | Express app entry: CORS, static uploads, route mounting, health checks, schema ensure on boot |
| `package.json` | Dependencies and scripts (`start`, `dev`, `prisma:generate`) |
| `package-lock.json` | Locked dependency versions |
| `master_setup.sql` | Full database bootstrap / reference schema |
| `backup.sql` | Database backup snapshot |
| `Dockerfile` | Container image for API deployment |
| `docker-compose.yaml` | Local Docker stack (API + Postgres) |
| `.dockerignore` | Files excluded from Docker build context |
| `.env` | Runtime secrets (DB, JWT, ERP, email, etc.) |
| `.env.example` | Environment variable template |

## `config/`

| File | Purpose |
|------|---------|
| `db.js` | PostgreSQL connection pool (`pg`); SSL rules for local vs remote hosts |

## `prisma/`

| File | Purpose |
|------|---------|
| `schema.prisma` | Prisma models (users, leads, orders, support, vendor management, etc.) |
| `client.js` | Shared Prisma client instance |

## `constants/`

| File | Purpose |
|------|---------|
| `leadStages.js` | Lead pipeline stage definitions (shared with frontend) |

## `middleware/`

| File | Purpose |
|------|---------|
| `auth.js` | JWT verification and role/team authorization |
| `errorHandler.js` | Central Express error handler |
| `supportAccess.js` | Support-module access checks |

## `routes/` — HTTP API surface

Routes are mounted in `server.js` under `/api/*`. Each file wires validators and controller handlers.

| File | Mount path | Domain |
|------|------------|--------|
| `auth.js` | `/api/auth` | Login, users, roles |
| `tickets.js` | `/api/tickets` | Refurbishment / repair tickets |
| `sales.js` | `/api/sales` | Sales orders and pipeline |
| `salesPipeline.js` | (imported by sales) | Sales pipeline helpers |
| `procurement.js` | `/api/procurement` | Procurement workflow |
| `warehouse.js` | `/api/warehouse` | Warehouse operations |
| `stages.js` | `/api/stages` | Workflow stages |
| `teams.js` | `/api/teams` | Team management |
| `parts.js` | `/api/parts` | Parts catalog and inventory |
| `inventory.js` | `/api/inventory` | Stock and ERP-linked inventory |
| `analytics.js` | `/api/analytics` | Dashboard analytics |
| `reports.js` | `/api/reports` | Reporting exports |
| `diagnosis.js` | `/api/diagnosis` | Device diagnosis |
| `chipLevel.js` | `/api/chip-repair` | Chip-level repair |
| `quotationPublic.js` | `/api/quotation` | Public quotation accept (no CRM auth) |
| `leads.js` | `/api/leads` | Lead CRM, research, quotations |
| `customerInventory.js` | `/api/customer-inventory` | Customer-owned inventory + ERP sync |
| `support.js` | `/api/support` | Support tickets module |
| `vendorManagement.js` | `/api/vendor-management` | Vendors, POs, GRNs, spare parts, billing |

## `controllers/` — Request handlers

| File | Purpose |
|------|---------|
| `authController.js` | Authentication, user CRUD, schema ensure |
| `ticketController.js` | Ticket lifecycle, stages, work logs |
| `salesController.js` | Sales orders, QC checklist, dispatch |
| `procurementController.js` | Procurement requests and fulfillment |
| `warehouseController.js` | Warehouse receive, dispatch, stock moves |
| `stageController.js` | Stage categories and transitions |
| `teamController.js` | Teams and assignments |
| `partController.js` | Parts master data |
| `partsDropdownController.js` | Dropdown / lookup data for parts |
| `inventoryController.js` | Inventory CRUD and movements |
| `inventoryStockSummary.js` | Stock summary aggregations |
| `analyticsController.js` | Analytics queries |
| `reportsController.js` | Report generation (incl. PDF via pdfkit) |
| `diagnosisController.js` | Diagnosis forms and results |
| `chipLevelController.js` | Chip-level repair records |
| `leadController.js` | Leads, follow-ups, assignments, quotations |
| `customerInventoryController.js` | Customer inventory and serials |
| `supportController.js` | Support tickets, OTP, replacements; schema ensure |
| `qcController.js` | QC rounds, checklists, round-robin |
| `vendorManagementSchema.js` | Vendor tables DDL ensure on boot |

### `controllers/vendorManagement/`

| File | Purpose |
|------|---------|
| `vendors.controller.js` | Vendor CRUD, login-as, lookups |
| `purchaseOrders.controller.js` | Purchase orders, status, bills |
| `sparePartsOrders.controller.js` | Spare-parts PO workflow |
| `serialNumbers.controller.js` | GRN, serial numbers, TTSPL linkage |
| `billing.controller.js` | Vendor billing records |
| `replacedProducts.controller.js` | Replaced / RMA product tracking |

## `services/` — Background and shared logic

| File | Purpose |
|------|---------|
| `inventoryErpSyncService.js` | Periodic ERP inventory sync worker |
| `inventoryLinkedSyncService.js` | Linked inventory sync helpers |
| `customerInventoryErpSyncService.js` | Customer inventory ERP sync worker |
| `leadEmailIngestionService.js` | IMAP lead email ingestion worker |
| `emailQueueService.js` | Outbound email queue worker |
| `leadAutoAssignService.js` | Round-robin / rule-based lead assignment |
| `leadQuotationService.js` | Quotation build and accept flow |
| `leadResearchService.js` | Lead company research orchestration |
| `perplexityService.js` | Perplexity API for lead research |
| `qcRoundRobinService.js` | QC technician round-robin assignment |
| `supportQuery.js` | Support ticket SQL/query helpers |
| `supportTicketFlow.js` | Support state machine and transitions |
| `supportInventoryService.js` | Support replacement inventory logic |
| `ticketWorkLogService.js` | Ticket work-log persistence |
| `vendorAuditLogService.js` | Vendor action audit trail |
| `vendorInventoryAssetCodeService.js` | Asset code generation for vendor stock |
| `vendorNumberService.js` | PO / SPO number sequences |

## `utils/`

| File | Purpose |
|------|---------|
| `purchaseOrderGst.js` | GST calculation helpers for vendor POs |

## `scripts/` — CLI utilities

| File | Purpose |
|------|---------|
| `run-inventory-sync.js` | One-off ERP inventory sync |
| `test-erp-connection.js` | ERP API connectivity smoke test |

## `migrations/`

Incremental SQL migrations applied in order (`000`–`037` plus ad-hoc files). Tracks schema evolution: users/teams, QC, logistics, ERP sync, leads, support (v1–v3), vendor management, serial/GRN, etc.

| Pattern | Examples |
|---------|----------|
| Numbered | `001_user_teams.sql` … `037_vendor_serial_inventory_meta.sql` |
| Ad-hoc | `add_qc_round_robin_state.sql`, `diagnosis_tables.sql`, `seed_dummy_inventory.sql` |

## `docs/`

| File | Purpose |
|------|---------|
| `ERP_INVENTORY_SYNC_FLOW.md` | ERP ↔ CRM inventory sync design notes |

## `assets/`

| File | Purpose |
|------|---------|
| `rentfoxxy-logo.png` | Logo used in PDFs / emails |

## `uploads/` — Runtime file storage

Served statically at `/uploads` from `server.js`. Not committed (user/vendor uploads).

| Path | Purpose |
|------|---------|
| `customers/` | Customer-related uploads |
| `support/` | Support ticket attachments |
| `vendor-po-bills/` | Purchase order bill images/PDFs |
| `vendor-spo-bills/` | Spare-parts order bill uploads |

## Architecture overview

```
Client (React CRM)
       │  HTTPS / JSON
       ▼
  server.js ──► routes/*.js ──► controllers/*.js
       │              │                    │
       │              │                    ├──► config/db.js (raw SQL)
       │              │                    └──► prisma/client.js (ORM)
       │
       ├──► middleware/auth.js
       ├──► services/* (workers, ERP, email, support flow)
       └──► uploads/ (multer static files)
```

## Excluded from tree

| Path | Notes |
|------|-------|
| `node_modules/` | npm dependencies (not committed) |
| `uploads/**` (file contents) | Runtime uploads; only folder layout documented |

## File counts

| Area | Files |
|------|-------|
| Root (config, entry, Docker, SQL) | 11 |
| `config/` | 1 |
| `prisma/` | 2 |
| `constants/` | 1 |
| `middleware/` | 3 |
| `routes/` | 18 |
| `controllers/` (top-level) | 18 |
| `controllers/vendorManagement/` | 6 |
| `services/` | 17 |
| `utils/` | 1 |
| `scripts/` | 2 |
| `migrations/` | 42 |
| `docs/` | 1 |
| `assets/` | 1 |
| **Total (source + config, excl. uploads)** | **~124** |
