# RENTFOXXY CRM — REFACTOR: PRODUCTION ASSET + QC1/QC2 + PENDING INVENTORY

**Repo:** `github.com/pankajrentfoxxy/crm_rentfoxxy` · **Branch:** `new_crm_rentfoxxy`
**Rule #1: do NOT break the existing production flow.** Everything here is additive and backward-compatible. The current pipeline works — we are formalizing config into a Production Asset, tightening QC1/QC2, and inserting a controlled Pending Inventory stage before final receipt.

Current (keep working): `PO → GRN → GRN Accepted → Floor Ticket → Diagnosis → Assembly & Software → Final Testing → QC1 → QC2 → Inventory`
Target: `… → GRN Accepted → **Production Asset created** → Floor Ticket → … → QC1 (checklist) → QC2 (GRN-acceptance-style spec verify) → QC2 Testing → **Pending Inventory** → **Serial verify on Receive** → Inventory`

---

## 0. GROUND TRUTH — REVIEW & REUSE (confirmed in code, do not re-create)

- **Floor pipeline is stage-based**, not hardcoded: `stages` table (`stage_id, stage_name, stage_order, team_id`). Tickets move through stages via `services/grnTicketService.js` and `services/qcManagementService.js`. → **Add "Pending Inventory" as a stage/status, do not hardcode a branch.**
- **GRN-acceptance spec verification already exists**: `services/grnReceivedConfigService.js` extracts + compares `brand, model, processor, generation, ram, storage(ssd), gpu, screen_size` (prefers GRN capture `actual_config`, then VPD, then PO line). → **Reuse this for QC2 verification.**
- **Config-edit UI already exists**: `frontend/src/features/floor-pipeline/components/ConfigUpdateModal.jsx` ("Update laptop config" / "Save config"). → **Reuse it, but point its writes at `production_assets` (not GRN).**
- **Asset & identifiers**: `vendor_serial_numbers` (serial, `inventory_asset_code`/TTSPL, `product_detail_id`, `actual_config`). Floor tickets already carry `ttspl` + `serial_number` (migration 056). GRN captured config: `grn_serial_capture_tokens.actual_config`.
- **Inventory authority**: `services/inventoryStateMachine.js → transitionAsset()`. `in_stock` = "QC-passed, available". Allowed transitions defined there — **every inventory move must go through it**, never a direct status write.
- **Rework paths exist**: `Qc1ReworkAssignModal.jsx`, `HwReworkAssignModal.jsx`, QC-fail flows — reuse for QC2-fail return-to-stage.

---

## 1. PRODUCTION ASSET TABLE (working copy; GRN stays immutable)

### 1a. Migration `NNN_production_assets.sql`
```sql
CREATE TABLE IF NOT EXISTS production_assets (
  production_asset_id  SERIAL PRIMARY KEY,
  grn_id               INT NOT NULL,            -- source GRN (immutable reference)
  grn_line_id          INT,                     -- source GRN line / product_detail_id
  po_id                INT,
  serial_number        VARCHAR(120),
  ttspl_id             VARCHAR(60),             -- inventory_asset_code / TTSPL
  vendor_serial_id     INT,                     -- FK-style link to vendor_serial_numbers
  -- WORKING config (mutable during production):
  brand         VARCHAR(120),
  model         VARCHAR(160),
  processor     VARCHAR(160),
  generation    VARCHAR(80),
  ram           VARCHAR(80),
  ssd           VARCHAR(80),                    -- storage
  gpu           VARCHAR(120),
  screen_size   VARCHAR(60),
  -- ORIGINAL GRN config snapshot (immutable copy for compare/audit):
  grn_config    JSONB,                          -- exact accepted GRN config at creation
  status        VARCHAR(40) DEFAULT 'in_production',  -- in_production, qc1_passed, qc2_verifying, qc2_passed, pending_inventory, received, qc2_failed
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prod_asset_grn ON production_assets(grn_id);
CREATE INDEX IF NOT EXISTS idx_prod_asset_serial ON production_assets(serial_number);
CREATE INDEX IF NOT EXISTS idx_prod_asset_ttspl ON production_assets(ttspl_id);

-- spec-change audit (ties into NR-17): every config edit during production
CREATE TABLE IF NOT EXISTS production_asset_changes (
  change_id           SERIAL PRIMARY KEY,
  production_asset_id INT NOT NULL REFERENCES production_assets(production_asset_id) ON DELETE CASCADE,
  field               VARCHAR(40) NOT NULL,     -- brand|model|processor|generation|ram|ssd|gpu|screen_size
  old_value           TEXT,
  new_value           TEXT,
  changed_by          INT,
  changed_at          TIMESTAMPTZ DEFAULT NOW(),
  stage_name          VARCHAR(80)               -- stage where the change happened
);
```
Idempotent (`IF NOT EXISTS`), safe to re-run.

### 1b. Create the Production Asset at GRN Acceptance
- On **GRN Accepted**, create one `production_assets` row per accepted unit, copying the accepted config into BOTH the working columns AND `grn_config` (the immutable snapshot). Link `grn_id`, `po_id`, `vendor_serial_id`, `serial_number`, `ttspl_id`.
- New service `services/productionAssetService.js`: `createFromGrn(grnId, ...)`, `getByTicket(...)`, `updateConfig(productionAssetId, patch, userId, stageName)` (writes working columns + logs each field diff to `production_asset_changes`), `getConfig(...)`.
- **GRN is never written to during production.** All production config edits go to `production_assets`.

### 1c. Production reads/writes the Production Asset (not GRN)
- Point the existing **`ConfigUpdateModal`** save action at `PATCH /api/production-assets/:id/config` → `updateConfig(...)`. Same UI, new target.
- Floor stages (Diagnosis, Assembly & Software, Final Testing) read config from `production_assets` for display. Keep GRN read-only.
- **Backward compat:** if a ticket has no `production_assets` row yet (legacy in-flight tickets), fall back to the current GRN/`actual_config` source so nothing breaks; add a one-time backfill to create production_assets for open floor tickets.

---

## 2. QC1 — SPECIFICATION CHECKLIST (replace header info)

- In the QC1 screen, **remove the current header information block** and instead show a **checklist** for: Brand, Model, Processor, Generation, RAM, SSD (values from the **Production Asset**).
- The QC1 technician ticks each field as verified. Persist the checklist result (e.g. `qc1_checklist JSONB` on the ticket or a `qc1_checks` table) with who/when.
- On all-checked → move the ticket to **QC2** (existing stage transition).
- Keep existing QC1 rework path (`Qc1ReworkAssignModal`) available if a field is wrong.

**Acceptance:** QC1 shows the 6-field checklist from the Production Asset; ticket only advances to QC2 when all are checked; result stored.

---

## 3. QC2 — GRN-ACCEPTANCE-STYLE SPEC VERIFICATION (before testing)

Reuse `grnReceivedConfigService.js` + the existing GRN-acceptance verify UI/pattern. Do **not** build new verify logic.

- When a ticket enters QC2, first show the **spec verification** step (same UX as GRN Acceptance): display **expected config from `production_assets`**, technician verifies each spec one-by-one (Brand, Model, Processor, Generation, RAM, SSD) against the physical laptop.
- **Only after all specs verify** does the existing **QC2 Testing** section unlock.
- **On mismatch:** mark ticket **QC2 Failed**, capture failure remarks, and return the ticket to the appropriate production stage (reuse existing QC-fail / rework return-to-stage flow). Set `production_assets.status='qc2_failed'`.
- Block QC2 Testing until verification passes.

**Acceptance:** QC2 testing is gated behind a GRN-acceptance-style spec verify against the Production Asset; any mismatch → QC2 Failed with remarks + return to stage; verification reuses `grnReceivedConfigService`.

---

## 4. PENDING INVENTORY STAGE + CONTROLLED RECEIVE

### 4a. New stage/status "Pending Inventory"
- Add **Pending Inventory** to the `stages` flow (insert stage row with correct `stage_order` between QC2 and Inventory) — do not hardcode.
- On **QC2 Pass** (after testing), the unit moves to **Pending Inventory**, NOT directly to Inventory. Set `production_assets.status='pending_inventory'`. **Do not** call `transitionAsset → in_stock` yet.

### 4b. New Production menu + page: "Pending Inventory"
- Add a **Pending Inventory** page under the Production/floor menu listing units awaiting receipt, showing: Ticket ID, TTSPL, Configuration (from Production Asset), QC2 Completed By, QC2 Completed Time, Status.

### 4c. Receive into Inventory (Inventory/Admin only, serial-verified)
- Add a **Receive** button (visible only to Inventory/Admin roles — gate via existing RBAC permission section, e.g. `inventory_management`/admin).
- Clicking opens a popup asking for **Serial Number**.
- Validate entered serial against the **Production Asset serial_number**:
  - **Match** → mark received: store `received_by`, `received_time`; set `production_assets.status='received'`; then move the asset to Inventory via `inventoryStateMachine.transitionAsset(... in_stock ...)` using the **latest Production Asset config** (inventory reflects production changes, not the original GRN).
  - **No match** → show an error, do not receive.
- Endpoint: `POST /api/production-assets/:id/receive` `{ serial_number }` → verify + transition, all in one transaction.

**Acceptance:** QC2-pass lands in Pending Inventory (not Inventory); only Inventory/Admin sees Receive; correct serial → asset enters `in_stock` with the latest Production Asset config and received_by/time stored; wrong serial → blocked with error.

---

## EXPECTED FLOW (final)
```
PO → GRN → GRN Accepted → [Production Asset created]
  → Floor Ticket → Diagnosis → Assembly & Software → Final Testing
  → QC1 (spec checklist) → QC2 (GRN-acceptance-style spec verify) → QC2 Testing
  → Pending Inventory → (Receive: serial verify) → Inventory
```

## DELIVERABLES
- [ ] `NNN_production_assets.sql` (+ `production_asset_changes`) — idempotent.
- [ ] `productionAssetService.js` + create-at-GRN-acceptance hook + open-ticket backfill.
- [ ] `ConfigUpdateModal` repointed to `production_assets`; floor stages read from Production Asset; GRN untouched.
- [ ] QC1 checklist (6 fields) replacing header info; advance-on-all-checked.
- [ ] QC2 spec-verify gate reusing `grnReceivedConfigService` + GRN-acceptance UI; QC2-fail → remarks + return-to-stage.
- [ ] "Pending Inventory" stage + Production menu page (Ticket ID, TTSPL, Config, QC2 By/Time, Status).
- [ ] Receive flow (Inventory/Admin only) with serial verification → `transitionAsset(in_stock)` + received_by/time.

## CONSTRAINTS
- Additive & backward compatible; do not change existing workflow or modify current APIs unless required.
- GRN is the immutable vendor document — never written to during production.
- Production Asset is the working copy; Inventory always uses the **latest** Production Asset config.
- All inventory status changes go through `inventoryStateMachine.transitionAsset()` — no direct writes.
- Reuse existing stages table, `grnReceivedConfigService`, `ConfigUpdateModal`, and QC-fail/rework flows rather than duplicating.
- Legacy in-flight tickets without a Production Asset must keep working (GRN/actual_config fallback + backfill).
- Migrations idempotent; protected ERP/auth/RBAC tables untouched.
```
