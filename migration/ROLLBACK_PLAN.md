# Rollback Plan

> Generated: 2026-06-23T17:26:39.533Z

## Before Migration

1. **Full CRM backup**
2. **Capture RBAC baseline** — `node validate-migration.js --baseline` (users, roles, permissions, teams counts)
3. **Read** `AUTH_TABLES.md` and `SYSTEM_TABLES.md` — do not truncate listed tables
4. **Snapshot ERP** — keep `erp_rentfoxxy_db.sql` immutable

## Rollback Steps

| Scenario | Action |
| --- | --- |
| Migration failed mid-module | Roll back **business tables only** via `erp_id_map`; never truncate auth/RBAC/config |
| Validation failed after full run | Restore `pg_dump` backup entirely |
| Partial data corruption | Use `erp_id_map` to DELETE migrated rows by `erp_source_table` |

## Per-Module Rollback SQL Pattern

```sql
-- Example: rollback ONLY users inserted by migration (not pre-existing CRM users)
DELETE FROM users WHERE user_id IN (
  SELECT crm_id FROM erp_id_map
  WHERE entity = 'users' AND migrated_at >= :migration_start_time
);
-- Never DELETE FROM roles, role_permissions, user_permissions, teams, user_teams
```

## Recovery Process

1. Stop CRM application
2. Restore database from pre-migration dump OR run module rollback scripts
3. Clear Redis/cache if used
4. Verify with `validate-migration.js --baseline`
5. Restart application

## Re-run Process

Migration scripts are **idempotent**:
- Upsert on `(entity, erp_id)` in `erp_id_map`
- Skip rows already mapped
- `migrate-all.js` reads `migration_runs` checkpoint table

## Backup Retention

- Keep pre-migration dump for **30 days** minimum
- Keep ERP SQL dump permanently as source of truth
