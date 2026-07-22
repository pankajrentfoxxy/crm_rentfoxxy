# Prisma vs Raw SQL — Ownership Rule

## Source of truth

**Hand-written SQL migrations** under `backend/migrations/` are the authoritative schema definition.

Prisma (`backend/prisma/schema.prisma`) is a **read-model / typing mirror** only. Do not use Prisma migrations to alter production schema.

## Workflow

When you add or change a migration:

1. Apply the migration on a reference database.
2. Run `npm run prisma:sync` (wraps `prisma db pull` + updates sync marker).
3. Run `npm run check:prisma-drift` — CI uses the same script.

## Sync marker

`schema.prisma` must contain a header comment:

```
// Last synced migration: 119
```

The drift check compares this number to the highest numbered migration file in `backend/migrations/`.

## CI

`.github/workflows/ci.yml` runs `npm run check:prisma-drift` on every push/PR. Fails if the marker is behind the latest migration.

## Do not

- Run `prisma migrate deploy` against production as the primary path.
- Edit protected tables (auth, RBAC, roles, permissions, passwords, stages, asset_config, companies, leads) via Prisma push.
