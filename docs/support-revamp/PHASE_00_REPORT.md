# Phase 00 report — Foundation

Branch: `support-revamp/phase-00`  
Base: `support_revamp` (replica of live `new_crm_rentfoxxy`)  
Legacy `/support/*` and `supportController.js` were not edited.

## Migration numbers

The phase prompt asked for `192_support_v2_rbac.sql` and `193_support_v2_sequences.sql`.  
Those numbers already exist on this branch (`192_auth_credentials.sql` … `196_scrap_challan.sql`).

Phase 00 uses:

| File | Purpose |
|---|---|
| `backend/migrations/197_support_v2_rbac.sql` | 20 sections, role matrix, new roles, grandfathering |
| `backend/migrations/198_support_v2_sequences.sql` | `STK-` / `WO-` sequences |

Both are idempotent (`ON CONFLICT` / `IF NOT EXISTS`).

## Permission sections created

Sort 300–319:

1. `support_tickets` — Ticket queue & detail  
2. `support_dashboard` — Command centre  
3. `support_triage` — Triage & classification  
4. `support_work_orders` — Work orders (all types)  
5. `support_pickup_repair` — Repair pickup & service return  
6. `support_pickup_return` — Return pickup  
7. `support_replacement` — Replacement  
8. `support_field_visit` — Field visit & remote fix  
9. `support_parts_request` — Raise part requests  
10. `support_parts_approve` — Approve & issue parts (warehouse)  
11. `support_bucket` — My technician bucket  
12. `support_dispatch` — Dispatch board & assignment  
13. `support_approvals` — Approvals inbox  
14. `support_charges` — Chargeable lines & liability  
15. `support_sla_admin` — SLA policies & calendars  
16. `support_taxonomy` — Issue taxonomy & codes  
17. `support_groups` — Groups, zones, skills, shifts  
18. `support_reports` — Reports & breach register  
19. `support_settings` — Module settings & templates  
20. `support_customer_portal` — Customer portal administration  

These appear under **Settings → Role Permissions → Support** (pink group), plus the legacy `support_technician` row kept until Phase 11.

## Role matrix applied (MASTER §7.1)

`V` view · `C` create · `E` edit · `D` delete. Blank = no row.

| Section | super_admin | admin | support_manager | support_lead | support_agent | support_tech | warehouse | dispatch | accounts |
|---|---|---|---|---|---|---|---|---|---|
| support_tickets | VCED | VCED | VCED | VCED | VCE | — | V | V | V |
| support_dashboard | V | V | V | V | V | — | — | V | — |
| support_triage | VE | VE | VE | VE | V | — | — | — | — |
| support_work_orders | VCED | VCED | VCED | VCED | V | V | V | VCE | — |
| support_pickup_repair | VCED | VCED | VCED | VCE | V | VE | VE | VE | — |
| support_pickup_return | VCED | VCED | VCED | VCE | V | VE | VE | VE | — |
| support_replacement | VCED | VCED | VCED | VC | V | VE | V | VE | — |
| support_field_visit | VCED | VCED | VCED | VCE | VC | VE | — | VE | — |
| support_parts_request | VCED | VCED | VCE | VCE | VC | VC | VCE | — | — |
| support_parts_approve | VE | VE | VE | VE | — | — | VE | — | — |
| support_bucket | VE | VE | V | V | — | VE | VE | V | — |
| support_dispatch | VE | VE | VE | VE | — | — | — | VE | — |
| support_approvals | VE | VE | VE | VE | — | — | — | — | V |
| support_charges | VCE | VCE | VCE | VC | — | C (no view) | — | — | VE |
| support_sla_admin | VCED | VCED | VE | V | — | — | — | — | — |
| support_taxonomy | VCED | VCED | VCE | V | V | V | V | V | — |
| support_groups | VCED | VCED | VCE | V | — | — | — | V | — |
| support_reports | V | V | V | V | V | — | — | V | V |
| support_settings | VE | VE | V | — | — | — | — | — | — |
| support_customer_portal | VE | VE | VE | V | — | — | — | — | — |

New roles: `support_agent`, `support_manager` (users.role CHECK widened from `103_dispatch_qc_role.sql` + these two).

Grandfather: existing `user_permissions` with `support_tickets` view also get view on dashboard, triage, work orders, pickup/repair, pickup/return, replacement, field visit, reports.

**Note:** existing `support_tech` rows that already have `support_tickets` (legacy module) are **not** deleted, so the old `/support/*` module still works for technicians. A tech created only from the new matrix (no leftover `support_tickets` grant) cannot open `/support-v2/queue`.

## Files added

- `.cursor/rules/support-revamp.md`
- `docs/support-revamp/00_MASTER_CONTEXT.md`
- `docs/support-revamp/README.md`
- `docs/support-revamp/PHASE_00_REPORT.md`
- `backend/migrations/197_support_v2_rbac.sql`
- `backend/migrations/198_support_v2_sequences.sql`
- `backend/controllers/supportV2Controller.js`
- `backend/routes/supportV2.js`
- `backend/scripts/seed-support-demo.js`
- `backend/test/support-v2-phase0.test.js`
- `frontend/src/components/ui/supportPrimitives.jsx`
- `frontend/src/features/support-v2/*`
- `frontend/src/routes/supportV2Routes.jsx`

## Files changed

- `backend/server.js` — mount `/api/support/v2`
- `backend/controllers/authController.js` — new roles in create/edit dropdown
- `backend/services/roleDefaultsSeed.js` — new roles + v2 sections on existing support/warehouse/dispatch/accounts
- `frontend/tailwind.config.js` — MASTER §6 tokens
- `frontend/src/constants/sections.js` — 20 keys, labels, Support group
- `frontend/src/constants/roles.js` — `support_agent`, `support_manager`
- `frontend/src/config/menuConfig.js` — **Support (new)** → `/support-v2` (old Support items kept)
- `frontend/src/routes/index.jsx` — spread `supportV2Routes`
- `frontend/src/components/ui/RoleBadge.jsx`
- `frontend/src/utils/permissionHelper.js`

`SUPPORT_REVAMP_PLAN.md` and `support-ui-mockup.html` were not in the repo; add them to `docs/support-revamp/` when available.

## Verification run (16 Aug 2026)

| Check | Result |
|---|---|
| `cd backend && npm test` | Green. Phase 0 DB assertions skipped (`ECONNRESET` — configured Postgres not reachable from this machine). |
| `cd frontend && npm run build` | Compiled. No new warnings from support-v2 files. Existing unused-import warnings elsewhere unchanged. |
| `node scripts/run-all-migrations.js` | Not applied here — DB proxy reset the connection; local Docker Postgres on 5433 is not running. |
| `npm run prisma:sync` / `check:prisma-drift` | Deferred until 197/198 are applied on a reference DB, then pull. Marker is still absent (`0`); latest file number is **198**. |

Run migrations on your usual local/dev database before clicking through Role Permissions and `/support-v2`.

## How to check locally

1. `cd backend && node scripts/run-all-migrations.js` — expect `APPLIED 197_…` and `APPLIED 198_…`. Re-run should skip.
2. Sidebar **Support (new)** opens `/support-v2` inside the normal CRM layout. Sub-nav groups: Work / Create / Field / Manage.
3. Placeholders show their S-number. Design tokens: `/support-v2/foundation` (also **Manage → Design system** if you have `support_settings`).
4. Role Permissions: all 20 `Support — …` rows under the Support group.
5. `support_tech` can open `/support-v2/bucket`; `/support-v2/dispatch` redirects away. Queue depends on whether they still have legacy `support_tickets`.
6. Warehouse user with only `support_parts_approve` view: sidebar still shows Support (new); sub-nav is **Parts queue** only. Untick it → bounced from `/support-v2`.
7. `GET /api/support/v2/badges` → 200 with any of dashboard/tickets/bucket/dispatch; 403 otherwise.
8. Old `/support/*` unchanged.
9. Demo users (refuses unless `ALLOW_DEMO_SEED=true`):  
   `demo.support.{agent,lead,tech,manager}@rentfoxxy.local` / `DemoSupport!23`

## Visual check (no screenshot in this file)

Open `/support-v2/foundation` as admin/super_admin:

- P1 crimson, P2 orange, P3 gold, P4 slate
- SlaChip countdown + depleting bar; `‖ paused` in grey
- Modal closes on Escape, backdrop, and X
