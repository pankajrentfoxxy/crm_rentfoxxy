# SQL Safety Guidelines

## Rule

**All user-supplied values must use `$N` parameterized placeholders.** Dynamic SQL fragments may only contain:

- Whitelisted column identifiers (via a map/object lookup)
- Whitelisted sort directions (`ASC` / `DESC`)
- Static join fragments defined in code

Never concatenate `req.query`, `req.params`, or `req.body` directly into SQL strings.

## Pattern

```javascript
const { pickSortColumn, pickSortDirection } = require('../utils/sqlSafety');

const SORT_COLUMNS = {
  customer_id: 'c.customer_id',
  updated_at: 'c.updated_at',
};
const orderBy = pickSortColumn(req.query.sort_by, SORT_COLUMNS, 'customer_id');
const orderDir = pickSortDirection(req.query.sort_dir);

await pool.query(
  `SELECT * FROM customers c WHERE c.status = 1 ORDER BY ${orderBy} ${orderDir} LIMIT $1 OFFSET $2`,
  [limit, offset]
);
```

## Audit summary (controllers + services)

| Area | Dynamic fragment | User value handling | Status |
|------|------------------|---------------------|--------|
| `customerManagementController` | `ORDER BY ${orderBy}` | Allowlist `SORT_COLUMNS` | OK |
| `customerBillingController` | `WHERE ${where.join}` | All values via `$N` params | OK |
| `vendorBillingController` | `WHERE ${whereSql}` | Search uses `$N` ILIKE param | OK |
| `partRequestController` | `WHERE` clauses | Built from param array | OK |
| `inventoryController` | `WHERE ${whereClause}` | Filters use `$N` params | OK |
| `vendorManagement/*` | `WHERE ${where}` | Filters use `$N` params | OK |
| `reportsController` | `WHERE ${whereSql}` | Filters use `$N` params | OK |

## Helpers

Use `backend/utils/sqlSafety.js`:

- `pickSortColumn(raw, allowlist, fallback)`
- `pickSortDirection(raw)` → `ASC` or `DESC`
- `buildWhereAnd(params, conditions)`

## Adding new list endpoints

1. Build `WHERE` clauses as strings with `$N` placeholders; push values into a `params` array.
2. Map `sort_by` through an allowlist object — never pass the raw query string.
3. Code review: grep for `` `${ `` inside `pool.query(` / `client.query(` calls.

## Migrations

SQL migrations remain the **source of truth** for schema. See `backend/docs/PRISMA_OWNERSHIP.md`.
