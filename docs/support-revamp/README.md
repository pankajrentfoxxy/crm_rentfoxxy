# Support revamp — design docs

The build lives on `support-revamp` (local/remote: `support_revamp`) and is assembled
phase by phase. Live `/support/*` stays untouched until Phase 11.

## Source of truth

- `00_MASTER_CONTEXT.md` — house rules (also `.cursor/rules/support-revamp.md`)
- `support-revamp-prompts/PHASE_NN_*.md` — one prompt per phase
- `SUPPORT_REVAMP_PLAN.md` and `support-ui-mockup.html` — add these here when available.
  They were not in the repo at Phase 0.

## Route during build

New module: `/support-v2/*`  
Legacy module: `/support/*`
