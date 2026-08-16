# Support v2 migration — reconciliation

This file is overwritten by:

```bash
cd backend
node scripts/migrate-support-to-v2.js --dry-run
```

Run that after migrations 201–203 are applied on Docker. `--apply` is refused while any LOW-confidence pickup is unreviewed (`node scripts/review-migration-lows.js --list`).
