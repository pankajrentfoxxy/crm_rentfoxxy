# Builder brief — read fully before touching anything (29 Sep 2026)

You are one of six parallel builders finishing the new UI ("Carret") of this CRM. Plan and slice ownership:
`claude/carret-remaining-build.md`. Project rules: `CLAUDE.md` (repo root) — especially SQL safety, schema
ownership, transitionAsset(), document numbering, GST helpers.

## Setup in your worktree (node_modules and .env are not in git)
```
ln -s /var/www/crm_new_stagging_crm/backend/node_modules backend/node_modules
ln -s /var/www/crm_new_stagging_crm/backend/.env backend/.env
ln -s /var/www/crm_new_stagging_crm/frontend/node_modules frontend/node_modules
```
The database in backend/.env is the **QA database** (not live). It still holds real test data other people use.

## Hard rules
1. Build the new screen on the EXISTING backend API. Fix the API where it is wrong. A brand-new endpoint needs
   a one-line reason in your report. Never create a second flow for the same job.
2. Every new route guard = the section(s) the API already enforces. Never widen access
   (see memory: an existing matrix section must not open a hardcoded role gate). Hide buttons the user
   cannot use (`usePermission().hasPermission(section, action)`).
3. UI = the Carret system only: `frontend/src/components/carret` (DataTable, FilterBar, Panel, Section, Tabs,
   Drawer, ConfirmDialog, Field/Input/Select/SearchSelect/Textarea, Notice, KeyValue, StatusChip, DocNumber,
   DateTime, Money, StatTile, Button, Segmented, FlowSteps, DocumentHeader), page shell `shells/DeskShell`.
   Colours only via CSS variables in `frontend/src/styles/carret.css` — **no hex / rgb literals**.
   Copy the patterns of an existing Carret page in the same area (e.g. features/carret/money/*,
   features/carret/procure/*). Long pick-lists use SearchSelect. Lists: search + filters + newest first.
   Never define a React component inside another component's body (it remounts inputs on every keystroke).
4. Money: GST via `computeGstBreakdown` / `isIntraState` (services/salesManagementService.js); numbers via
   `nextFinancialYearNumber(kind, client)` INSIDE the write transaction; row locks (`FOR UPDATE`) on anything
   paid / cancelled / approved; refuse double posting; round to 2 dp.
5. Migrations: new files only, numbered inside YOUR range (see plan), idempotent (`IF NOT EXISTS`, guarded
   `DO $$` blocks), preserve what they overwrite. Apply ONLY your own file to QA with a one-off node script
   using `backend/config/db.js` in a transaction, then insert it into `schema_migrations` the same way
   `scripts/run-all-migrations.js` records it. NEVER run `run-all-migrations.js`. Never edit an existing
   migration (several are replayed on every boot).
6. Tests: add `backend/test/<area>.test.js` (node:test) for every behaviour change; DB tests use
   `test/helpers/rollbackHarness` (see test/productionFloorForms.test.js) so nothing is left in the DB.
   Run your tests and `node --test test/<the files you touched>`.
7. Do NOT: restart pm2, run the frontend build (OOM risk — the lead builds once), edit
   `frontend/src/config/navigation.js` or `frontend/src/routes/carretRoutes.jsx`, push, or touch another
   builder's area. Put your new routes in a file `frontend/src/routes/carret/<area>Routes.jsx` exporting an
   array `{ path, section|sections, action, element }` style consistent with carretRoutes.jsx guards, and list
   the menu entries you want in your report. The lead wires both.
8. Check syntax: `node -e "require('./backend/<file>')"` for backend files; for frontend run
   `cd frontend && npx eslint --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true} --plugin react --plugin react-hooks --rule 'react-hooks/rules-of-hooks:error' --rule 'no-undef:error' --env browser,es2022 <files>`
   and fix every error.
9. Commit on your worktree branch (small, clear commits, ending with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Do not merge into new_stagging_crm.
10. Old screens stay routed (do not delete them); the new menu stops pointing at them.

## Report (your final message)
- What you built (screens, paths) and what you fixed (with file:line), decisions you had to take.
- Migrations (number, what, applied to QA yes/no), tests (names, pass/fail output).
- Exact route entries + menu entries (group, label, path, section, action) for the lead to add.
- Anything you could not finish or verify, plainly.
