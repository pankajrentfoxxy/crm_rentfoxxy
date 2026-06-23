# RENTFOXXY CRM — PHASE 16 BUILD PROMPT
## Complete Parts Management Flow
## Purchase → Inventory → Request → Approval → Attach → Config Update → Expense Tracking
### Branch: new_crm_rentfoxxy

---

## AGENT RULES — READ FIRST

- `parts` table already exists with qty, cost, category, min_threshold
- `ticket_parts` already exists with unit_cost, is_upgrade
- `part_requests` table exists in DB but is very basic — we EXTEND it
- `diagnosis_parts_required` exists — link it to part_requests
- `ttspl_config_history` already tracks config changes — continue using it
- `addPartToTicketWithConfig` endpoint already works — don't break it
- `vendor_spare_parts_purchase_orders` (SPO) already exists — extend for part requests
- Part unique ID format: `PRT-YYYYMMDD-NNNN` (e.g. PRT-20260619-0001)
  This is the INSTANCE ID of a physical part unit, distinct from `part_id`
  (which is the CATALOG ID for the type of part)
- TTSPL prefix is exclusively for laptops — never use it for parts
- Design system: same as all previous phases

---

## THE COMPLETE FLOW

```
PART PURCHASE (Procurement)
  SPO raised → approved → vendor delivers → GRN receive
  Each physical part gets: PRT-YYYYMMDD-NNNN instance ID
  Added to parts inventory: quantity++, unit_cost recorded
        ↓
TECHNICIAN FINDS ISSUE (Diagnosis / Assembly / QC1)
  Case A — Defective Part Replacement:
    Technician raises Part Request (type='replacement')
    → Selects part needed from catalog
    → Submits for Warehouse approval
  Case B — Upgrade:
    Technician raises Part Request (type='upgrade')
    → Selects part + specifies old config → new config
    → Submits for Warehouse approval
        ↓
WAREHOUSE APPROVAL
  If part IS in stock:
    Approve → mark part as reserved for this ticket
    Notify technician (in-app badge on their ticket)
  If part NOT in stock:
    Escalate to Procurement
    Procurement raises SPO for the specific part
    On receive: part linked back to original request
    Warehouse approves → notify tech
        ↓
TECHNICIAN ATTACHES PART
  Takes part from warehouse (by PRT ID or name)
  Attaches to laptop:
    - ticket_parts record created (unit_cost, is_upgrade)
    - ttspl_config_history updated (for upgrades)
    - vendor_serial_numbers.extra JSONB updated (ram, storage etc.)
    - parts.quantity decremented
    - Part instance marked as 'installed' in part_instances
  Submits OLD/DEFECTIVE part to warehouse:
    - Records old part with condition 'defective' / 'returned'
    - Optional: add defective part to parts inventory (if repairable)
        ↓
TICKET UNBLOCKED
  If part request was blocking the ticket:
    Stage action buttons reappear
    Technician can now move to next stage
        ↓
EXPENSE TRACKING (per laptop)
  Every ticket_parts row has: part_name, unit_cost, qty, is_upgrade
  ttspl_config_history has: change_type, field_name, old→new, part_cost
  Expense = vendor_po unit_price + sum(ticket_parts costs for this TTSPL)
```

---

## SECTION 1 — DATABASE MIGRATION 088

```sql
-- ============================================================
-- Migration 088: Complete Parts Management Flow
-- ============================================================

-- 1. Parts Catalog — add more fields for proper categorisation
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS part_sku          VARCHAR(100),   -- optional vendor SKU
  ADD COLUMN IF NOT EXISTS compatible_brands  TEXT[],         -- ['Dell','HP','Lenovo']
  ADD COLUMN IF NOT EXISTS compatible_models  TEXT[],         -- ['Latitude 3510','ProBook 440']
  ADD COLUMN IF NOT EXISTS is_consumable      BOOLEAN DEFAULT FALSE,  -- thermal paste, screws etc
  ADD COLUMN IF NOT EXISTS warranty_months    INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes             TEXT,
  ADD COLUMN IF NOT EXISTS archived          BOOLEAN DEFAULT FALSE;

-- 2. Part Instances — each PHYSICAL unit of a part has a unique PRT-ID
--    This separates the CATALOG (part type) from actual physical units received
CREATE TABLE IF NOT EXISTS part_instances (
  instance_id         SERIAL PRIMARY KEY,
  prt_id              VARCHAR(30) NOT NULL UNIQUE,  -- PRT-20260619-0001
  part_id             INT NOT NULL REFERENCES parts(part_id),
  spo_id              INT REFERENCES vendor_spare_parts_purchase_orders(spo_id),
  grn_id              INT,                           -- references GRN when received
  batch_number        VARCHAR(50),                   -- if vendor ships in batches
  unit_cost           NUMERIC(10,2) NOT NULL DEFAULT 0,
  status              VARCHAR(30) NOT NULL DEFAULT 'in_stock'
    CHECK (status IN (
      'in_stock',      -- available
      'reserved',      -- approved for a ticket, not yet taken
      'installed',     -- physically attached to a laptop (ttspl_id set)
      'defective',     -- returned as defective
      'returned',      -- returned to warehouse after upgrade removal
      'discarded',     -- written off
      'sold'           -- sold externally
    )),
  location_code       VARCHAR(100),
  installed_ttspl_id  VARCHAR(50),    -- set when status='installed'
  installed_ticket_id INT REFERENCES tickets(ticket_id),
  installed_at        TIMESTAMPTZ,
  removed_at          TIMESTAMPTZ,    -- set when part is removed from laptop
  condition_on_removal VARCHAR(20),   -- 'good'|'defective'|'worn'
  notes               TEXT,
  received_at         TIMESTAMPTZ DEFAULT NOW(),
  received_by         INT REFERENCES users(user_id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_part_instances_part_id ON part_instances(part_id);
CREATE INDEX IF NOT EXISTS idx_part_instances_status  ON part_instances(status);
CREATE INDEX IF NOT EXISTS idx_part_instances_ttspl   ON part_instances(installed_ttspl_id);

-- 3. Part Requests — EXTEND existing basic table
--    (existing: request_id, ticket_id, requested_by, part_name, description, status)

ALTER TABLE part_requests
  ADD COLUMN IF NOT EXISTS request_number    VARCHAR(30),          -- PRQ-0001
  ADD COLUMN IF NOT EXISTS request_type      VARCHAR(20) DEFAULT 'replacement'
    CHECK (request_type IN ('replacement', 'upgrade', 'consumable')),
  ADD COLUMN IF NOT EXISTS part_id           INT REFERENCES parts(part_id),
  ADD COLUMN IF NOT EXISTS quantity          INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stage_name        VARCHAR(100),          -- which stage raised this
  ADD COLUMN IF NOT EXISTS ticket_stage_id   INT,

  -- For upgrades: what changes
  ADD COLUMN IF NOT EXISTS config_field      VARCHAR(50),           -- 'ram'|'storage'|'display' etc
  ADD COLUMN IF NOT EXISTS old_value         VARCHAR(200),          -- '8 GB'
  ADD COLUMN IF NOT EXISTS new_value         VARCHAR(200),          -- '16 GB'

  -- Approval flow
  ADD COLUMN IF NOT EXISTS status            VARCHAR(30) DEFAULT 'pending'
    CHECK (status IN (
      'pending',          -- just raised, awaiting warehouse
      'approved',         -- warehouse approved — part reserved
      'rejected',         -- warehouse rejected (wrong part / reason)
      'escalated',        -- not in stock → sent to procurement
      'ordered',          -- procurement raised SPO for this
      'received',         -- part received from vendor
      'attached',         -- part physically installed on laptop
      'cancelled'         -- tech cancelled the request
    )),
  ADD COLUMN IF NOT EXISTS blocks_stage      BOOLEAN DEFAULT TRUE,  -- blocks next stage?
  ADD COLUMN IF NOT EXISTS approved_by       INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS approved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason  TEXT,
  ADD COLUMN IF NOT EXISTS escalated_by      INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS escalated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS spo_id            INT REFERENCES vendor_spare_parts_purchase_orders(spo_id),
  ADD COLUMN IF NOT EXISTS instance_id       INT REFERENCES part_instances(instance_id),
  ADD COLUMN IF NOT EXISTS attached_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attached_by       INT REFERENCES users(user_id),

  -- Old part return
  ADD COLUMN IF NOT EXISTS old_part_returned      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS old_part_returned_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS old_part_condition     VARCHAR(20)
    CHECK (old_part_condition IS NULL OR old_part_condition IN ('good','defective','worn')),
  ADD COLUMN IF NOT EXISTS old_part_notes         TEXT;

-- Generate request_number for existing rows
UPDATE part_requests SET request_number = 'PRQ-' || LPAD(request_id::text, 4, '0')
WHERE request_number IS NULL;

-- Add NOT NULL after backfill
ALTER TABLE part_requests ALTER COLUMN request_number SET DEFAULT 'PRQ-0000';

-- 4. Document sequence for part requests and PRT IDs
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES
  ('part_request', 0, 'PRQ-'),
  ('part_instance', 0, 'PRT-')
ON CONFLICT (doc_type) DO NOTHING;

-- 5. Part request blocking — track which tickets are blocked
CREATE TABLE IF NOT EXISTS ticket_part_blocks (
  block_id       SERIAL PRIMARY KEY,
  ticket_id      INT NOT NULL REFERENCES tickets(ticket_id),
  request_id     INT NOT NULL REFERENCES part_requests(request_id),
  blocked_at     TIMESTAMPTZ DEFAULT NOW(),
  unblocked_at   TIMESTAMPTZ,
  is_active      BOOLEAN DEFAULT TRUE,
  UNIQUE(ticket_id, request_id)
);

-- 6. Add part_request_count to tickets (denormalised for speed)
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS open_part_requests INT DEFAULT 0;

-- 7. Permission sections for parts management
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('parts_requests',    'Part Requests (Floor)',      280),
  ('parts_approval',    'Part Request Approval (Warehouse)', 281),
  ('parts_procurement', 'Parts Procurement',          282)
ON CONFLICT (section) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',       'parts_requests',    true,true,true,true),
  ('manager',     'parts_requests',    true,true,true,false),
  ('floor_manager','parts_requests',   true,true,true,false),
  ('team_member', 'parts_requests',    true,true,false,false),
  ('team_lead',   'parts_requests',    true,true,true,false),
  ('qc',          'parts_requests',    true,true,false,false),
  ('admin',       'parts_approval',    true,true,true,true),
  ('manager',     'parts_approval',    true,true,true,false),
  ('warehouse',   'parts_approval',    true,false,true,false),
  ('admin',       'parts_procurement', true,true,true,true),
  ('manager',     'parts_procurement', true,true,true,false),
  ('procurement', 'parts_procurement', true,true,true,false)
ON CONFLICT (role, section) DO NOTHING;
```

---

## SECTION 2 — PART ID GENERATION SERVICE

### Create `backend/services/partIdService.js`

```javascript
/**
 * Part ID Service
 *
 * Two types of IDs:
 *
 * 1. part_id (catalog ID)
 *    → Auto-increment integer from `parts` table
 *    → Identifies the TYPE of part (e.g. "RAM 8GB DDR4")
 *    → Never changes, used in foreign keys
 *
 * 2. PRT-YYYYMMDD-NNNN (instance ID)
 *    → Generated when a physical unit is received from vendor
 *    → Identifies ONE PHYSICAL UNIT (e.g. specific RAM stick)
 *    → Stored in `part_instances.prt_id`
 *    → Tracks the lifecycle: in_stock → reserved → installed → removed
 *
 * Format: PRT-20260619-0001
 *   PRT  = Parts prefix (never TTSPL which is for laptops)
 *   date = YYYYMMDD of receipt
 *   seq  = 4-digit sequence (resets per day OR global from sm_document_sequences)
 */
const pool = require('../config/db');

async function generatePrtId(receivedAt = new Date()) {
  const dateStr = receivedAt.toISOString().slice(0, 10).replace(/-/g, '');

  const res = await pool.query(
    `UPDATE sm_document_sequences
     SET last_value = last_value + 1, updated_at = NOW()
     WHERE doc_type = 'part_instance'
     RETURNING last_value`
  );
  const seq = res.rows[0].last_value;
  return `PRT-${dateStr}-${String(seq).padStart(4, '0')}`;
}

async function generatePrqNumber() {
  const res = await pool.query(
    `UPDATE sm_document_sequences
     SET last_value = last_value + 1, updated_at = NOW()
     WHERE doc_type = 'part_request'
     RETURNING last_value`
  );
  const seq = res.rows[0].last_value;
  return `PRQ-${String(res.rows[0].last_value).padStart(4, '0')}`;
}

/**
 * Bulk create part instances when GRN is received
 * qty = number of physical units received
 * Returns array of { prt_id, instance_id }
 */
async function createPartInstances({
  partId, quantity, unitCost, locationCode,
  spoId, grnId, batchNumber, receivedBy, notes
}) {
  const instances = [];
  const now = new Date();

  for (let i = 0; i < quantity; i++) {
    const prtId = await generatePrtId(now);
    const res = await pool.query(
      `INSERT INTO part_instances
         (prt_id, part_id, spo_id, grn_id, batch_number, unit_cost,
          location_code, status, notes, received_at, received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'in_stock',$8,NOW(),$9)
       RETURNING instance_id, prt_id`,
      [prtId, partId, spoId||null, grnId||null, batchNumber||null,
       unitCost, locationCode||null, notes||null, receivedBy||null]
    );
    instances.push(res.rows[0]);
  }

  // Update parts.quantity
  await pool.query(
    `UPDATE parts SET quantity = quantity + $1, updated_at = NOW() WHERE part_id = $2`,
    [quantity, partId]
  );

  return instances;
}

module.exports = { generatePrtId, generatePrqNumber, createPartInstances };
```

---

## SECTION 3 — BACKEND: PART REQUESTS CONTROLLER

### Create `backend/controllers/partRequestController.js`

```javascript
// All exports listed with their HTTP method + route + description

/**
 * exports.createPartRequest
 * POST /api/part-requests
 * Role: team_member, team_lead, floor_manager, qc, admin, manager
 *
 * Body:
 * {
 *   ticket_id: N,
 *   request_type: 'replacement' | 'upgrade' | 'consumable',
 *   part_id: N,          // catalog part ID (from parts table)
 *   quantity: 1,
 *   description: 'Battery draining fast',
 *
 *   // For upgrades only:
 *   config_field: 'ram' | 'storage' | 'display' | 'battery' | 'keyboard' | 'other',
 *   old_value: '8 GB',
 *   new_value: '16 GB',
 *
 *   blocks_stage: true   // should this block moving to next stage?
 * }
 *
 * Actions:
 *   1. Generate PRQ number
 *   2. Insert into part_requests
 *   3. Check parts.quantity > 0:
 *      - YES → status='pending' (warehouse will approve)
 *      - NO  → status='escalated' (goes straight to procurement)
 *   4. If blocks_stage=true: INSERT into ticket_part_blocks + UPDATE tickets.open_part_requests++
 *   5. Log to ttspl_audit_log: event='part_requested'
 *   6. Return: { request_id, request_number, status, in_stock }
 */

/**
 * exports.listPartRequests
 * GET /api/part-requests
 * Params: ticket_id?, status?, role_filter?
 *
 * For warehouse role → returns all 'pending' + 'escalated'
 * For procurement role → returns all 'escalated' + 'ordered'
 * For tech/floor → returns only their own ticket requests
 * For manager/admin → returns all
 *
 * Returns full request details including:
 *   - part name, category, quantity
 *   - ticket: ttspl_id, stage_name, brand/config
 *   - requester name
 *   - current status + timeline
 */

/**
 * exports.getPartRequest
 * GET /api/part-requests/:requestId
 * Full detail including part instance if assigned
 */

/**
 * exports.approvePartRequest
 * PATCH /api/part-requests/:requestId/approve
 * Role: warehouse, admin, manager
 *
 * Body: { instance_id: N }  OR  { auto_select: true }
 * auto_select=true → system picks oldest in_stock instance for this part_id
 *
 * Actions:
 *   1. Verify instance exists, status='in_stock', part matches
 *   2. UPDATE part_instances SET status='reserved', updated_at=NOW()
 *   3. UPDATE part_requests SET status='approved', instance_id=N,
 *      approved_by=user_id, approved_at=NOW()
 *   4. Notify technician (activity log on ticket)
 *   5. Return: { success, instance_id, prt_id, location_code }
 */

/**
 * exports.rejectPartRequest
 * PATCH /api/part-requests/:requestId/reject
 * Role: warehouse, admin, manager
 *
 * Body: { reason: 'Wrong part specified' }
 *
 * Actions:
 *   1. UPDATE part_requests SET status='rejected', rejection_reason=$reason
 *   2. Log to ticket activities
 *   3. If blocks_stage=true: note tech must resolve the block
 */

/**
 * exports.escalateToProcurement
 * PATCH /api/part-requests/:requestId/escalate
 * Role: warehouse, admin, manager
 *
 * Body: { notes? }
 * Can be called by warehouse when they see part is out of stock
 * OR auto-called during createPartRequest if parts.quantity = 0
 *
 * Actions:
 *   1. UPDATE part_requests SET status='escalated', escalated_by=user_id
 *   2. Creates activity on ticket: "Part escalated to procurement"
 *   3. Procurement sees this in their queue
 */

/**
 * exports.linkRequestToSpo
 * PATCH /api/part-requests/:requestId/link-spo
 * Role: procurement, admin
 *
 * Body: { spo_id: N }
 * Called when procurement raises a SPO specifically for this request
 *
 * Actions:
 *   1. UPDATE part_requests SET status='ordered', spo_id=N
 *   2. Log: "SPO SPO-XXXX raised for this part"
 */

/**
 * exports.markPartReceived
 * PATCH /api/part-requests/:requestId/received
 * Role: warehouse, admin
 *
 * Called when SPO GRN is done and the specific part for this request arrived
 * Body: { instance_id: N }  — the new PRT instance
 *
 * Actions:
 *   1. UPDATE part_requests SET status='approved', instance_id=N
 *   2. part_instances.status → 'reserved'
 *   3. Notify technician
 */

/**
 * exports.attachPartAndReturnOld
 * POST /api/part-requests/:requestId/attach
 * Role: team_member, team_lead, floor_manager, admin
 *
 * Body:
 * {
 *   old_part_returned: true | false,
 *   old_part_condition: 'defective' | 'good' | 'worn',
 *   old_part_notes: 'Capacitor blown',
 *   // For upgrade: new config values (auto-set from request)
 * }
 *
 * Actions:
 *   1. Validate: request.status must be 'approved'
 *   2. UPDATE part_instances SET
 *        status='installed',
 *        installed_ttspl_id=ticket.ttspl_id,
 *        installed_ticket_id=ticket_id,
 *        installed_at=NOW()
 *   3. UPDATE parts SET quantity = quantity - 1 WHERE part_id=...
 *   4. INSERT ticket_parts (unit_cost, is_upgrade, quantity_used=1)
 *   5. If is_upgrade: update ttspl_config_history + vendor_serial_numbers.extra
 *   6. UPDATE part_requests SET
 *        status='attached',
 *        old_part_returned=body.old_part_returned,
 *        old_part_returned_at=NOW(),
 *        old_part_condition=body.old_part_condition,
 *        old_part_notes=body.old_part_notes,
 *        attached_by=user_id, attached_at=NOW()
 *   7. If old_part_returned AND condition != 'defective':
 *        Consider adding old part back to parts.quantity (reusable)
 *   8. UPDATE ticket_part_blocks SET is_active=false, unblocked_at=NOW()
 *   9. UPDATE tickets SET open_part_requests = open_part_requests - 1
 *  10. Log ttspl_audit_log: event='part_attached'
 *  11. Return: { success, config_updated, new_config }
 */

/**
 * exports.cancelPartRequest
 * PATCH /api/part-requests/:requestId/cancel
 * Role: technician (own), floor_manager, admin
 *
 * Actions:
 *   1. If instance was reserved: part_instances.status → 'in_stock'
 *   2. UPDATE part_requests SET status='cancelled'
 *   3. Unblock ticket if was blocking
 *   4. UPDATE tickets.open_part_requests--
 */

/**
 * exports.getTicketPartRequests
 * GET /api/tickets/:ticketId/part-requests
 * Returns all part requests for a ticket with full status timeline
 * Used by TicketDetailPage Parts & Config tab
 */

/**
 * exports.getWarehouseQueue
 * GET /api/part-requests/warehouse-queue
 * Role: warehouse, admin, manager
 * Returns: pending + escalated requests grouped by urgency
 */

/**
 * exports.getProcurementQueue
 * GET /api/part-requests/procurement-queue
 * Role: procurement, admin, manager
 * Returns: escalated + ordered requests
 */

/**
 * exports.getPartCostSummary
 * GET /api/part-requests/cost-summary/:ttsplId
 * Returns total expense breakdown for one laptop:
 * {
 *   ttspl_id: 'TTSPL001',
 *   base_cost: 0,          -- from vendor_purchase_orders.unit_price
 *   parts_cost: 2850.00,   -- sum of ticket_parts unit_cost × qty
 *   total_expense: 2850.00,
 *   parts_breakdown: [
 *     { part_name: 'RAM 16GB', prt_id: 'PRT-20260619-0001',
 *       installed_at: '...', unit_cost: 1800, type: 'upgrade' },
 *     { part_name: 'Thermal Paste', prt_id: 'PRT-20260619-0002',
 *       installed_at: '...', unit_cost: 80, type: 'consumable' },
 *   ]
 * }
 */
```

**Full SQL for `attachPartAndReturnOld`** (the most complex operation):

```javascript
exports.attachPartAndReturnOld = async (req, res) => {
  const { requestId } = req.params;
  const { old_part_returned, old_part_condition, old_part_notes } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Load request with part + ticket
    const reqRes = await client.query(
      `SELECT pr.*, p.part_name, p.cost AS part_cost, p.category,
              pi.prt_id, pi.unit_cost AS instance_cost,
              t.ttspl_id, t.vendor_serial_id, t.current_stage_id,
              s.stage_name,
              u.name AS requester_name
       FROM part_requests pr
       JOIN parts p ON p.part_id = pr.part_id
       LEFT JOIN part_instances pi ON pi.instance_id = pr.instance_id
       JOIN tickets t ON t.ticket_id = pr.ticket_id
       JOIN stages s ON s.stage_id = t.current_stage_id
       JOIN users u ON u.user_id = pr.requested_by
       WHERE pr.request_id = $1 FOR UPDATE`,
      [requestId]
    );

    if (!reqRes.rows.length)
      throw Object.assign(new Error('Request not found'), { status: 404 });

    const req_row = reqRes.rows[0];
    if (req_row.status !== 'approved')
      throw Object.assign(
        new Error(`Cannot attach part: request status is '${req_row.status}'. Must be approved.`),
        { status: 400 }
      );

    const unitCost = parseFloat(req_row.instance_cost || req_row.part_cost || 0);
    const isUpgrade = req_row.request_type === 'upgrade';

    // 2. Mark instance as installed
    if (req_row.instance_id) {
      await client.query(
        `UPDATE part_instances SET
           status = 'installed',
           installed_ttspl_id = $1,
           installed_ticket_id = $2,
           installed_at = NOW(),
           updated_at = NOW()
         WHERE instance_id = $3`,
        [req_row.ttspl_id, req_row.ticket_id, req_row.instance_id]
      );
    }

    // 3. Deduct from parts.quantity
    await client.query(
      `UPDATE parts SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
       WHERE part_id = $2`,
      [req_row.quantity || 1, req_row.part_id]
    );

    // 4. Insert ticket_parts
    await client.query(
      `INSERT INTO ticket_parts
         (ticket_id, part_id, quantity_used, notes, unit_cost, is_upgrade)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        req_row.ticket_id,
        req_row.part_id,
        req_row.quantity || 1,
        req_row.description || null,
        unitCost,
        isUpgrade,
      ]
    );

    // 5. For upgrades: update config
    if (isUpgrade && req_row.config_field && req_row.new_value) {
      await client.query(
        `INSERT INTO ttspl_config_history
           (ttspl_id, vendor_serial_id, ticket_id, changed_by, change_type,
            field_name, old_value, new_value, notes, part_used_id, part_cost)
         VALUES ($1,$2,$3,$4,'upgrade',$5,$6,$7,$8,$9,$10)`,
        [
          req_row.ttspl_id,
          req_row.vendor_serial_id,
          req_row.ticket_id,
          req.user.user_id,
          req_row.config_field,
          req_row.old_value,
          req_row.new_value,
          `Part ${req_row.part_name} upgraded (${req_row.old_value} → ${req_row.new_value})`,
          req_row.part_id,
          unitCost,
        ]
      );
      // Update vendor_serial_numbers.extra JSONB
      const fieldMap = {
        ram: 'ram', storage: 'storage', display: 'screen_size',
        processor: 'processor', gpu: 'gpu', os: 'os',
      };
      const jsonbKey = fieldMap[req_row.config_field] || req_row.config_field;
      await client.query(
        `UPDATE vendor_serial_numbers
         SET extra = jsonb_set(extra, $1, $2::jsonb),
             updated_at = NOW()
         WHERE serial_id = $3`,
        [
          `{${jsonbKey}}`,
          JSON.stringify(req_row.new_value),
          req_row.vendor_serial_id,
        ]
      );
    }

    // 6. Mark request attached + old part return
    await client.query(
      `UPDATE part_requests SET
         status = 'attached',
         attached_by = $1, attached_at = NOW(),
         old_part_returned = $2,
         old_part_returned_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
         old_part_condition = $3,
         old_part_notes = $4,
         updated_at = NOW()
       WHERE request_id = $5`,
      [
        req.user.user_id,
        Boolean(old_part_returned),
        old_part_condition || null,
        old_part_notes || null,
        requestId,
      ]
    );

    // 7. If old part returned in good condition — add back to stock
    if (old_part_returned && old_part_condition === 'good') {
      await client.query(
        `UPDATE parts SET quantity = quantity + 1, updated_at = NOW()
         WHERE part_id = $1`,
        [req_row.part_id]
      );
    }

    // 8. Unblock ticket
    await client.query(
      `UPDATE ticket_part_blocks SET is_active = false, unblocked_at = NOW()
       WHERE ticket_id = $1 AND request_id = $2`,
      [req_row.ticket_id, requestId]
    );

    await client.query(
      `UPDATE tickets SET
         open_part_requests = GREATEST(0, open_part_requests - 1),
         updated_at = NOW()
       WHERE ticket_id = $1`,
      [req_row.ticket_id]
    );

    // 9. Audit log
    await client.query(
      `INSERT INTO ttspl_audit_log
         (ttspl_id, event_type, description, metadata, actor_user_id, actor_name)
       VALUES ($1,'part_attached',$2,$3::jsonb,$4,$5)`,
      [
        req_row.ttspl_id,
        `Part attached: ${req_row.part_name} (${req_row.prt_id || 'no PRT ID'})${
          isUpgrade ? ` — Upgrade: ${req_row.old_value} → ${req_row.new_value}` : ''
        }`,
        JSON.stringify({
          part_id: req_row.part_id,
          prt_id: req_row.prt_id,
          part_name: req_row.part_name,
          unit_cost: unitCost,
          is_upgrade: isUpgrade,
          config_field: req_row.config_field,
          old_value: req_row.old_value,
          new_value: req_row.new_value,
          old_part_returned,
          old_part_condition,
        }),
        req.user.user_id,
        req.user.name,
      ]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Part attached successfully',
      config_updated: isUpgrade && Boolean(req_row.config_field),
      ticket_unblocked: Boolean(req_row.blocks_stage),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('attachPartAndReturnOld:', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};
```

### Create `backend/routes/partRequests.js`

```javascript
const router = require('express').Router();
const ctrl = require('../controllers/partRequestController');
const { authMiddleware, checkRole, checkSectionPermission } = require('../middleware/auth');

router.use(authMiddleware);

router.post('/',                           checkSectionPermission('parts_requests','create'),  ctrl.createPartRequest);
router.get('/',                            checkSectionPermission('parts_requests','view'),    ctrl.listPartRequests);
router.get('/warehouse-queue',             checkRole('warehouse','admin','manager'),           ctrl.getWarehouseQueue);
router.get('/procurement-queue',           checkRole('procurement','admin','manager'),         ctrl.getProcurementQueue);
router.get('/cost-summary/:ttsplId',       authMiddleware,                                     ctrl.getPartCostSummary);
router.get('/:requestId',                  authMiddleware,                                     ctrl.getPartRequest);
router.patch('/:requestId/approve',        checkRole('warehouse','admin','manager'),           ctrl.approvePartRequest);
router.patch('/:requestId/reject',         checkRole('warehouse','admin','manager'),           ctrl.rejectPartRequest);
router.patch('/:requestId/escalate',       checkRole('warehouse','admin','manager'),           ctrl.escalateToProcurement);
router.patch('/:requestId/link-spo',       checkRole('procurement','admin'),                   ctrl.linkRequestToSpo);
router.patch('/:requestId/received',       checkRole('warehouse','admin','manager'),           ctrl.markPartReceived);
router.post('/:requestId/attach',          checkSectionPermission('parts_requests','create'),  ctrl.attachPartAndReturnOld);
router.patch('/:requestId/cancel',         authMiddleware,                                     ctrl.cancelPartRequest);

module.exports = router;
```

### Mount in `backend/server.js`

```javascript
app.use('/api/part-requests', require('./routes/partRequests'));
```

---

## SECTION 4 — EXTEND SPO RECEIVE TO CREATE PART INSTANCES

When warehouse receives a Spare Parts Order (SPO) via GRN, each unit
received must generate a PRT-ID.

In `backend/controllers/vendorManagement/sparePartsOrders.controller.js`,
in the `receiveSpareLineSerial` function (after receiving), add:

```javascript
const { createPartInstances } = require('../../services/partIdService');

// After existing GRN logic:
// If the received line item maps to a parts catalog entry (part_id),
// create part_instances for each unit received:
if (line.part_id && line.quantity > 0) {
  const instances = await createPartInstances({
    partId: line.part_id,
    quantity: Number(line.quantity),
    unitCost: Number(line.unit_price || line.rate || 0),
    locationCode: line.location_code || null,
    spoId: spoId,
    grnId: grnId,
    batchNumber: line.batch_number || null,
    receivedBy: req.user.user_id,
  });

  // Link back to any open part_requests for this part_id
  // that are in 'escalated' or 'ordered' status
  await pool.query(
    `UPDATE part_requests SET
       status = 'approved',
       instance_id = $1,
       updated_at = NOW()
     WHERE part_id = $2
       AND status IN ('escalated','ordered')
       AND instance_id IS NULL
     LIMIT 1
     RETURNING request_id`,
    [instances[0].instance_id, line.part_id]
  );

  // Log to each linked ticket
  // (additional query to get those ticket_ids from part_requests)
}
```

---

## SECTION 5 — FRONTEND: PART REQUEST PANEL

### Update `frontend/src/features/floor-pipeline/components/PartsConfigPanel.jsx`

The current PartsConfigPanel has a simple "Attach Part" form.
Replace/extend it to add the full request flow:

#### Two tabs inside PartsConfigPanel:
1. **"Request Part"** — raise a part request (approval required)
2. **"Direct Attach"** — for consumables/minor items (no approval, if permitted)

#### Part Request Form (Tab 1):

```jsx
// State:
// requestType: 'replacement' | 'upgrade' | 'consumable'
// selectedPartId: null
// quantity: 1
// description: ''
// blocksStage: true
// configField: '' (for upgrades)
// oldValue: '' (auto-filled from ticket config)
// newValue: ''

<div className="space-y-4">
  {/* Request Type */}
  <div>
    <label>Request Type</label>
    <div className="grid grid-cols-3 gap-2">
      {[
        { value: 'replacement', label: '🔧 Replace Defective', desc: 'Swap broken part' },
        { value: 'upgrade',     label: '⬆ Upgrade',           desc: 'Improve specification' },
        { value: 'consumable',  label: '🧴 Consumable',       desc: 'Paste, screws, etc.' },
      ].map((opt) => (
        <button key={opt.value} type="button"
          onClick={() => setRequestType(opt.value)}
          className={`p-2 border rounded-lg text-left text-xs
            ${requestType === opt.value
              ? 'border-blue-500 bg-blue-50 text-blue-900'
              : 'border-gray-200 hover:border-gray-300'
            }`}>
          <p className="font-semibold">{opt.label}</p>
          <p className="text-gray-500 mt-0.5">{opt.desc}</p>
        </button>
      ))}
    </div>
  </div>

  {/* Part Selector */}
  <div>
    <label>Select Part from Catalog</label>
    <PartSearchAutocomplete
      value={selectedPartId}
      onChange={setSelectedPartId}
      filter={{ compatible_brand: ticket.brand }}
      showStock={true}
    />
    {selectedPart && (
      <div className="mt-1 flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium
          ${selectedPart.quantity > 5 ? 'bg-green-100 text-green-700'
            : selectedPart.quantity > 0 ? 'bg-amber-100 text-amber-700'
            : 'bg-red-100 text-red-700'}`}>
          {selectedPart.quantity > 0
            ? `In Stock: ${selectedPart.quantity}`
            : '⚠ Out of Stock — will go to Procurement'}
        </span>
        <span className="text-xs text-gray-500">₹{selectedPart.cost}/unit</span>
      </div>
    )}
  </div>

  {/* Upgrade fields */}
  {requestType === 'upgrade' && (
    <div className="space-y-2 bg-blue-50 rounded-lg p-3">
      <label className="text-xs font-semibold text-blue-900">Config Change</label>
      <select value={configField} onChange={(e) => {
          setConfigField(e.target.value);
          // Auto-fill old value from ticket
          const autoOld = {
            ram: ticket.ram,
            storage: ticket.storage,
            display: ticket.screen_size,
            processor: ticket.processor,
          }[e.target.value] || '';
          setOldValue(autoOld);
        }}
        className="w-full border rounded-lg px-3 py-2 text-sm">
        <option value="">What are you upgrading?</option>
        <option value="ram">RAM</option>
        <option value="storage">Storage / SSD</option>
        <option value="display">Display</option>
        <option value="battery">Battery</option>
        <option value="keyboard">Keyboard</option>
        <option value="gpu">GPU</option>
        <option value="other">Other</option>
      </select>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500">Current (old)</label>
          <input value={oldValue} onChange={(e) => setOldValue(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. 8 GB" />
        </div>
        <div>
          <label className="text-xs text-gray-500">After upgrade (new)*</label>
          <input value={newValue} onChange={(e) => setNewValue(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. 16 GB" />
        </div>
      </div>
    </div>
  )}

  {/* Description */}
  <textarea value={description} onChange={(e) => setDescription(e.target.value)}
    rows={2} placeholder="Why is this part needed? Describe the issue..."
    className="w-full border rounded-lg px-3 py-2 text-sm" />

  {/* Stage blocking toggle */}
  <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" checked={blocksStage}
      onChange={(e) => setBlocksStage(e.target.checked)} />
    <span>Block ticket from moving to next stage until part is attached</span>
  </label>

  {/* Submit button */}
  <button type="button" onClick={handleSubmitRequest} disabled={saving}
    className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">
    {saving ? 'Submitting…' : selectedPart?.quantity > 0
      ? '📤 Submit for Warehouse Approval'
      : '📤 Submit for Procurement'}
  </button>
</div>
```

#### Active Part Requests section (always visible when requests exist):

```jsx
{partRequests.length > 0 && (
  <div className="mt-4 space-y-2">
    <h4 className="text-xs font-semibold uppercase text-gray-500">Active Part Requests</h4>
    {partRequests.map((req) => (
      <div key={req.request_id} className="border rounded-lg p-3 bg-white">
        <div className="flex items-start justify-between">
          <div>
            <span className="font-mono text-xs text-blue-700">{req.request_number}</span>
            <p className="font-medium text-sm mt-0.5">{req.part_name}</p>
            {req.request_type === 'upgrade' && (
              <p className="text-xs text-blue-600">
                ⬆ {req.config_field}: {req.old_value} → {req.new_value}
              </p>
            )}
          </div>
          <StatusBadge status={req.status} />
        </div>

        {/* Status timeline */}
        <div className="flex items-center gap-1 mt-2">
          {['pending','approved','attached'].map((s, i) => (
            <React.Fragment key={s}>
              <div className={`w-2 h-2 rounded-full ${
                req.status === s ? 'bg-blue-600' :
                statusOrder(req.status) > i ? 'bg-green-500' : 'bg-gray-200'
              }`} />
              {i < 2 && <div className="flex-1 h-px bg-gray-200" />}
            </React.Fragment>
          ))}
        </div>

        {/* Attach button — shown only when approved */}
        {req.status === 'approved' && isAssignedTech && (
          <div className="mt-2 pt-2 border-t">
            <p className="text-xs text-green-700 mb-2">
              ✓ Part approved by warehouse. PRT-ID: {req.prt_id || 'assigned'}
            </p>
            <button type="button" onClick={() => openAttachModal(req)}
              className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-semibold">
              Attach Part + Return Old Part
            </button>
          </div>
        )}

        {/* Block indicator */}
        {req.blocks_stage && !['attached','cancelled'].includes(req.status) && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
            <span>⛔</span>
            <span>Ticket blocked until part is attached</span>
          </div>
        )}
      </div>
    ))}
  </div>
)}
```

#### Attach + Return Old Part Modal:

```jsx
function AttachPartModal({ request, onAttached, onClose }) {
  const [oldPartReturned, setOldPartReturned] = useState(true);
  const [oldPartCondition, setOldPartCondition] = useState('defective');
  const [oldPartNotes, setOldPartNotes] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl w-full max-w-sm p-5 shadow-xl">
        <h3 className="font-semibold mb-1">Attach Part: {request.part_name}</h3>
        {request.prt_id && (
          <p className="font-mono text-xs text-blue-700 mb-3">PRT-ID: {request.prt_id}</p>
        )}

        {request.request_type === 'upgrade' && (
          <div className="bg-blue-50 rounded-lg p-3 mb-3 text-sm">
            <p className="font-medium text-blue-900">Config will be updated:</p>
            <p className="text-blue-700">
              {request.config_field}: {request.old_value} → {request.new_value}
            </p>
          </div>
        )}

        <div className="space-y-3 mb-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={oldPartReturned}
              onChange={(e) => setOldPartReturned(e.target.checked)} />
            <span>I am returning the {
              request.request_type === 'replacement' ? 'defective part' : 'old part'
            } to warehouse</span>
          </label>

          {oldPartReturned && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Old part condition
                </label>
                <select value={oldPartCondition} onChange={(e) => setOldPartCondition(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="defective">Defective (cannot reuse)</option>
                  <option value="worn">Worn (may still work)</option>
                  <option value="good">Good (reusable)</option>
                </select>
              </div>
              <textarea value={oldPartNotes} onChange={(e) => setOldPartNotes(e.target.value)}
                rows={2} placeholder="Notes about the old part (optional)"
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </>
          )}
        </div>

        {!oldPartReturned && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 mb-3 text-xs text-amber-800">
            ⚠ You must return the old/defective part to warehouse.
            Ticket will not be unblocked until this is done.
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
          <button type="button" disabled={saving || !oldPartReturned}
            onClick={async () => {
              setSaving(true);
              try {
                await attachPartToRequest(request.request_id, {
                  old_part_returned: oldPartReturned,
                  old_part_condition: oldPartCondition,
                  old_part_notes: oldPartNotes,
                });
                toast.success('Part attached! Ticket unblocked.');
                onAttached();
                onClose();
              } catch (e) {
                toast.error(e.response?.data?.message || 'Failed');
              } finally { setSaving(false); }
            }}
            className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Attaching…' : 'Confirm Attachment'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## SECTION 6 — WAREHOUSE QUEUE PAGE

### New page: `frontend/src/features/inventory-management/pages/PartsApprovalPage.jsx`

Route: `/inventory-management/parts-approval`
Visible to: warehouse, admin, manager

```
PARTS APPROVAL QUEUE

Tabs: [Pending Approval (N)] [Escalated to Procurement] [Ordered] [Done]

── PENDING APPROVAL ──────────────────────────────────────────────────

PRQ-0001 · Replacement · TTSPL0012
  Part needed: RAM 8GB DDR4
  Requested by: Ravi Kumar | Stage: Assembly & Software
  Ticket: Dell i5 10th Gen | PO-0001
  In Stock: 12 units | ₹850/unit
  [✓ Approve] [✗ Reject] [↑ Escalate to Procurement]

PRQ-0002 · Upgrade · TTSPL0023
  Part needed: SSD 512GB SATA
  Config change: Storage: 256 GB → 512 GB
  Requested by: Suresh Verma | Stage: Diagnosis
  In Stock: 4 units | ₹2,200/unit
  [✓ Approve] [✗ Reject]

── ESCALATED ─────────────────────────────────────────────────────────

PRQ-0003 · Replacement · TTSPL0008
  Part needed: Display 15.6" FHD
  In Stock: 0 | → Needs Purchase Order
  [Link to SPO] [Create New SPO]
```

**Approve action**: calls `PATCH /api/part-requests/:id/approve`
  - If multiple instances in stock, show picker with PRT-IDs
  - OR auto_select=true for oldest in_stock

**Reject action**: opens reason input → `PATCH /api/part-requests/:id/reject`

**Escalate**: `PATCH /api/part-requests/:id/escalate`

**Link to SPO**: opens SPO selector → `PATCH /api/part-requests/:id/link-spo`

---

## SECTION 7 — PROCUREMENT QUEUE VIEW

In the existing Spare Parts Orders page, add a "Part Requests" section at top:

```
PARTS REQUESTS NEEDING PROCUREMENT

PRQ-0003 · Display 15.6" FHD — TTSPL0008 (Urgent: QC1 blocked)
  [Raise SPO for this part]  — links SPO to this request on creation

PRQ-0005 · Battery 6-cell — TTSPL0031 (Assembly stage blocked)
  [Raise SPO for this part]
```

When procurement creates a SPO and selects "Fulfilling Part Request(s)", it
links the SPO to the request_id(s) → status → 'ordered'.

---

## SECTION 8 — STAGE BLOCKING IN TICKET DETAIL

### Update TicketDetailPage.jsx — respect `open_part_requests`

In the stage action buttons section, check if ticket has open part requests:

```javascript
// In the stageButtons build logic:
const hasOpenPartRequest = (ticket.open_part_requests || 0) > 0;

if (hasOpenPartRequest) {
  // Replace move buttons with blocked state
  stageButtons = [{
    label: `⛔ Blocked: ${ticket.open_part_requests} part request(s) pending`,
    action: () => setTab('parts'), // navigate to Parts & Config tab
    disabled: true,
    danger: false,
    muted: true,
  }];
}
```

Also add a banner in the main area when blocked:

```jsx
{(ticket.open_part_requests || 0) > 0 && (
  <div className="mx-4 mb-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
    <span className="text-lg">⛔</span>
    <div>
      <p className="text-sm font-semibold text-amber-900">
        Ticket blocked — {ticket.open_part_requests} part request(s) pending
      </p>
      <p className="text-xs text-amber-700">
        Parts must be attached before moving to next stage.
        <button onClick={() => setTab('parts')} className="ml-1 underline">View requests</button>
      </p>
    </div>
  </div>
)}
```

---

## SECTION 9 — EXPENSE TRACKING: TTSPL HISTORY DRAWER

In `TtsplHistoryDrawer.jsx`, the cost summary section already shows
`parts_cost` from the API. Update `getPartCostSummary` endpoint to return
full breakdown including PRT-IDs:

### Display in drawer:

```
LAPTOP EXPENSE SUMMARY

  Base cost (PO rate):        ₹  3,500/month  (rental)
  
  Parts used:                 ₹  2,930.00
    PRT-20260619-0001  RAM 16GB DDR4     ₹1,800  [Upgrade]  19 Jun 2026
    PRT-20260619-0002  Thermal Paste     ₹   80  [Replace]  19 Jun 2026
    PRT-20260620-0011  Battery 6-cell    ₹1,050  [Replace]  20 Jun 2026
  
  Total parts expense:        ₹  2,930.00
  
  Config changes: 2
    RAM:     8 GB → 16 GB  (19 Jun 2026)
    Battery: 4-cell → 6-cell (20 Jun 2026)
```

---

## SECTION 10 — SIDEBAR MENU ADDITIONS

In `frontend/src/config/menuConfig.js`, Inventory Management section:

```javascript
{ label: 'Parts Inventory',  path: '/inventory-management/parts',          section: 'parts_inventory' },
{ label: 'Parts Approval',   path: '/inventory-management/parts-approval', section: 'parts_approval' },
```

Also add count badge for `parts_approval` — count of pending part requests.

In the Finance Overview dashboard `getCounts`, add:
```javascript
parts_pending: (await pool.query(
  `SELECT COUNT(*) FROM part_requests WHERE status IN ('pending','escalated')`
)).rows[0].count
```

---

## SECTION 11 — BUILD ORDER

1. Run migration 088
2. Create `backend/services/partIdService.js`
3. Create `backend/controllers/partRequestController.js` (all exports)
4. Create `backend/routes/partRequests.js`
5. Mount in `server.js`
6. Update `sparePartsOrders.controller.js` — create instances on GRN receive
7. Update `frontend/src/features/floor-pipeline/components/PartsConfigPanel.jsx`
   — add Request Part form + active requests + Attach modal
8. Create `frontend/src/features/inventory-management/pages/PartsApprovalPage.jsx`
9. Update `frontend/src/features/floor-pipeline/pages/TicketDetailPage.jsx`
   — stage blocking when open_part_requests > 0
10. Update `frontend/src/features/floor-pipeline/components/TtsplHistoryDrawer.jsx`
    — show full parts expense with PRT-IDs
11. Update `frontend/src/config/menuConfig.js` — Parts Approval in sidebar
12. Add route to inventory routes file

---

## SECTION 12 — QUALITY CHECKLIST

Database:
  [ ] Migration 088 runs clean
  [ ] part_instances table created with PRT-ID format PRT-YYYYMMDD-NNNN
  [ ] part_requests table extended (request_type, approval fields, blocking)
  [ ] ticket_part_blocks table created
  [ ] sm_document_sequences has 'part_request' and 'part_instance'
  [ ] tickets.open_part_requests column added

Part IDs:
  [ ] Receiving 3 units of RAM → creates PRT-20260619-0001, -0002, -0003
  [ ] PRT format never uses 'TTSPL' prefix
  [ ] PRT-IDs are unique across the system

Replacement Flow (Case 1):
  [ ] Tech raises request type='replacement', selects part from catalog
  [ ] If in stock → status='pending', warehouse sees it in queue
  [ ] Warehouse approves → status='approved', specific PRT-ID assigned
  [ ] Tech attaches part → part_instances.status='installed', ttspl set
  [ ] Tech must check "returning old part" to unblock ticket
  [ ] Old part 'good' condition → parts.quantity++ (goes back to stock)
  [ ] Ticket unblocked after attach

Upgrade Flow (Case 2):
  [ ] Tech raises request type='upgrade', selects part + config_field + new_value
  [ ] Old value auto-filled from current ticket config
  [ ] If not in stock → status='escalated', procurement sees it
  [ ] Procurement links to SPO → status='ordered'
  [ ] On SPO GRN receive → auto-links to request → status='approved'
  [ ] Warehouse assigns PRT-ID → tech attaches
  [ ] After attach: vendor_serial_numbers.extra updated (ram, storage etc.)
  [ ] ttspl_config_history row created with old→new values
  [ ] Ticket header immediately shows new config

Stage Blocking:
  [ ] Ticket with open part request: move buttons replaced with blocked message
  [ ] Amber banner shown with count and "View requests" link
  [ ] After part attached: open_part_requests decremented → buttons reappear

Warehouse Queue:
  [ ] Pending requests visible with part name, stock count, PRT-IDs available
  [ ] Approve → selects specific PRT-ID instance or auto-selects
  [ ] Escalate → moves to procurement queue
  [ ] Reject → reason required

Expense Tracking:
  [ ] TTSPL History drawer shows full expense: base + parts total
  [ ] Each part line shows: PRT-ID, part name, cost, type, date
  [ ] Config changes tab shows upgrade history

---

## SECTION 13 — NAMING REFERENCE

| Concept | Correct | Wrong |
|---|---|---|
| Part catalog ID | `part_id` (integer) | part_catalog_id |
| Part instance ID | `PRT-YYYYMMDD-NNNN` | TTSPL, PART, PLT |
| Part request number | `PRQ-0001` | PR-001, REQ-001 |
| Request type | `replacement` / `upgrade` / `consumable` | replace, fix |
| Request status | `pending` / `approved` / `escalated` / `ordered` / `received` / `attached` / `cancelled` | open, done |
| Block table | `ticket_part_blocks` | part_block, blocked_tickets |
| Instance status | `in_stock` / `reserved` / `installed` / `defective` / `returned` | available, used |
| Config update field | `config_field` | field_name, config_key |
| Old part return | `old_part_returned` (boolean) | returned, given_back |
| Expense summary endpoint | `GET /api/part-requests/cost-summary/:ttsplId` | |
| Warehouse queue endpoint | `GET /api/part-requests/warehouse-queue` | |
| Procurement queue | `GET /api/part-requests/procurement-queue` | |
