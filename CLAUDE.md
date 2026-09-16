# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A production CRM/ERP for two business lines sharing one backend: **Rentfoxxy** (B2B laptop
rental) and **gorefurbo** (refurbishment/sale). Every laptop carries a `TTSPL####` asset
code tracked from vendor PO → GRN → refurbishment → QC → dispatch → rental/sale → support
→ return → scrap.

Four apps, one Express/PostgreSQL backend:

| Path | App | Host |
|---|---|---|
| `backend/` | Express + PostgreSQL API (~170k LOC) | port 5001 |
| `frontend/` | React 18 internal CRM (~131k LOC) | `crm.rentfoxxy.com` |
| `customer-portal/` | React customer self-service | `customer.rentfoxxy.com` |
| `vendor-portal/` | React vendor self-service | `vendor.rentfoxxy.com` |
| `migration/` | One-way ERP (MySQL) → CRM (Postgres) toolkit | — |

## Commands

```bash
# Backend (from backend/)
npm run dev                       # nodemon server.js
npm start                         # node server.js
npm test                          # unit tests + billing edge-case script
npm run test:unit                 # node --test test/*.test.js
node --test test/billingMath.test.js          # a single test file
node --test --test-name-pattern="pro-rata"    # a single test by name

# Schema
node scripts/run-all-migrations.js   # applies migrations/*.sql, tracked in schema_migrations
npm run prisma:generate
npm run prisma:sync                  # prisma db pull + update sync marker
npm run check:prisma-drift

# Asset configuration maintenance
npm run check:asset-config
npm run normalize:asset-config

# Frontends (from frontend/ | customer-portal/ | vendor-portal/)
npm start        # CRA dev server (customer-portal pins PORT=3002)
npm run build
```

Backend config lives in `backend/.env` (see `.env.example`, which documents every group:
DB, JWT, TaskFlow SSO, SMTP ×2, IMAP lead ingestion, BlueDart, Interakt WhatsApp, Zoho,
ERP, Perplexity). `server.js` loads it by absolute path because the process cwd is often
the repo root.

## Architecture

### Request path

`routes/*.js` → `authMiddleware` → `checkSectionPermission(section, action)` →
`controllers/*` → `services/*` → `config/db.js` (a single shared `pg` Pool, `max: 20`).

Routers are thin — they only wire middleware to controller functions. Controllers hold HTTP
concerns plus a lot of business logic; services hold the reusable domain logic, PDF
generation, and external integrations. There is no ORM in the request path: Prisma is used
in a few lead endpoints only (see *Schema ownership*).

### Authorization — three overlapping systems

Know which one a given route uses before changing access rules:

1. **The DB permission matrix (canonical).** `role_permissions` and `user_permissions`,
   both keyed `(role|user_id, section)` with `can_view/create/edit/delete`. Resolved in
   `services/permissionService.js`: a user-level override wins (including an explicit
   `false`), then the role default, then deny. `super_admin` short-circuits to allow
   everywhere. `SECTION_ALIASES` means one grant can satisfy several section names.
   Enforced by `middleware/checkPermission.js`, re-exported as `checkSectionPermission`
   from `middleware/auth.js`. Cached per-request only (`req.permissionCache`).
2. **A legacy `permissions[]` string array** embedded in the JWT at login. Read by
   `checkRoleOrPermission` in `middleware/auth.js` and by `middleware/supportAccess.js`.
3. **Hardcoded role lists** in `routes/sales.js`, `routes/warehouse.js` and
   `routes/procurement.js`, which bypass the matrix entirely — so the Roles & Permissions
   UI does not govern `/api/sales/*`.

Three orthogonal scoping dimensions sit on top, each with its own service and its own
override→role→default precedence:

- `data_scope` (`all` | `assigned`) — `services/dataScopeService.js`
- `customer_access` (`all` | `sales` | `rental`) — `services/customerAccessScope.js`,
  injected per-request as `req.allowedCustomerTypes` by `middleware/customerScope.js`
- `inventory_tag_access` (Ready-to-Rent / Ready-to-Sell) — `services/inventoryTagAccessScope.js`

Frontend mirrors this: `router/ProtectedRoute.jsx` guards by `section` + `action`,
`hooks/usePermission.js` gates UI affordances, and `constants/sectionHierarchy.js` +
`config/menuConfig.js` define the section tree. A parent section does **not** unlock its
children.

### Four actor types, four auth mechanisms

| Actor | Mechanism | Verified by |
|---|---|---|
| Internal CRM user | JWT, 30d | `middleware/auth.js` — signature only, no DB read |
| Customer portal | Opaque 48-byte DB session, 24h | `middleware/customerPortalAuth.js` |
| Vendor portal | JWT 24h **+** `vendor_portal_sessions` row + live vendor re-check | `middleware/vendorPortalAuth.js` |
| Technician / delivery | JWT, 30d, `auth_type: 'technician'` | `middleware/technicianAuth.js` |

All four are signed with the same `JWT_SECRET`. `controllers/unifiedLoginController.js`
resolves an email against `auth_credentials` and routes to the right portal.

### Public capture links

Six unauthenticated route families (`routes/*Public.js`, mounted in `server.js`) let a
technician's laptop submit its own hardware configuration during GRN, QC2, dispatch QC,
vendor return and RDC. Each mints a UUID token plus a short numeric access number, resolves
it, then accepts `verify-configuration` and serial-submission POSTs. Anything added here is
internet-facing with no auth — treat accordingly.

### Asset lifecycle

`services/inventoryStateMachine.js` is the declared single authority for
`vendor_serial_numbers.inventory_status`. 11 canonical states with an explicit transition
graph; `transitionAsset()` writes the row, an `inventory_status_transitions` audit row, and
a TTSPL audit event. Named wrappers (`reserveForDc`, `markDispatchReady`, `markDispatched`,
`markDelivered`, `markReturned`, `backToStock`, …) are the intended entry points.

**Always go through `transitionAsset()`.** About a dozen call sites currently write
`inventory_status` with a raw `UPDATE` and have polluted production with non-canonical
values; there is no CHECK constraint to stop you, and `isAllowed()` deliberately waves
through any unit already in a non-canonical state. Do not add another bypass.

Asset truth is spread across three tables kept in sync by hand — `vendor_serial_numbers`
(authoritative), `inventory` (legacy), `vendor_product_inventory` (ERP parity) — plus
`production_assets` for working config. Configuration has several sources with their own
precedence (`services/grnReceivedConfigService.js`).

### Document numbering

Two schemes, both in `services/salesManagementService.js`, both backed by
`sm_document_sequences`:

- `nextDocumentNumber(docType)` — flat counter, `PREFIX + pad(6)` (`EST-`, `RDC`, `GDC-`…)
- `nextFinancialYearNumber(kind, client)` — `SO/26-27/0779` style; `last_value` encodes
  `fyCode*10000 + seq`, locked `FOR UPDATE` and reconciled against `MAX()` of live data so
  ERP-imported numbers are respected. **Pass the caller's `client`** so the lock stays
  inside the caller's transaction.

Allocate numbers **inside** the write transaction and never accept one from the request
body. `peekFinancialYearNumber()` neither locks nor increments — it is preview-only.

Sales documents are denormalised: one row per line item with header fields repeated, keyed
by document number (`sales_quotations`, `sales_order_lines`, `delivery_challan_lines`).
There is no header table.

### GST and money

`computeGstBreakdown` / `isIntraState` in `services/salesManagementService.js` decide
CGST+SGST vs IGST from the place of supply. Use them rather than hand-rolling a rate — some
older paths (notably `services/leadQuotationService.js` and `controllers/salesController.js`)
hardcode 18% or a 9+9 split and are wrong for inter-state supply. Currency is float +
`toFixed(2)` per line; `services/billingMath.js` holds the pure, unit-tested date and
pro-rata helpers.

### Schema ownership — read this before touching SQL

- **Hand-written `backend/migrations/*.sql` are the source of truth.** Prisma
  (`backend/prisma/schema.prisma`) is a read-model mirror; never use `prisma migrate` to
  change production schema. See `backend/docs/PRISMA_OWNERSHIP.md`.
- `scripts/run-all-migrations.js` applies files in numeric order and records them in
  `schema_migrations`. The CI/CD deploy does **not** run it — schema changes are applied
  out of band, so on-disk migrations and the live schema can diverge. Verify a column
  exists before relying on it.
- **`ensureXSchema()` functions re-execute ~43 migration files on every backend boot**
  (`server.js`, plus `ensureSupportSchema`, `ensureUserSchema`, `ensureSalesManagementSchema`,
  …). Editing one of those files changes what runs on every restart, and several contain
  `INSERT`/`UPDATE`/`ON CONFLICT … DO UPDATE` over live RBAC and operational data. Add new
  work as a new migration; do not extend a replayed one.
- Migration numbers collide (37 duplicates from parallel branches). Check the highest
  existing number across *all* files before picking one.

### SQL safety

Per `backend/docs/SQL_SAFETY.md`: all user-supplied values use `$N` placeholders. Dynamic
SQL fragments may only contain whitelisted column identifiers, a whitelisted sort direction,
or static join fragments. Use `backend/utils/sqlSafety.js`
(`pickSortColumn`, `pickSortDirection`, `buildWhereAnd`). Never interpolate `req.query`,
`req.params` or `req.body` into a query string.

### Background workers

Started from `server.js` after `listen()`, gated by `ENABLE_BACKGROUND_WORKERS`: email
queue, IMAP lead ingestion (`services/leadEmailIdleService.js`, persistent IDLE
connection), dispatch SLA cron, BlueDart AWB sync, and the billing scheduler
(`BILLING_CRON_ENABLED`, default off). ERP inventory sync workers exist but are commented
out.

All of these run **in-process with no leader election**, which is safe only because PM2 is
pinned to `instances: 1, exec_mode: 'fork'` (`backend/ecosystem.config.cjs`). Do not raise
the instance count without adding advisory locks. Socket.IO (`backend/socket/`) shares the
same process and joins `dispatch-user-${user_id}` / `dispatch-admin` rooms.

### Frontend layout

`frontend/src/features/<domain>/` holds the modern per-domain pages and components (18
domains: `sales-pipeline`, `floor-pipeline`, `inventory-management`, `vendor-management`,
`support`, `lead-crm`, `customer-billing`, `guard-gate`, …). `src/components/` and
`src/pages/` hold older screens that have not been migrated; `*.legacy.jsx` files are
unreferenced. Routes are composed from `src/routes/*Routes.jsx` into
`src/routes/index.jsx`. `src/utils/api.js` is the shared axios instance — it resolves the
API base from `REACT_APP_API_URL`, falling back to same-origin `/api` in production, and
attaches the bearer token from `src/utils/authToken.js` (`sessionStorage` wins over
`localStorage` so impersonation tabs don't clobber the admin's session).

## Deploy

`.github/workflows/deploy.yml` deploys on push: `support_revemp` → staging VPS,
`new_crm_rentfoxxy` → production VPS. It does `git reset --hard`, `npm install`, builds all
three React apps **on the target VPS**, then `pm2 restart`. It runs no migrations, no tests
and no health check, and there is no rollback. `deploy/CI_CD_SETUP.md` documents the
GitHub Environment secrets. (`.cursor/rules/deploy-workflow.mdc` points at
`deploy/DEPLOY_STEP_BY_STEP.md` and `deploy/DEPLOY_WORKFLOW.md`; neither file exists.)

`master` is ~567 commits behind the production branch and is not used.

## Migration toolkit

`migration/` moves ERP (MySQL/Laravel) data into the CRM additively. Its central rule, from
`migration/README.md`: **never truncate or overwrite auth, RBAC or system configuration** —
`users`, `roles`, `role_permissions`, `user_permissions`, `teams`, `permission_sections`,
`schema_migrations`, `stages`, `asset_config_*`, `companies` and `leads` are protected.
ERP admins are matched by email into `erp_id_map`; existing CRM users never have their
roles, permissions or passwords reset.
