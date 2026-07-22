# ERP → CRM Migration Toolkit

Migrate production data from **ERP (MySQL/Laravel)** into **CRM (PostgreSQL/Node.js)**.

## Critical: Data preservation

**Never truncate or overwrite auth, RBAC, or system configuration.**

| Document | Contents |
| --- | --- |
| [`AUTH_TABLES.md`](./AUTH_TABLES.md) | Auth schema, RBAC, portal sessions, additive ERP admin rules |
| [`SYSTEM_TABLES.md`](./SYSTEM_TABLES.md) | Config, stages, asset catalog, sequences, CRM-native modules |
| [`PRE_MIGRATION_REVIEW.md`](./PRE_MIGRATION_REVIEW.md) | Sign-off checklist before running migration |

### Protected (preserve as-is)

- `auth.*` (21 tables)
- `users`, `roles`, `role_permissions`, `user_permissions`, `teams`, `user_teams`, `permission_sections`
- `schema_migrations`, `stages`, `asset_config_*`, `support_settings`, `companies`, `leads` (+ lead_*)

### Business data (migrate additively)

Customers, vendors, inventory, serials, POs, GRNs, sales orders, delivery challans, support tickets, QC results, billing documents, allocation logs, etc.

### ERP admins

- Match by email → `erp_id_map` only for existing CRM users
- Insert new CRM users only when email not found
- **Never** reset roles, permissions, or passwords on existing CRM users

---

## Documentation

1. [`PRE_MIGRATION_REVIEW.md`](./PRE_MIGRATION_REVIEW.md) — sign-off required
2. [`ERP_SCHEMA_ANALYSIS.md`](./ERP_SCHEMA_ANALYSIS.md)
3. [`CRM_SCHEMA_ANALYSIS.md`](./CRM_SCHEMA_ANALYSIS.md)
4. [`SCHEMA_MAPPING.md`](./SCHEMA_MAPPING.md)
5. [`MIGRATION_ORDER.md`](./MIGRATION_ORDER.md)
6. [`CRM_GAP_ANALYSIS.md`](./CRM_GAP_ANALYSIS.md)
7. [`ROLLBACK_PLAN.md`](./ROLLBACK_PLAN.md)

## Commands

```bash
cd migration
npm install
npm run extract          # regenerate analysis from SQL dumps

node validate-migration.js --baseline   # BEFORE migration (includes RBAC counts)
node migrate-all.js --dry-run           # list modules
# Set MIGRATION_APPROVED=true in .env after sign-off
node migrate-all.js
node validate-migration.js              # AFTER migration
```

## Module status

| Module | Status |
| --- | --- |
| `000_migration_meta` | Ready |
| `002_erp_admin_users_additive` | Stub — additive only per AUTH_TABLES.md |
| `001_roles`, `003_teams` | **Removed** — RBAC preserved |
| `004`–`030` business modules | Stubs pending sign-off |

Guard rails: `migration/lib/preserve.js`
