# Backend File Structure

Node.js / Express CRM API (`laptop-refurbishment-backend`) — PostgreSQL, Prisma ORM, JWT auth, background workers, and VPS deploy scripts.

> Generated structure excludes `node_modules/` and runtime upload contents.

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
│   └── warehouseController.js
├── deploy/
│   ├── docker-entrypoint-web.sh
│   ├── fix-https-vps.sh
│   ├── nginx.deploy.conf
│   ├── nginx.deploy.http-only.conf
│   ├── redeploy-vps.sh
│   ├── setup-ssl-vps.sh
│   ├── test-erp-connection-vps.sh
│   └── trigger-inventory-sync-vps.sh
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
│   ├── 003_stage_categories_ttspl_id.sql
│   ├── 004_add_qc_tables.sql
│   ├── 005_order_item_level_logistics.sql
│   ├── 006_inventory_erp_sync.sql
│   ├── 007_add_address_type.sql
│   ├── 008_replace_repeat_with_callback.sql
│   ├── 009_lead_remarks.sql
│   ├── 010_add_order_teams.sql
│   ├── 011_add_proposed_delivery_date.sql
│   ├── 013_warehouse_team.sql
│   ├── 014_stage_categories_ttspl_id.sql
│   ├── 015_hardware_software_team.sql
│   ├── 016_apple_generation_from_processor.sql
│   ├── 017_apple_generation_laptop_catalog.sql
│   ├── 018_order_items_qc_sales_checklist.sql
│   ├── 019_lead_stage_demo.sql
│   ├── 020_order_type_normalize.sql
│   ├── 021_qc_pipeline_schema_guards.sql
│   ├── 022_orders_qc_timing.sql
│   ├── 023_tickets_serial_repair_cycles.sql
│   ├── 024_existing_customer_inventory.sql
│   ├── 025_support_module.sql
│   ├── 026_support_redesign.sql
│   ├── 027_support_v2.sql
│   ├── 028_support_user_roles.sql
│   ├── 029_support_v3.sql
│   ├── 030_lead_quotation_accept.sql
│   ├── 031_support_ticket_category.sql
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
│   └── ticketWorkLogService.js
├── uploads/
│   ├── customers/
│   └── support/
├── .dockerignore
├── .env
├── .env.example
├── .gitignore
├── docker-compose.yaml
├── FILE_STRUCTURE.md
├── LOCAL_DEV_REMOTE_DB.md
├── master_setup.sql
├── package.json
├── package-lock.json
└── server.js
```

## Root

| File | Purpose |
|------|---------|
| `server.js` | Express app entry; mounts routes, static uploads, health checks, and background workers |
| `master_setup.sql` | Full database bootstrap / reference schema |
| `package.json` | Dependencies and npm scripts (`start`, `dev`, `prisma:generate`) |
| `package-lock.json` | Locked dependency versions |
| `docker-compose.yaml` | Docker stack for local / VPS deployment |
| `.env` | Environment variables (DB, JWT, ERP, email, etc.) |
| `.env.example` | Example env template |
| `.dockerignore` | Files excluded from Docker build context |
| `.gitignore` | Git ignore rules |
| `FILE_STRUCTURE.md` | This file — backend directory reference |
| `LOCAL_DEV_REMOTE_DB.md` | Guide for connecting local dev to remote DB |

## API routes (`server.js`)

| Mount path | Route file | Domain |
|------------|------------|--------|
| `/api/auth` | `routes/auth.js` | Login, users, JWT |
| `/api/tickets` | `routes/tickets.js` | Repair tickets & QC |
| `/api/sales` | `routes/sales.js` | Sales orders & QC pipeline |
| `/api/procurement` | `routes/procurement.js` | Procurement |
| `/api/warehouse` | `routes/warehouse.js` | Warehouse operations |
| `/api/stages` | `routes/stages.js` | Workflow stages |
| `/api/teams` | `routes/teams.js` | Team management |
| `/api/parts` | `routes/parts.js` | Parts catalog |
| `/api/inventory` | `routes/inventory.js` | Inventory & ERP sync |
| `/api/analytics` | `routes/analytics.js` | Dashboard analytics |
| `/api/reports` | `routes/reports.js` | Reports |
| `/api/diagnosis` | `routes/diagnosis.js` | Device diagnosis |
| `/api/chip-repair` | `routes/chipLevel.js` | Chip-level repair |
| `/api/quotation` | `routes/quotationPublic.js` | Public quotation accept links |
| `/api/leads` | `routes/leads.js` | Leads CRUD, CSV, assign, follow-up |
| `/api/customer-inventory` | `routes/customerInventory.js` | Customer-owned inventory |
| `/api/support` | `routes/support.js` | Customer support tickets |
| `/uploads` | — | Static file serving for uploads |
| `/health`, `/api/health` | — | Server and DB health checks |

## `config/`

| File | Purpose |
|------|---------|
| `db.js` | PostgreSQL connection pool |

## `constants/`

| File | Purpose |
|------|---------|
| `leadStages.js` | Lead pipeline stages and status-to-stage mappings |

## `middleware/`

| File | Purpose |
|------|---------|
| `auth.js` | JWT authentication and role checks |
| `errorHandler.js` | Global Express error handler |
| `supportAccess.js` | Support module access control |

## `controllers/`

| File | Purpose |
|------|---------|
| `analyticsController.js` | Dashboard stats and analytics |
| `authController.js` | Auth, users, schema ensure |
| `chipLevelController.js` | Chip-level repair workflow |
| `customerInventoryController.js` | Customer inventory CRUD & sync |
| `diagnosisController.js` | Device diagnosis records |
| `inventoryController.js` | Inventory management & ERP sync |
| `inventoryStockSummary.js` | Stock summary helpers |
| `leadController.js` | Leads, CSV import/export, assign |
| `partController.js` | Parts inventory |
| `partsDropdownController.js` | Parts dropdown data |
| `procurementController.js` | Procurement orders |
| `qcController.js` | QC forms, photos, history |
| `reportsController.js` | Report generation |
| `salesController.js` | Sales orders and pipeline |
| `stageController.js` | Workflow stage categories |
| `supportController.js` | Support tickets, schema ensure |
| `teamController.js` | Team CRUD |
| `ticketController.js` | Repair ticket lifecycle |
| `warehouseController.js` | Warehouse dispatch & logistics |

## `routes/`

| File | Purpose |
|------|---------|
| `analytics.js` | Analytics endpoints |
| `auth.js` | Auth & user endpoints |
| `chipLevel.js` | Chip repair endpoints |
| `customerInventory.js` | Customer inventory endpoints |
| `diagnosis.js` | Diagnosis endpoints |
| `inventory.js` | Inventory endpoints |
| `leads.js` | Lead endpoints |
| `parts.js` | Parts endpoints |
| `procurement.js` | Procurement endpoints |
| `quotationPublic.js` | Public quotation endpoints |
| `reports.js` | Report endpoints |
| `sales.js` | Sales & QC pipeline endpoints |
| `salesPipeline.js` | Sales pipeline route helpers |
| `stages.js` | Stage endpoints |
| `support.js` | Support ticket endpoints |
| `teams.js` | Team endpoints |
| `tickets.js` | Ticket & QC endpoints |
| `warehouse.js` | Warehouse endpoints |

## `services/` — Background jobs & business logic

| File | Purpose |
|------|---------|
| `emailQueueService.js` | Outbound email queue worker |
| `inventoryErpSyncService.js` | ERP inventory sync worker |
| `inventoryLinkedSyncService.js` | Linked inventory sync helpers |
| `customerInventoryErpSyncService.js` | Customer inventory ERP sync worker |
| `leadEmailIngestionService.js` | Inbound lead email (IMAP) worker |
| `leadAutoAssignService.js` | Auto-assign unassigned leads |
| `leadQuotationService.js` | Lead quotation generation |
| `leadResearchService.js` | Lead research enrichment |
| `perplexityService.js` | Perplexity AI integration |
| `qcRoundRobinService.js` | QC round-robin assignment |
| `supportInventoryService.js` | Support ↔ inventory linking |
| `supportQuery.js` | Support DB query helpers |
| `supportTicketFlow.js` | Support ticket state machine |
| `ticketWorkLogService.js` | Ticket work timer / logs |

## `prisma/`

| File | Purpose |
|------|---------|
| `schema.prisma` | Prisma ORM schema (PostgreSQL models) |
| `client.js` | Shared Prisma client instance |

## `migrations/`

Numbered SQL migration files (000–031 plus supplemental scripts). Applied manually or via deploy scripts. Covers QC, support, leads, inventory ERP sync, tickets, and teams.

## `scripts/`

| File | Purpose |
|------|---------|
| `run-inventory-sync.js` | Manual ERP inventory sync trigger |
| `test-erp-connection.js` | ERP API connectivity test |

## `deploy/`

| File | Purpose |
|------|---------|
| `docker-entrypoint-web.sh` | Web container entrypoint |
| `fix-https-vps.sh` | VPS HTTPS troubleshooting |
| `nginx.deploy.conf` | Production nginx config |
| `nginx.deploy.http-only.conf` | HTTP-only nginx config |
| `redeploy-vps.sh` | Full VPS redeploy script |
| `setup-ssl-vps.sh` | SSL / Let's Encrypt setup |
| `test-erp-connection-vps.sh` | ERP connection test on VPS |
| `trigger-inventory-sync-vps.sh` | Trigger inventory sync on VPS |

## `docs/`

| File | Purpose |
|------|---------|
| `ERP_INVENTORY_SYNC_FLOW.md` | ERP inventory sync flow documentation |

## `assets/`

| File | Purpose |
|------|---------|
| `rentfoxxy-logo.png` | Brand logo (emails / PDFs) |

## `uploads/`

Runtime file storage (not committed).

| Folder | Purpose |
|--------|---------|
| `customers/` | Customer-related uploads |
| `support/` | Support ticket attachments |

## Background workers (started in `server.js`)

| Worker | Service |
|--------|---------|
| Email queue | `emailQueueService.js` |
| ERP inventory sync | `inventoryErpSyncService.js` |
| Lead email ingestion | `leadEmailIngestionService.js` |
| Customer inventory ERP sync | `customerInventoryErpSyncService.js` |

## Excluded from tree

| Path | Notes |
|------|-------|
| `node_modules/` | npm dependencies (not committed) |
| `uploads/*` | User-uploaded files at runtime |

## File counts

| Area | Files |
|------|-------|
| Root | 11 |
| `config/` | 1 |
| `constants/` | 1 |
| `controllers/` | 19 |
| `middleware/` | 3 |
| `routes/` | 18 |
| `services/` | 14 |
| `prisma/` | 2 |
| `migrations/` | 35 |
| `scripts/` | 2 |
| `deploy/` | 8 |
| `docs/` | 1 |
| `assets/` | 1 |
| **Total (source + config)** | **116** |
