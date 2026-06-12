# Local PostgreSQL — DBeaver connection

## Database name

`rentfoxxy_crm_local` (full CRM schema from `schema.sql` + Phase 1 vendor changes)

## Create / refresh the database

From the project root:

```bash
node database/setup_local_database.js
```

This reads `schema.sql` (public tables only), applies `database/phase1_schema_patch.sql`, and seeds an admin user.

## DBeaver settings

| Field | Value |
|-------|--------|
| Host | `127.0.0.1` |
| Port | `5432` |
| Database | `rentfoxxy_crm_local` |
| Username | `rentfoxxyb2b` (or your local Postgres user) |
| Password | From `backend/.env` → `DB_PASSWORD` |

Driver: **PostgreSQL**

## Backend `.env`

Point the API at the same database:

```
DB_NAME=rentfoxxy_crm_local
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=rentfoxxyb2b
DB_PASSWORD=<your password>
```

Restart backend after changing `.env`.

## CRM login (after seed)

- Email: `admin@rentfoxxy.com`
- Password: `admin123`

## Key vendor tables (Phase 1)

| Table | Purpose |
|-------|---------|
| `vendors` | Vendor master (+ portal columns) |
| `vendor_purchase_orders` | POs (+ approval workflow columns) |
| `vendor_goods_received_notes` | GRNs (+ `bill_status`, `bill_name`) |
| `vendor_serial_numbers` | Received laptops / TTSPL |
| `vendor_monthly_bills` | Monthly vendor billing |
| `vendor_debit_notes` | Debit note adjustments |
| `vendor_portal_sessions` | Vendor portal JWT sessions |

## Schema files

| File | Description |
|------|-------------|
| `schema.sql` | Full production-style dump (all schemas) + Phase 1 appended |
| `database/phase1_schema_patch.sql` | Phase 1 only (052–055) — safe to re-run |
| `backend/migrations/*.sql` | Incremental migrations used at runtime |
