# RENTFOXXY CRM — QC2 SCRIPT-BASED CONFIG VERIFICATION (reuse GRN capture flow)

**Repo:** `github.com/pankajrentfoxxy/crm_rentfoxxy` · **Branch:** `new_crm_rentfoxxy`
**Context:** In QC2 (e.g. ticket `/floor-pipeline/tickets/1748`) we do NOT want to mark specs manually. Reuse the existing **GRN serial-capture** mechanism: generate an **access number** in QC2, enter it on a **config-match route** to reveal the hardware-reading script, the technician runs the script on the physical laptop, it reads the actual specs and hits the API, which verifies them against the **Production Asset** config and auto-marks the QC2 spec match — exactly like the GRN Received flow.

> This refines **Part 3** of the Production Asset refactor: it REPLACES the "verify each spec manually" step with this script-based auto-verification. Everything else in that refactor (Production Asset table, QC2 gate before testing, QC2 Fail → remarks → return-to-stage) stays.

---

## 0. GROUND TRUTH — REUSE (confirmed in code, do not rebuild)

- **Token + script**: `services/grnSerialCaptureService.js → createCaptureToken()` mints a UUID token in `grn_serial_capture_tokens` (TTL, status pending→done) and the capture page renders a base64 `EncodedCommand` PowerShell (+ macOS) one-liner.
- **Public capture endpoints** (`routes/grnCapturePublic.js`):
  - `GET /api/grn-capture/:token` — session + expected config + script
  - `POST /api/grn-capture/:token/verify-configuration` — body = detected config → runs comparison
  - `POST /api/grn-capture/:token` — body = serial_number → marks done
- **Comparison core**: `services/grnConfigService.js → compareConfig(expected, actual)` returns `{ configurationMatched, checks:[{field,label,matched,required,expected,actual}], errors:[] }`. Blocking fields: brand, model, processor, generation, ram (exact), ssd (±10%). Tolerant normalization (`processorsMatch`, `modelsMatch`, gen/ram/ssd numeric). **Reuse this as-is** — just feed it Production Asset config as `expected`.
- **Capture UI**: `frontend/src/pages/GrnSerialCapturePage.jsx` (expected-config card + "Download Windows script" + PowerShell/macOS one-liners). Reuse its layout for the QC2 config-match page.
- **Production Asset** (from the refactor): `production_assets` holds the working config (brand, model, processor, generation, ram, ssd, gpu) + serial + ttspl. This is the QC2 source of truth.

--- 

## 1. QC2 ACCESS NUMBER + TOKEN (generated on the QC2 screen)

- Add a `qc2_capture_tokens` table (mirror `grn_serial_capture_tokens`, but keyed to production/QC2 context):
  ```sql
  CREATE TABLE IF NOT EXISTS qc2_capture_tokens (
    token_id            UUID PRIMARY KEY,
    access_number       VARCHAR(8) NOT NULL,     -- short human-enterable code (e.g. 6 digits)
    ticket_id           INT NOT NULL,
    production_asset_id  INT NOT NULL,
    status              VARCHAR(20) DEFAULT 'pending',  -- pending, matched, failed, expired
    actual_config       JSONB,                    -- last detected config from the script
    match_result        JSONB,                    -- compareConfig() checks/errors
    verified_by_ip      VARCHAR(64),
    created_by          INT,
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    matched_at          TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_qc2_token_access_active
    ON qc2_capture_tokens(access_number) WHERE status = 'pending';
  ```
- New service `services/qc2CaptureService.js` (mirror `grnSerialCaptureService`):
  - `createQc2Token({ ticketId, productionAssetId, createdBy })` → generate `token_id` (UUID) + a unique 6-digit `access_number`, TTL (e.g. 30 min), return `{ token, access_number, expires_at }`.
  - Reuse the SAME script/`EncodedCommand` builder, only swap the API path to `/api/qc2-capture/:token/verify-configuration` (and optional serial POST to `/api/qc2-capture/:token`).
- **QC2 screen**: add a "Generate access number for hardware verification" action. It calls `POST /api/qc2/tickets/:ticketId/capture-token` → shows the access number to the technician. (No script shown here — only the number.)

---

## 2. CONFIG-MATCH ROUTE (enter access number → reveal script)

- New route/page (reuse `GrnSerialCapturePage` layout): e.g. `/qc2-config-match`.
- On load, show a **popup: "Enter access number"**.
- `POST /api/qc2-capture/resolve` `{ access_number }`:
  - look up a `pending`, non-expired token by `access_number`
  - **match** → return the session: expected config (from `production_assets`), the download script + PowerShell/macOS one-liners (pointing at this token's verify endpoint)
  - **no match / expired** → error, do not reveal script
- After a valid access number, the page renders exactly like the GRN capture page: EXPECTED CONFIGURATION (from Production Asset) + "Download Windows script" + copy one-liners.

---

## 3. SCRIPT → VERIFY ENDPOINT (auto-mark, no manual ticking)

- `POST /api/qc2-capture/:token/verify-configuration` (mirror the GRN verify handler):
  - validate token is `pending` + not expired
  - `actual` = detected config from the script body
  - **expected** = the `production_assets` config for this token → call `grnConfigService.compareConfig(expectedFromProductionAsset, actual)` (reuse; add a thin wrapper `verifyConfigurationAgainst(expected, actual)` if the current `verifyConfiguration` only resolves expected from a GRN token)
  - store `actual_config` + `match_result` on the token
  - **configurationMatched === true** →
    - set token `status='matched'`, `matched_at`
    - **mark the QC2 spec-verification PASSED for the ticket** (the same flag the refactor's QC2 gate checks) → this unlocks **QC2 Testing**. No manual marking.
    - (optional) accept the serial POST `/api/qc2-capture/:token` and verify it against `production_assets.serial_number` (ties into NR-16/NR-18 serial verification).
  - **configurationMatched === false** →
    - set token `status='failed'`
    - mark the ticket **QC2 Failed**, attach the field-level `errors[]` as remarks, and return the ticket to the appropriate production stage (reuse existing QC-fail / rework return-to-stage flow)
- The script's console output already prints per-field `expected vs found` on mismatch (same as GRN) — keep that behavior.

---

## 4. QC2 SCREEN WIRING

- QC2 spec-verification section shows: current token status (Pending / Matched / Failed), the access number (while pending), and — once `matched` — the green "verified" state that unlocks **QC2 Testing**.
- On `failed`, show the mismatch details and the QC2-Failed action (remarks + return to stage), consistent with existing QC-fail UX.
- Manual marking is removed from QC2 spec verification; it is driven solely by the script result. (Keep an admin override only if one already exists elsewhere — do not add a new bypass.)

---

## DELIVERABLES
- [ ] `qc2_capture_tokens` migration (idempotent).
- [ ] `qc2CaptureService.js` — `createQc2Token`, access-number generation, reused script/EncodedCommand builder pointed at qc2-capture endpoints.
- [ ] Endpoints: `POST /api/qc2/tickets/:id/capture-token`, `POST /api/qc2-capture/resolve`, `GET /api/qc2-capture/:token`, `POST /api/qc2-capture/:token/verify-configuration`, (optional) `POST /api/qc2-capture/:token`.
- [ ] `verifyConfigurationAgainst(expected, actual)` wrapper reusing `compareConfig` with Production Asset config as expected.
- [ ] Config-match page (reuse `GrnSerialCapturePage` layout) with access-number popup.
- [ ] QC2 screen: generate access number, show status, auto-unlock testing on match, QC2-Fail on mismatch.

## CONSTRAINTS
- Reuse `grnConfigService.compareConfig`, the `createCaptureToken` script/EncodedCommand builder, and `GrnSerialCapturePage` — do NOT duplicate config-comparison or script-generation logic.
- Expected config for QC2 comes from **`production_assets`** (working copy), never the raw GRN.
- No manual spec marking in QC2 — the script result is authoritative; mismatch → QC2 Failed + remarks + return-to-stage.
- Additive & backward compatible; the GRN capture flow is untouched.
- Tokens expire; access numbers unique among pending tokens; all verify writes in a transaction.
- Serial verification (if included) checks against `production_assets.serial_number` (shared with NR-16/NR-18).
