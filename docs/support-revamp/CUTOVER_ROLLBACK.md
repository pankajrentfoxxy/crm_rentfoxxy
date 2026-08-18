# Cutover rollback

Rehearse this on staging before production.

| When | Action |
|---|---|
| Dual run (`SUPPORT_LEGACY_WRITES=true`, team on `/support`) | Tell the team to use `/support-legacy` if needed. No data loss. |
| After the route swap, within 24 h | Revert the frontend route commit. Tickets created in v2 stay in v2 — export `SELECT ticket_id, ticket_number FROM support_tickets_v2 WHERE created_at >= :cutover`. |
| After the 410 freeze | Set `SUPPORT_LEGACY_WRITES=true` to reopen old writes. Restore a snapshot **only** if data is corrupted. Prefer fix-forward. |
| After table rename (not in this phase) | No rollback. That step is 30 clean days later, separate PR. |

## Staging rehearsal

1. Snapshot the DB.
2. Apply migrations 197–212.
3. `node scripts/migrate-support-to-v2.js --dry-run` then `--apply`.
4. `BILLING_READ_SUPPORT_HOOKS=true node scripts/reconcile-billing-hooks.js --month YYYY-MM` — zero unexplained delta.
5. Swap confirmed: `/support` is v2, `/support-legacy` is old, writes 410.
6. Restore the snapshot once to prove the backup.

## Production snapshot

Take a snapshot and test restore **before** enabling `BILLING_READ_SUPPORT_HOOKS` or freezing writes. Do not run `seed-support-demo.js` on production.
