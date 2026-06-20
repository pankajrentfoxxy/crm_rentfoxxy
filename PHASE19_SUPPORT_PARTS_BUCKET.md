# RENTFOXXY CRM — PHASE 19 BUILD PROMPT
## Support Technician Parts Bucket + Challan PDF + E-Sign Return Flow
### Branch: new_crm_rentfoxxy

---

## FLOW OVERVIEW

```
TECHNICIAN receives support ticket
    ↓
He identifies he MAY need a part (before going to site)
    ↓
Raises Support Part Request against:
  - Support Ticket ID (STK-XXXX)
  - TTSPL ID / Serial number of the laptop
  - Part name + quantity
    ↓
WAREHOUSE sees request in their queue
  - Views: Technician name | Ticket ID | TTSPL | Part needed | Qty
  - Approves (picks part from inventory)
    ↓
CHALLAN GENERATED (SPC-YYYYMMDD-NNNN)
  - Company header (TRUETECH SERVICES PRIVATE LIMITED)
  - Technician details
  - Support Ticket reference
  - Part(s) list with PRT-IDs
  - E-Sign box for technician
    ↓
TECHNICIAN comes to warehouse, SIGNS the challan
  - E-sign captured on screen (SignaturePad)
  - Saved as PNG → linked to challan
  - Part(s) move to technician bucket (status = 'with_technician')
    ↓
TECHNICIAN BUCKET (visible to manager/lead at any time)
  Shows: Technician → Parts held → Ticket ref → Since when
    ↓
AT CUSTOMER SITE
  If part used: mark as 'used_on_ticket'
  If not used: return to warehouse
    ↓
RETURN FLOW (two sub-flows)
  A. Technician goes to warehouse:
     - Clicks "Return Part"
     - Warehouse scans/accepts
     - Warehouse e-signs return confirmation
     - Part back to 'in_stock'
  B. Technician requests pickup:
     - Raises return request
     - Warehouse collects from tech
     - Marks as received
     - Part back to 'in_stock'
```

---

## SECTION 1 — DATABASE MIGRATION 098

```sql
-- ============================================================
-- Migration 098: Support Technician Parts Bucket + Challan
-- ============================================================

-- 1. Support Part Requests
CREATE TABLE IF NOT EXISTS support_part_requests (
  id               SERIAL PRIMARY KEY,
  request_number   VARCHAR(30) NOT NULL UNIQUE,   -- SPR-0001
  support_ticket_id INT NOT NULL REFERENCES support_tickets(id),
  support_item_id  INT REFERENCES support_ticket_items(id),
  ttspl_id         VARCHAR(120),       -- laptop the part is for
  serial_number    VARCHAR(255),       -- serial number of laptop
  requested_by     INT NOT NULL REFERENCES users(user_id),
  assigned_to_tech INT REFERENCES users(user_id),  -- tech making request
  part_id          INT NOT NULL REFERENCES parts(part_id),
  quantity         INT NOT NULL DEFAULT 1,
  reason           TEXT,               -- why this part is needed
  status           VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',          -- raised, awaiting warehouse
      'approved',         -- warehouse approved, challan created
      'challan_generated',-- PDF challan created
      'issued',           -- tech signed, part taken
      'used',             -- used on laptop at customer site
      'return_requested', -- tech wants to return unused
      'returned',         -- part back in warehouse
      'rejected',         -- warehouse rejected
      'cancelled'         -- tech cancelled
    )),
  instance_id      INT REFERENCES part_instances(instance_id),
  challan_id       INT,                -- FK to support_part_challans (set after creation)
  approved_by      INT REFERENCES users(user_id),
  approved_at      TIMESTAMPTZ,
  issued_at        TIMESTAMPTZ,
  used_at          TIMESTAMPTZ,
  return_requested_at TIMESTAMPTZ,
  returned_at      TIMESTAMPTZ,
  returned_to      INT REFERENCES users(user_id),
  rejection_reason TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spr_ticket  ON support_part_requests(support_ticket_id);
CREATE INDEX IF NOT EXISTS idx_spr_tech    ON support_part_requests(assigned_to_tech);
CREATE INDEX IF NOT EXISTS idx_spr_status  ON support_part_requests(status);

-- 2. Support Part Challans
--    One challan can cover multiple part requests (batch issue)
CREATE TABLE IF NOT EXISTS support_part_challans (
  id               SERIAL PRIMARY KEY,
  challan_number   VARCHAR(30) NOT NULL UNIQUE,   -- SPC-20260619-0001
  support_ticket_id INT NOT NULL REFERENCES support_tickets(id),
  ttspl_id         VARCHAR(120),
  issued_to        INT NOT NULL REFERENCES users(user_id),    -- technician
  issued_by        INT REFERENCES users(user_id),             -- warehouse staff
  issued_at        TIMESTAMPTZ,
  status           VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','partially_returned','fully_returned')),

  -- E-sign from TECHNICIAN (acknowledging receipt of parts)
  tech_esign_url   TEXT,
  tech_esign_at    TIMESTAMPTZ,
  tech_esign_name  VARCHAR(255),

  -- E-sign from WAREHOUSE (acknowledging return of parts)
  wh_esign_url     TEXT,
  wh_esign_at      TIMESTAMPTZ,
  wh_esign_name    VARCHAR(255),

  -- PDF path
  pdf_path         TEXT,
  return_pdf_path  TEXT,

  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Junction: which part_requests belong to a challan
CREATE TABLE IF NOT EXISTS support_challan_items (
  id              SERIAL PRIMARY KEY,
  challan_id      INT NOT NULL REFERENCES support_part_challans(id),
  part_request_id INT NOT NULL REFERENCES support_part_requests(id),
  part_id         INT NOT NULL REFERENCES parts(part_id),
  instance_id     INT REFERENCES part_instances(instance_id),
  prt_id          VARCHAR(30),          -- denormalised for PDF
  part_name       VARCHAR(255),         -- denormalised for PDF
  quantity        INT NOT NULL DEFAULT 1,
  unit_cost       NUMERIC(10,2) DEFAULT 0,
  returned_qty    INT DEFAULT 0,
  return_status   VARCHAR(20) DEFAULT 'held'
    CHECK (return_status IN ('held','used','returned')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Technician parts bucket view (denormalised for fast access)
--    Anything in support_part_requests with status='issued' is "in bucket"

-- 5. Document sequences
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES
  ('support_part_request', 0, 'SPR-'),
  ('support_part_challan', 0, 'SPC-')
ON CONFLICT (doc_type) DO NOTHING;

-- 6. Update part_instances to allow 'with_technician' status
ALTER TABLE part_instances
  DROP CONSTRAINT IF EXISTS part_instances_status_check;
ALTER TABLE part_instances
  ADD CONSTRAINT part_instances_status_check
  CHECK (status IN (
    'in_stock','reserved','installed','defective',
    'returned','discarded','sold','with_technician'  -- NEW
  ));

-- 7. Add FK back-link from support_part_requests to challan
ALTER TABLE support_part_requests
  ADD CONSTRAINT fk_spr_challan
  FOREIGN KEY (challan_id) REFERENCES support_part_challans(id)
  DEFERRABLE INITIALLY DEFERRED;

-- 8. Permissions
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('support_part_requests', 'Support Part Requests (Field)',    325),
  ('support_part_challan',  'Support Part Challans (Warehouse)', 326)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('support_tech',  'support_part_requests', true, true,  true,  false),
  ('support_lead',  'support_part_requests', true, true,  true,  true),
  ('warehouse',     'support_part_requests', true, false, true,  false),
  ('admin',         'support_part_requests', true, true,  true,  true),
  ('manager',       'support_part_requests', true, false, true,  false),
  ('warehouse',     'support_part_challan',  true, true,  true,  false),
  ('support_lead',  'support_part_challan',  true, true,  true,  false),
  ('admin',         'support_part_challan',  true, true,  true,  true),
  ('manager',       'support_part_challan',  true, false, false, false)
ON CONFLICT (role, section) DO NOTHING;
```

---

## SECTION 2 — BACKEND: SUPPORT PARTS CONTROLLER

### Create `backend/controllers/supportPartsController.js`

```javascript
'use strict';
const pool = require('../config/db');
const path = require('path');
const fs   = require('fs');

// ── helpers ──────────────────────────────────────────────────────────────────

async function nextSprNumber() {
  const r = await pool.query(
    `UPDATE sm_document_sequences SET last_value = last_value + 1, updated_at = NOW()
     WHERE doc_type = 'support_part_request' RETURNING last_value`
  );
  return `SPR-${String(r.rows[0].last_value).padStart(4, '0')}`;
}

async function nextSpcNumber() {
  const r = await pool.query(
    `UPDATE sm_document_sequences SET last_value = last_value + 1, updated_at = NOW()
     WHERE doc_type = 'support_part_challan' RETURNING last_value`
  );
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `SPC-${dateStr}-${String(r.rows[0].last_value).padStart(4, '0')}`;
}

function saveEsignFile(base64Data, prefix) {
  const dir = path.join(__dirname, '../uploads/support-parts');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${prefix}_esign_${Date.now()}.png`;
  const b64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(path.join(dir, filename), Buffer.from(b64, 'base64'));
  return `uploads/support-parts/${filename}`;
}

// ── RAISE PART REQUEST ────────────────────────────────────────────────────────

/**
 * POST /api/support-parts/requests
 * Role: support_tech, support_lead, admin
 * Body: { support_ticket_id, support_item_id?, ttspl_id, serial_number?,
 *         part_id, quantity, reason }
 */
exports.raiseSupportPartRequest = async (req, res) => {
  const { support_ticket_id, support_item_id, ttspl_id, serial_number,
          part_id, quantity, reason } = req.body;

  if (!support_ticket_id || !part_id || !quantity) {
    return res.status(400).json({ success: false,
      message: 'support_ticket_id, part_id, quantity are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate ticket exists
    const tkRes = await client.query(
      'SELECT id FROM support_tickets WHERE id = $1', [support_ticket_id]
    );
    if (!tkRes.rows.length)
      throw Object.assign(new Error('Support ticket not found'), { status: 404 });

    // Validate part exists + get stock info
    const partRes = await client.query(
      `SELECT p.*, pi_count.available
       FROM parts p
       LEFT JOIN (
         SELECT part_id, COUNT(*) AS available
         FROM part_instances WHERE status = 'in_stock'
         GROUP BY part_id
       ) pi_count ON pi_count.part_id = p.part_id
       WHERE p.part_id = $1 AND NOT COALESCE(p.archived, FALSE)`,
      [part_id]
    );
    if (!partRes.rows.length)
      throw Object.assign(new Error('Part not found'), { status: 404 });
    const part = partRes.rows[0];

    const reqNumber = await nextSprNumber();
    const { rows } = await client.query(
      `INSERT INTO support_part_requests
         (request_number, support_ticket_id, support_item_id, ttspl_id,
          serial_number, requested_by, assigned_to_tech, part_id, quantity,
          reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'pending')
       RETURNING *`,
      [reqNumber, support_ticket_id, support_item_id || null, ttspl_id || null,
       serial_number || null, req.user.user_id, part_id, Number(quantity), reason || null]
    );
    const spr = rows[0];

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      request: { ...spr, part_name: part.part_name, stock_available: Number(part.available || 0) },
      in_stock: Number(part.available || 0) > 0,
      message: Number(part.available || 0) > 0
        ? 'Request raised. Awaiting warehouse approval.'
        : 'Request raised. Part is out of stock — warehouse will procure.'
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── LIST REQUESTS (warehouse queue + technician view) ─────────────────────────

/**
 * GET /api/support-parts/requests
 * Query: status?, assigned_to_tech?, support_ticket_id?, for_warehouse=true
 */
exports.listSupportPartRequests = async (req, res) => {
  const { status, for_warehouse, assigned_to_tech, support_ticket_id } = req.query;

  let where = 'WHERE 1=1';
  const params = [];

  if (status) {
    where += ` AND spr.status = $${params.length + 1}`;
    params.push(status);
  }
  if (for_warehouse === 'true') {
    where += ` AND spr.status IN ('pending','approved','challan_generated')`;
  }
  if (assigned_to_tech) {
    where += ` AND spr.assigned_to_tech = $${params.length + 1}`;
    params.push(Number(assigned_to_tech));
  }
  if (support_ticket_id) {
    where += ` AND spr.support_ticket_id = $${params.length + 1}`;
    params.push(Number(support_ticket_id));
  }
  // Tech sees only own requests
  if (req.user.role === 'support_tech') {
    where += ` AND spr.assigned_to_tech = $${params.length + 1}`;
    params.push(req.user.user_id);
  }

  const { rows } = await pool.query(
    `SELECT spr.*,
            p.part_name, p.category, p.location_code, p.cost AS unit_cost,
            pi.prt_id, pi.location_code AS instance_location,
            tech.name AS tech_name, tech.email AS tech_email,
            approver.name AS approved_by_name,
            st.customer_name, st.ticket_number AS support_ticket_number,
            spc.challan_number, spc.tech_esign_url, spc.pdf_path
     FROM support_part_requests spr
     JOIN parts p ON p.part_id = spr.part_id
     LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
     JOIN users tech ON tech.user_id = spr.assigned_to_tech
     LEFT JOIN users approver ON approver.user_id = spr.approved_by
     JOIN support_tickets st ON st.id = spr.support_ticket_id
     LEFT JOIN support_part_challans spc ON spc.id = spr.challan_id
     ${where}
     ORDER BY spr.created_at DESC`,
    params
  );

  res.json({ success: true, requests: rows });
};

// ── WAREHOUSE: APPROVE + GENERATE CHALLAN ────────────────────────────────────

/**
 * POST /api/support-parts/requests/approve-and-challan
 * Role: warehouse, admin, support_lead
 * Body: { request_ids: [N, N, ...], issued_by_name?: string }
 *
 * Approves one or more requests for the SAME technician + support ticket
 * Creates ONE challan covering all approved items.
 */
exports.approveAndGenerateChallan = async (req, res) => {
  const { request_ids, issued_by_name } = req.body;
  if (!Array.isArray(request_ids) || !request_ids.length) {
    return res.status(400).json({ success: false, message: 'request_ids required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Load all requests — must be same ticket + same tech + status=pending
    const reqRes = await client.query(
      `SELECT spr.*, p.part_name, p.cost AS unit_cost
       FROM support_part_requests spr
       JOIN parts p ON p.part_id = spr.part_id
       WHERE spr.id = ANY($1::int[]) AND spr.status = 'pending'
       FOR UPDATE`,
      [request_ids]
    );
    if (!reqRes.rows.length)
      throw new Error('No pending requests found for given IDs');

    const requests = reqRes.rows;
    const techIds = [...new Set(requests.map((r) => r.assigned_to_tech))];
    const ticketIds = [...new Set(requests.map((r) => r.support_ticket_id))];
    if (techIds.length > 1)
      throw new Error('All requests must belong to the same technician');
    if (ticketIds.length > 1)
      throw new Error('All requests must belong to the same support ticket');

    const techId  = techIds[0];
    const ticketId = ticketIds[0];
    const ttsplId  = requests[0].ttspl_id;

    // For each request: find an in_stock instance, reserve it
    const challanItems = [];
    for (const req_row of requests) {
      // Find in_stock instance
      const instRes = await client.query(
        `SELECT * FROM part_instances
         WHERE part_id = $1 AND status = 'in_stock'
         ORDER BY received_at ASC LIMIT 1 FOR UPDATE`,
        [req_row.part_id]
      );

      let instance = instRes.rows[0];
      if (!instance && Number(req_row.quantity) > 0) {
        // Legacy fallback: parts.quantity > 0 but no instances
        const partQtyRes = await client.query(
          'SELECT quantity, cost FROM parts WHERE part_id = $1', [req_row.part_id]
        );
        if (Number(partQtyRes.rows[0]?.quantity || 0) > 0) {
          // Create on-the-fly instance
          const { generatePrtId } = require('../services/partIdService');
          const prtId = await generatePrtId(new Date());
          const newInst = await client.query(
            `INSERT INTO part_instances (prt_id, part_id, unit_cost, status, notes)
             VALUES ($1,$2,$3,'in_stock','Auto-created from legacy stock') RETURNING *`,
            [prtId, req_row.part_id, Number(partQtyRes.rows[0]?.cost || 0)]
          );
          instance = newInst.rows[0];
        }
      }
      if (!instance)
        throw new Error(`Part "${req_row.part_name}" is out of stock. Reject or escalate.`);

      // Reserve the instance
      await client.query(
        `UPDATE part_instances SET status = 'reserved', updated_at = NOW()
         WHERE instance_id = $1`,
        [instance.instance_id]
      );
      await client.query(
        `UPDATE support_part_requests
         SET status = 'approved', instance_id = $1, approved_by = $2, approved_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [instance.instance_id, req.user.user_id, req_row.id]
      );

      challanItems.push({
        part_request_id: req_row.id,
        part_id: req_row.part_id,
        instance_id: instance.instance_id,
        prt_id: instance.prt_id,
        part_name: req_row.part_name,
        quantity: req_row.quantity,
        unit_cost: Number(instance.unit_cost || req_row.unit_cost || 0),
      });
    }

    // Create the challan
    const challanNumber = await nextSpcNumber();
    const challanRes = await client.query(
      `INSERT INTO support_part_challans
         (challan_number, support_ticket_id, ttspl_id, issued_to, issued_by, status)
       VALUES ($1,$2,$3,$4,$5,'draft')
       RETURNING *`,
      [challanNumber, ticketId, ttsplId || null, techId, req.user.user_id]
    );
    const challan = challanRes.rows[0];

    // Insert challan items
    for (const item of challanItems) {
      await client.query(
        `INSERT INTO support_challan_items
           (challan_id, part_request_id, part_id, instance_id, prt_id,
            part_name, quantity, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [challan.id, item.part_request_id, item.part_id, item.instance_id,
         item.prt_id, item.part_name, item.quantity, item.unit_cost]
      );
      // Link challan back to request
      await client.query(
        `UPDATE support_part_requests SET challan_id = $1, status = 'challan_generated',
           updated_at = NOW() WHERE id = $2`,
        [challan.id, item.part_request_id]
      );
    }

    await client.query('COMMIT');

    // Generate PDF async (non-blocking)
    generateChallanPdf(challan.id, challanNumber).catch((e) =>
      console.error('challan PDF error:', e.message)
    );

    res.status(201).json({
      success: true,
      challan_id: challan.id,
      challan_number: challanNumber,
      items: challanItems,
      message: `Challan ${challanNumber} created. Technician must come to sign.`
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── TECHNICIAN: E-SIGN CHALLAN → ISSUE PARTS ─────────────────────────────────

/**
 * POST /api/support-parts/challans/:challanId/sign-and-issue
 * Role: warehouse (captures tech signature), support_tech (self-sign)
 * Body: { esign_data: 'data:image/png;base64,...', signer_name: 'Amit Kaur' }
 */
exports.signAndIssueChallan = async (req, res) => {
  const challanId = parseInt(req.params.challanId, 10);
  const { esign_data, signer_name } = req.body;

  if (!esign_data?.startsWith('data:image'))
    return res.status(400).json({ success: false, message: 'e-sign image required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const chalRes = await client.query(
      `SELECT sc.*, u.name AS tech_name
       FROM support_part_challans sc
       JOIN users u ON u.user_id = sc.issued_to
       WHERE sc.id = $1 FOR UPDATE`,
      [challanId]
    );
    if (!chalRes.rows.length)
      throw Object.assign(new Error('Challan not found'), { status: 404 });
    const challan = chalRes.rows[0];

    if (!['draft', 'challan_generated'].includes(challan.status))
      throw new Error(`Challan is already ${challan.status}`);

    // Save e-sign
    const esignUrl = saveEsignFile(esign_data, `challan_${challan.challan_number}`);

    // Update challan — mark issued
    await client.query(
      `UPDATE support_part_challans SET
         tech_esign_url = $1, tech_esign_at = NOW(), tech_esign_name = $2,
         issued_by = $3, issued_at = NOW(), status = 'issued', updated_at = NOW()
       WHERE id = $4`,
      [esignUrl, signer_name || challan.tech_name, req.user.user_id, challanId]
    );

    // Move all part_instances from 'reserved' → 'with_technician'
    // Move all requests from 'challan_generated' → 'issued'
    const itemsRes = await client.query(
      'SELECT * FROM support_challan_items WHERE challan_id = $1', [challanId]
    );
    for (const item of itemsRes.rows) {
      if (item.instance_id) {
        await client.query(
          `UPDATE part_instances SET status = 'with_technician', updated_at = NOW()
           WHERE instance_id = $1`,
          [item.instance_id]
        );
        // Decrement parts.quantity
        await client.query(
          `UPDATE parts SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
           WHERE part_id = $2`,
          [item.quantity, item.part_id]
        );
      }
      await client.query(
        `UPDATE support_part_requests SET status = 'issued', issued_at = NOW(),
           updated_at = NOW() WHERE id = $1`,
        [item.part_request_id]
      );
    }

    // Regenerate PDF with e-sign embedded
    generateChallanPdf(challanId, challan.challan_number, esignUrl).catch(console.error);

    await client.query('COMMIT');
    res.json({
      success: true,
      challan_number: challan.challan_number,
      message: 'Parts issued to technician. Challan signed.'
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── MARK PART AS USED ─────────────────────────────────────────────────────────

/**
 * PATCH /api/support-parts/requests/:requestId/mark-used
 * Role: support_tech (own), support_lead, admin
 */
exports.markPartUsed = async (req, res) => {
  const reqId = parseInt(req.params.requestId, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT * FROM support_part_requests WHERE id = $1 FOR UPDATE', [reqId]
    );
    if (!r.rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });
    const spr = r.rows[0];

    if (spr.assigned_to_tech !== req.user.user_id && !['admin','support_lead','manager'].includes(req.user.role))
      throw Object.assign(new Error('Not authorised'), { status: 403 });
    if (spr.status !== 'issued')
      throw new Error(`Cannot mark used: status is '${spr.status}'`);

    await client.query(
      `UPDATE support_part_requests SET status='used', used_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [reqId]
    );
    if (spr.instance_id) {
      await client.query(
        `UPDATE part_instances SET status='installed',
           installed_ttspl_id=$1, installed_ticket_id=NULL, installed_at=NOW(), updated_at=NOW()
         WHERE instance_id=$2`,
        [spr.ttspl_id, spr.instance_id]
      );
    }
    // Update challan item
    await client.query(
      `UPDATE support_challan_items SET return_status='used' WHERE part_request_id=$1`, [reqId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Part marked as used on laptop.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── RETURN PART: TECHNICIAN GOES TO WAREHOUSE ─────────────────────────────────

/**
 * POST /api/support-parts/requests/:requestId/return
 * Body: { method: 'self' | 'pickup_request', esign_data?, signer_name? }
 *
 * method='self'           → tech brings part; warehouse e-signs acceptance
 * method='pickup_request' → warehouse will collect from tech
 */
exports.returnPart = async (req, res) => {
  const reqId = parseInt(req.params.requestId, 10);
  const { method, esign_data, signer_name } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT * FROM support_part_requests WHERE id=$1 FOR UPDATE', [reqId]
    );
    if (!r.rows.length) throw Object.assign(new Error('Not found'), { status: 404 });
    const spr = r.rows[0];

    if (!['issued','return_requested'].includes(spr.status))
      throw new Error(`Cannot return: status is '${spr.status}'`);

    if (method === 'pickup_request') {
      // Mark return requested — warehouse will collect
      await client.query(
        `UPDATE support_part_requests SET status='return_requested',
           return_requested_at=NOW(), updated_at=NOW() WHERE id=$1`, [reqId]
      );
      await client.query(
        `UPDATE support_challan_items SET return_status='held' WHERE part_request_id=$1`, [reqId]
      );
      await client.query('COMMIT');
      return res.json({ success: true, message: 'Return request raised. Warehouse will collect.' });
    }

    // method='self' — tech is at warehouse, warehouse e-signs
    if (!esign_data?.startsWith('data:image'))
      throw new Error('Warehouse e-sign required to confirm return');

    const whEsignUrl = saveEsignFile(esign_data, `return_${spr.request_number}`);

    // Move instance back to in_stock
    if (spr.instance_id) {
      await client.query(
        `UPDATE part_instances SET status='in_stock', installed_ttspl_id=NULL,
           removed_at=NOW(), condition_on_removal='good', updated_at=NOW()
         WHERE instance_id=$1`,
        [spr.instance_id]
      );
      await client.query(
        `UPDATE parts SET quantity=quantity+$1, updated_at=NOW() WHERE part_id=$2`,
        [spr.quantity, spr.part_id]
      );
    }

    await client.query(
      `UPDATE support_part_requests SET status='returned', returned_at=NOW(),
         returned_to=$1, updated_at=NOW() WHERE id=$2`,
      [req.user.user_id, reqId]
    );
    await client.query(
      `UPDATE support_challan_items SET return_status='returned' WHERE part_request_id=$1`, [reqId]
    );

    // Update challan with warehouse e-sign
    if (spr.challan_id) {
      await client.query(
        `UPDATE support_part_challans SET
           wh_esign_url=$1, wh_esign_at=NOW(), wh_esign_name=$2,
           updated_at=NOW()
         WHERE id=$3`,
        [whEsignUrl, signer_name || req.user.name, spr.challan_id]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Part returned to warehouse. Stock updated.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── WAREHOUSE: ACCEPT RETURN (when pickup method) ─────────────────────────────

/**
 * PATCH /api/support-parts/requests/:requestId/accept-return
 * Role: warehouse, admin
 * Body: { esign_data?, signer_name? }
 */
exports.acceptReturn = async (req, res) => {
  // Same as returnPart with method='self' but called by warehouse side
  req.body.method = 'self';
  return exports.returnPart(req, res);
};

// ── TECHNICIAN BUCKET ─────────────────────────────────────────────────────────

/**
 * GET /api/support-parts/bucket
 * Returns all parts currently 'issued' (with technicians)
 * Manager/lead: all technicians; tech: only own
 */
exports.getTechnicianBucket = async (req, res) => {
  const isTech = req.user.role === 'support_tech';
  const techFilter = isTech ? `AND spr.assigned_to_tech = ${req.user.user_id}` : '';

  const { rows } = await pool.query(`
    SELECT spr.*,
           p.part_name, p.category, p.location_code,
           pi.prt_id, pi.location_code AS instance_location,
           u.name AS tech_name, u.email AS tech_email,
           st.customer_name, st.ticket_number,
           spc.challan_number, spc.pdf_path
    FROM support_part_requests spr
    JOIN parts p ON p.part_id = spr.part_id
    LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
    JOIN users u ON u.user_id = spr.assigned_to_tech
    JOIN support_tickets st ON st.id = spr.support_ticket_id
    LEFT JOIN support_part_challans spc ON spc.id = spr.challan_id
    WHERE spr.status IN ('issued','return_requested')
    ${techFilter}
    ORDER BY spr.issued_at DESC
  `);

  // Group by technician
  const grouped = {};
  rows.forEach((r) => {
    const key = r.assigned_to_tech;
    if (!grouped[key]) grouped[key] = { tech_id: key, tech_name: r.tech_name, parts: [] };
    grouped[key].parts.push(r);
  });

  res.json({ success: true, bucket: Object.values(grouped), total: rows.length });
};

// ── GET CHALLAN ───────────────────────────────────────────────────────────────

/**
 * GET /api/support-parts/challans/:challanId
 */
exports.getChallan = async (req, res) => {
  const challanId = parseInt(req.params.challanId, 10);
  const challanRes = await pool.query(
    `SELECT sc.*, u.name AS tech_name, u.email AS tech_email,
            ist.name AS issued_by_name,
            st.customer_name, st.ticket_number
     FROM support_part_challans sc
     JOIN users u ON u.user_id = sc.issued_to
     LEFT JOIN users ist ON ist.user_id = sc.issued_by
     JOIN support_tickets st ON st.id = sc.support_ticket_id
     WHERE sc.id = $1`,
    [challanId]
  );
  if (!challanRes.rows.length)
    return res.status(404).json({ success: false, message: 'Challan not found' });

  const items = await pool.query(
    'SELECT * FROM support_challan_items WHERE challan_id = $1', [challanId]
  );

  res.json({ success: true, challan: challanRes.rows[0], items: items.rows });
};

// ── GET WAREHOUSE QUEUE ───────────────────────────────────────────────────────

/**
 * GET /api/support-parts/warehouse-queue
 */
exports.getWarehouseQueue = async (req, res) => {
  const { rows } = await pool.query(`
    SELECT spr.*,
           p.part_name, p.category, p.quantity AS stock_qty,
           p.location_code, p.cost AS unit_cost,
           pi_count.available AS instances_available,
           u.name AS tech_name,
           st.customer_name, st.ticket_number
    FROM support_part_requests spr
    JOIN parts p ON p.part_id = spr.part_id
    LEFT JOIN (
      SELECT part_id, COUNT(*) AS available
      FROM part_instances WHERE status='in_stock' GROUP BY part_id
    ) pi_count ON pi_count.part_id = p.part_id
    JOIN users u ON u.user_id = spr.assigned_to_tech
    JOIN support_tickets st ON st.id = spr.support_ticket_id
    WHERE spr.status IN ('pending','return_requested')
    ORDER BY spr.created_at ASC
  `);

  const pending  = rows.filter((r) => r.status === 'pending');
  const returns  = rows.filter((r) => r.status === 'return_requested');
  res.json({ success: true, pending, returns, total: rows.length });
};
```

---

## SECTION 3 — CHALLAN PDF GENERATOR

### Create `backend/services/supportPartChallanPdfService.js`

```javascript
'use strict';
const fs   = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'support-parts');
const C = {
  accent: '#E64C1E',     // Rentfoxxy brand orange
  ink:    '#1A1A2E',     // dark navy text
  sub:    '#6B7280',     // gray
  line:   '#E5E7EB',     // light border
  green:  '#059669',
  white:  '#FFFFFF',
};

/**
 * Generates (or regenerates) the PDF for a support part challan.
 * If esignUrl is provided, embeds the e-sign image.
 * Saves to uploads/support-parts/SPC-XXXX.pdf
 * Updates support_part_challans.pdf_path in DB.
 */
async function generateChallanPdf(challanId, challanNumber, esignUrl = null) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fileName = `${challanNumber.replace(/[^\w-]/g, '_')}.pdf`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relPath  = `uploads/support-parts/${fileName}`;

  // Load challan + items + company
  const chalRes = await pool.query(
    `SELECT sc.*, u.name AS tech_name, u.email AS tech_email,
            st.customer_name, st.ticket_number, st.id AS ticket_id
     FROM support_part_challans sc
     JOIN users u ON u.user_id = sc.issued_to
     JOIN support_tickets st ON st.id = sc.support_ticket_id
     WHERE sc.id = $1`, [challanId]
  );
  if (!chalRes.rows.length) throw new Error('Challan not found');
  const ch = chalRes.rows[0];

  const items = await pool.query(
    'SELECT * FROM support_challan_items WHERE challan_id = $1 ORDER BY id', [challanId]
  );

  const company = await pool.query(
    `SELECT * FROM companies WHERE code = 'rentfoxxy' LIMIT 1`
  );
  const co = company.rows[0] || {};

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    const L = 40, R = 555, W = R - L;
    let y = 40;

    // ── HEADER BAND ────────────────────────────────────────────────────────
    // Logo / brand
    const logoAbs = co.logo_url
      ? path.join(__dirname, '..', co.logo_url.replace(/^\//, ''))
      : null;
    let logoDrawn = false;
    if (logoAbs && fs.existsSync(logoAbs)) {
      try { doc.image(logoAbs, L, y, { height: 36 }); logoDrawn = true; } catch (_) {}
    }
    if (!logoDrawn) {
      doc.fillColor(C.accent).font('Helvetica-Bold').fontSize(20).text('RENTFOXXY', L, y + 6);
    }

    // Challan number (right side)
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(14)
       .text(ch.challan_number, R - 150, y, { width: 150, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
       .text('Support Part Challan', R - 150, y + 18, { width: 150, align: 'right' });

    y += 50;

    // Company details
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink)
       .text(co.legal_name || 'TRUETECH SERVICES PRIVATE LIMITED', L, y);
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
       .text(`GSTIN: ${co.gstin || '06AAHCT0310N1ZG'}`, L, y);
    y += 11;
    doc.text(co.address || '429, 4th Floor, JMD Megapolis, Sohna Road, Gurgaon', L, y, { width: W / 2 });
    y += 11;
    doc.text(`Email: ${co.email || 'accounts@truetechservices.in'}`, L, y);
    y += 20;

    // Divider
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 12;

    // ── INFO ROW ───────────────────────────────────────────────────────────
    // Left col: ticket + laptop
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('SUPPORT TICKET', L, y);
    doc.font('Helvetica').fontSize(9).fillColor(C.sub)
       .text(`#${ch.ticket_id} — ${ch.customer_name || ''}`, L, y + 11);

    if (ch.ttspl_id) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
         .text('LAPTOP (TTSPL)', L, y + 26);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(C.accent)
         .text(ch.ttspl_id, L, y + 37);
    }

    // Right col: issued to + date
    const rCol = L + W / 2 + 20;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('ISSUED TO', rCol, y);
    doc.font('Helvetica').fontSize(10).fillColor(C.ink).text(ch.tech_name, rCol, y + 11);
    doc.font('Helvetica').fontSize(8).fillColor(C.sub).text(ch.tech_email || '', rCol, y + 23);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('DATE', rCol, y + 37);
    doc.font('Helvetica').fontSize(9).fillColor(C.sub)
       .text(
         ch.issued_at
           ? new Date(ch.issued_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
           : new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }),
         rCol, y + 48
       );

    y += 70;

    // ── PARTS TABLE ────────────────────────────────────────────────────────
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).lineWidth(1).stroke();
    y += 8;

    // Header row
    const cols = {
      prt:  { x: L,       w: 120, label: 'PRT-ID' },
      name: { x: L+125,   w: 160, label: 'Part Name' },
      qty:  { x: L+290,   w: 50,  label: 'Qty' },
      cost: { x: L+345,   w: 80,  label: 'Unit Cost' },
      total:{ x: L+430,   w: 85,  label: 'Total' },
    };
    Object.values(cols).forEach(({ x, w, label }) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.sub)
         .text(label.toUpperCase(), x, y, { width: w });
    });
    y += 14;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(C.line).stroke();
    y += 8;

    let grandTotal = 0;
    items.rows.forEach((item) => {
      const total = Number(item.unit_cost || 0) * Number(item.quantity || 1);
      grandTotal += total;
      const rowY = y;

      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.accent)
         .text(item.prt_id || '—', cols.prt.x, rowY, { width: cols.prt.w });
      doc.font('Helvetica').fontSize(9).fillColor(C.ink)
         .text(item.part_name || '—', cols.name.x, rowY, { width: cols.name.w });
      doc.font('Helvetica').fontSize(9).fillColor(C.ink)
         .text(String(item.quantity), cols.qty.x, rowY, { width: cols.qty.w, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor(C.sub)
         .text(`₹${Number(item.unit_cost || 0).toFixed(2)}`, cols.cost.x, rowY, { width: cols.cost.w, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
         .text(`₹${total.toFixed(2)}`, cols.total.x, rowY, { width: cols.total.w, align: 'right' });

      y += 18;
      doc.moveTo(L, y - 4).lineTo(R, y - 4).strokeColor(C.line).lineWidth(0.5).stroke();
    });

    // Grand total
    y += 4;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink)
       .text(`Total Value: ₹${grandTotal.toFixed(2)}`, R - 140, y, { width: 140, align: 'right' });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.sub)
       .text('(Parts are company property. Return unused parts.)', L, y + 1, { width: W - 150 });
    y += 22;

    // ── TERMS BOX ──────────────────────────────────────────────────────────
    doc.rect(L, y, W, 36).fillAndStroke('#FFF7ED', '#FED7AA');
    doc.fillColor('#92400E').font('Helvetica-Bold').fontSize(8)
       .text('TERMS & CONDITIONS', L + 8, y + 6, { width: W - 16 });
    doc.font('Helvetica').fontSize(7.5)
       .text(
         '1. These parts are issued for the support visit only and remain property of Rentfoxxy.\n' +
         '2. Unused parts must be returned to warehouse within 24 hours of visit completion.\n' +
         '3. Lost/damaged parts will be recovered from the technician.',
         L + 8, y + 16, { width: W - 16 }
       );
    y += 48;

    // ── SIGNATURE SECTION ──────────────────────────────────────────────────
    const sigBoxW = (W - 20) / 2;

    // Left: Technician signature
    doc.rect(L, y, sigBoxW, 80).strokeColor(C.line).lineWidth(1).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
       .text('Technician Signature (Received parts)', L + 8, y + 6, { width: sigBoxW - 16 });

    if (esignUrl || ch.tech_esign_url) {
      const esignPath = path.join(__dirname, '..', (esignUrl || ch.tech_esign_url).replace(/^\//, ''));
      if (fs.existsSync(esignPath)) {
        try {
          doc.image(esignPath, L + 10, y + 18, { fit: [sigBoxW - 20, 44], align: 'center' });
        } catch (_) {}
      }
    } else {
      // Empty sign box
      doc.fillColor(C.line).fontSize(8)
         .text('[ Sign here ]', L + 8, y + 36, { width: sigBoxW - 16, align: 'center' });
    }

    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink)
       .text(ch.tech_name, L + 8, y + 66, { width: sigBoxW - 16 });

    // Right: Warehouse signature
    const rSigX = L + sigBoxW + 20;
    doc.rect(rSigX, y, sigBoxW, 80).strokeColor(C.line).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(C.sub)
       .text('Warehouse Staff Signature (Issued)', rSigX + 8, y + 6, { width: sigBoxW - 16 });

    if (ch.wh_esign_url) {
      const whPath = path.join(__dirname, '..', ch.wh_esign_url.replace(/^\//, ''));
      if (fs.existsSync(whPath)) {
        try { doc.image(whPath, rSigX + 10, y + 18, { fit: [sigBoxW - 20, 44] }); }
        catch (_) {}
      }
    } else {
      doc.fillColor(C.line).fontSize(8)
         .text('[ Warehouse sign ]', rSigX + 8, y + 36, { width: sigBoxW - 16, align: 'center' });
    }

    const issuedByName = ch.issued_by_name || 'Warehouse Team';
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink)
       .text(issuedByName, rSigX + 8, y + 66, { width: sigBoxW - 16 });

    y += 92;

    // Footer
    doc.font('Helvetica').fontSize(7).fillColor(C.sub)
       .text(
         `Generated: ${new Date().toLocaleString('en-IN')} · ${ch.challan_number}`,
         L, y, { width: W, align: 'center' }
       );

    doc.end();
  });

  // Save PDF path to DB
  await pool.query(
    `UPDATE support_part_challans SET pdf_path = $1, updated_at = NOW() WHERE id = $2`,
    [relPath, challanId]
  );

  return relPath;
}

module.exports = { generateChallanPdf };
```

Update `supportPartsController.js` — add require at top:
```javascript
const { generateChallanPdf } = require('../services/supportPartChallanPdfService');
```

---

## SECTION 4 — BACKEND ROUTES

### Create `backend/routes/supportParts.js`

```javascript
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/supportPartsController');
const { authMiddleware } = require('../middleware/auth');

const requireWarehouse = (req, res, next) => {
  if (!['warehouse','admin','support_lead','manager'].includes(req.user?.role))
    return res.status(403).json({ success: false, message: 'Warehouse access required' });
  next();
};
const requireSupportOrWarehouse = (req, res, next) => {
  if (!['support_tech','support_lead','warehouse','admin','manager'].includes(req.user?.role))
    return res.status(403).json({ success: false, message: 'Not authorised' });
  next();
};

router.use(authMiddleware);

// Part requests
router.post('/requests',                        requireSupportOrWarehouse, ctrl.raiseSupportPartRequest);
router.get('/requests',                         requireSupportOrWarehouse, ctrl.listSupportPartRequests);
router.post('/requests/approve-and-challan',    requireWarehouse,          ctrl.approveAndGenerateChallan);
router.patch('/requests/:requestId/mark-used',  requireSupportOrWarehouse, ctrl.markPartUsed);
router.post('/requests/:requestId/return',      requireSupportOrWarehouse, ctrl.returnPart);
router.patch('/requests/:requestId/accept-return', requireWarehouse,       ctrl.acceptReturn);

// Challans
router.get('/challans/:challanId',              authMiddleware, ctrl.getChallan);
router.post('/challans/:challanId/sign-and-issue', requireSupportOrWarehouse, ctrl.signAndIssueChallan);

// Bucket
router.get('/bucket',                           authMiddleware, ctrl.getTechnicianBucket);

// Warehouse queue
router.get('/warehouse-queue',                  requireWarehouse, ctrl.getWarehouseQueue);

module.exports = router;
```

### Mount in `backend/server.js`

```javascript
app.use('/api/support-parts', require('./routes/supportParts'));
app.use('/uploads/support-parts', express.static(path.join(__dirname, 'uploads/support-parts')));
```

---

## SECTION 5 — FRONTEND: SUPPORT TECH PARTS FLOW

### 5A — New page: `SupportTechBucketPage.jsx`

Route: `/support/tech-bucket`
Access: support_tech (own), support_lead, manager, admin

```jsx
// Top: "MY PARTS BUCKET" — for tech
// For leads/managers: grouped by technician, filterable

// Per-tech group:
// ┌─ AMIT KAUR ────────────────────────────────────────────────────────────┐
// │ 2 parts on hand                                          [View Challan] │
// │                                                                         │
// │  PRT-20260619-0001  RAM 8GB DDR4        STK-0045  TTSPL0023  [Use] [Return] │
// │  PRT-20260619-0002  Thermal Paste       STK-0045  TTSPL0023  [Use] [Return] │
// └─────────────────────────────────────────────────────────────────────────┘
```

**Raise Part Request form (inside support ticket detail):**

```jsx
function RaisePartRequestForm({ ticket, item, onRaised }) {
  const [partId, setPartId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [parts, setParts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Fetch parts catalog
    fetch('/api/parts').then(r => r.json()).then(d => setParts(d.parts || []));
  }, []);

  const submit = async () => {
    setSaving(true);
    try {
      await fetch('/api/support-parts/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          support_ticket_id: ticket.id,
          support_item_id: item?.id,
          ttspl_id: item?.ttspl_id || item?.unique_serial_number,
          serial_number: item?.serial_number,
          part_id: Number(partId),
          quantity,
          reason,
        })
      });
      toast.success('Part request raised — awaiting warehouse approval');
      onRaised();
    } catch (e) {
      toast.error('Failed to raise request');
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3 p-4 bg-amber-50 rounded-2xl border border-amber-100">
      <p className="font-semibold text-amber-900 text-sm">🔧 Request a Part for this Visit</p>
      <p className="text-xs text-amber-700">Ticket: #{ticket.id} · {item?.ttspl_id}</p>

      <select value={partId} onChange={(e) => setPartId(e.target.value)}
        className="w-full border rounded-xl px-3 py-3 text-sm focus:ring-2 focus:ring-blue-500 bg-white">
        <option value="">Select part needed…</option>
        {parts.map((p) => (
          <option key={p.part_id} value={p.part_id}>
            {p.part_name} (Stock: {p.quantity})
          </option>
        ))}
      </select>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Quantity</label>
          <input type="number" min={1} max={5} value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="w-full border rounded-xl px-3 py-3 text-sm text-center" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 block mb-1">Reason (optional)</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Why do you need this part?"
            className="w-full border rounded-xl px-3 py-2.5 text-sm" />
        </div>
      </div>

      <button type="button" disabled={!partId || saving} onClick={submit}
        className="w-full py-3.5 bg-amber-600 text-white rounded-2xl font-semibold text-sm
          disabled:opacity-50 active:scale-[0.98]">
        {saving ? 'Raising request…' : 'Request Part from Warehouse'}
      </button>
    </div>
  );
}
```

### 5B — Warehouse Queue Page additions

In `PartsApprovalPage.jsx` or a new `SupportPartsQueuePage.jsx`, add a tab:

**"Support Part Requests"** tab:

```jsx
// Lists pending support_part_requests
// Groups by support ticket for context
// Batch approve + create challan:

function SupportPartQueueTab({ requests, onAction }) {
  const [selected, setSelected] = useState(new Set());

  const toggleSelect = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleApprove = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    // Validate all same tech + same ticket
    const sel = requests.filter(r => ids.includes(r.id));
    const tickets = [...new Set(sel.map(r => r.support_ticket_id))];
    const techs   = [...new Set(sel.map(r => r.assigned_to_tech))];
    if (tickets.length > 1) { toast.error('Select requests from same ticket only'); return; }
    if (techs.length > 1)   { toast.error('Select requests for same technician only'); return; }

    try {
      const res = await fetch('/api/support-parts/requests/approve-and-challan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_ids: ids })
      }).then(r => r.json());
      toast.success(`Challan ${res.challan_number} created`);
      onAction();
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-blue-50 rounded-xl px-4 py-3">
          <span className="text-sm text-blue-800 font-medium">
            {selected.size} request(s) selected
          </span>
          <button type="button" onClick={handleApprove}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold">
            Approve + Generate Challan
          </button>
        </div>
      )}

      {requests.map((req) => (
        <div key={req.id} className={`bg-white border rounded-xl p-4 cursor-pointer
          ${selected.has(req.id) ? 'border-blue-400 ring-1 ring-blue-300' : ''}`}
          onClick={() => toggleSelect(req.id)}>
          <div className="flex items-start gap-3">
            <input type="checkbox" checked={selected.has(req.id)}
              onChange={() => toggleSelect(req.id)}
              className="mt-1 rounded" onClick={(e) => e.stopPropagation()} />
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-blue-700 font-medium">{req.request_number}</span>
                {req.ttspl_id && (
                  <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{req.ttspl_id}</span>
                )}
              </div>
              <p className="font-semibold text-gray-900 mt-1">{req.part_name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Qty: {req.quantity} · For: {req.tech_name}
                {req.customer_name && ` · Customer: ${req.customer_name}`}
              </p>
              {req.reason && (
                <p className="text-xs text-gray-400 italic mt-0.5">"{req.reason}"</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  Number(req.instances_available) > 0
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {Number(req.instances_available) > 0
                    ? `In Stock: ${req.instances_available}`
                    : 'Out of Stock'}
                </span>
                {req.location_code && (
                  <span className="text-xs text-gray-400">📍 {req.location_code}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

### 5C — Challan view + E-Sign modal

```jsx
// ChallanViewPage.jsx — shown to both tech and warehouse
// Route: /support/challans/:challanId

function ChallanViewPage() {
  const { challanId } = useParams();
  const [challan, setChallan] = useState(null);
  const [items, setItems] = useState([]);
  const [showSign, setShowSign] = useState(false);
  const [signMode, setSignMode] = useState('tech'); // 'tech' | 'warehouse'

  // Load challan
  useEffect(() => {
    fetch(`/api/support-parts/challans/${challanId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setChallan(d.challan); setItems(d.items); });
  }, [challanId]);

  if (!challan) return <div>Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-4">
      {/* Challan header */}
      <div className="bg-white rounded-2xl border p-5 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono font-bold text-blue-700 text-lg">{challan.challan_number}</p>
            <p className="text-xs text-gray-500 mt-0.5">Support Part Challan</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${
            challan.status === 'issued' ? 'bg-green-100 text-green-800' :
            challan.status === 'draft'  ? 'bg-amber-100 text-amber-800' :
            'bg-gray-100 text-gray-700'
          }`}>{challan.status}</span>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <p className="text-xs text-gray-400">Issued To</p>
            <p className="font-semibold text-sm">{challan.tech_name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Support Ticket</p>
            <p className="font-semibold text-sm">#{challan.ticket_id}</p>
            <p className="text-xs text-gray-500">{challan.customer_name}</p>
          </div>
          {challan.ttspl_id && (
            <div>
              <p className="text-xs text-gray-400">Laptop (TTSPL)</p>
              <p className="font-mono font-bold text-sm text-blue-700">{challan.ttspl_id}</p>
            </div>
          )}
          {challan.issued_at && (
            <div>
              <p className="text-xs text-gray-400">Issued At</p>
              <p className="text-sm">{new Date(challan.issued_at).toLocaleString('en-IN')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Parts table */}
      <div className="bg-white rounded-2xl border p-4 mb-4">
        <p className="font-semibold text-sm text-gray-900 mb-3">Parts in this Challan</p>
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <p className="font-mono text-xs text-blue-700">{item.prt_id}</p>
                <p className="font-medium text-sm">{item.part_name}</p>
                <p className="text-xs text-gray-400">Qty: {item.quantity}</p>
              </div>
              <div className="text-right">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  item.return_status === 'used'     ? 'bg-green-100 text-green-700' :
                  item.return_status === 'returned' ? 'bg-gray-100 text-gray-600' :
                  'bg-blue-100 text-blue-700'
                }`}>{item.return_status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Signatures section */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Tech signature */}
        <div className="bg-white rounded-2xl border p-4">
          <p className="text-xs text-gray-500 mb-2">Technician Signature</p>
          {challan.tech_esign_url ? (
            <img src={`/${challan.tech_esign_url}`} alt="Tech sign" className="w-full max-h-24 object-contain" />
          ) : (
            <div className="h-16 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center">
              <p className="text-xs text-gray-300">Not signed</p>
            </div>
          )}
          {challan.tech_esign_at && (
            <p className="text-[10px] text-gray-400 mt-1">
              {new Date(challan.tech_esign_at).toLocaleString('en-IN')}
            </p>
          )}
        </div>

        {/* Warehouse signature */}
        <div className="bg-white rounded-2xl border p-4">
          <p className="text-xs text-gray-500 mb-2">Warehouse Signature</p>
          {challan.wh_esign_url ? (
            <img src={`/${challan.wh_esign_url}`} alt="WH sign" className="w-full max-h-24 object-contain" />
          ) : (
            <div className="h-16 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center">
              <p className="text-xs text-gray-300">Not signed</p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {challan.status === 'draft' && (
          <button type="button" onClick={() => { setSignMode('tech'); setShowSign(true); }}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-base active:scale-[0.98]">
            ✍️ Sign Challan (Technician)
          </button>
        )}
        {challan.pdf_path && (
          <a href={`/${challan.pdf_path}`} target="_blank" rel="noopener noreferrer"
            className="block w-full py-3.5 border-2 border-blue-200 text-blue-700 rounded-2xl
              font-semibold text-sm text-center hover:bg-blue-50">
            📄 View / Download PDF
          </a>
        )}
      </div>

      {/* E-Sign Modal */}
      {showSign && (
        <ESignChallanModal
          challan={challan}
          mode={signMode}
          onSigned={() => { setShowSign(false); window.location.reload(); }}
          onClose={() => setShowSign(false)}
        />
      )}
    </div>
  );
}

function ESignChallanModal({ challan, mode, onSigned, onClose }) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [signerName, setSignerName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    import('signature_pad').then(({ default: SignaturePad }) => {
      if (canvasRef.current) {
        padRef.current = new SignaturePad(canvasRef.current, {
          backgroundColor: 'rgb(255,255,255)',
          penColor: '#1A1A2E',
          minWidth: 1.5,
          maxWidth: 3,
        });
      }
    });
  }, []);

  const clear = () => padRef.current?.clear();

  const save = async () => {
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error('Please sign before saving');
      return;
    }
    if (!signerName.trim()) {
      toast.error('Please enter your name');
      return;
    }
    setSaving(true);
    try {
      const dataUrl = padRef.current.toDataURL('image/png');
      await fetch(`/api/support-parts/challans/${challan.id}/sign-and-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ esign_data: dataUrl, signer_name: signerName.trim() })
      }).then(r => r.json());
      toast.success('Signed! Parts issued to technician.');
      onSigned();
    } catch { toast.error('Sign failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50">
      <div className="bg-white rounded-t-3xl w-full max-w-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-gray-900">
            {mode === 'tech' ? '✍️ Technician Sign — Parts Receipt' : '✍️ Warehouse Sign — Issue Confirmation'}
          </p>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">✕</button>
        </div>

        <p className="text-xs text-gray-500 mb-3">
          Challan: <strong>{challan.challan_number}</strong> ·
          {mode === 'tech'
            ? ' Sign to confirm you have received the listed parts.'
            : ' Sign to confirm you have issued the listed parts.'}
        </p>

        {/* Name input */}
        <input type="text" value={signerName} onChange={(e) => setSignerName(e.target.value)}
          placeholder="Enter your full name*"
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-3
            focus:ring-2 focus:ring-blue-500 outline-none" />

        {/* Signature canvas */}
        <div className="border-2 border-gray-200 rounded-xl overflow-hidden mb-3">
          <p className="text-xs text-gray-400 px-3 pt-2 text-center">Sign below using finger or stylus</p>
          <canvas
            ref={canvasRef}
            width={500}
            height={160}
            className="w-full touch-none bg-white block"
            style={{ touchAction: 'none' }}
          />
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={clear}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium">
            Clear
          </button>
          <button type="button" onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-sm">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving}
            className="flex-2 flex-grow py-3 bg-blue-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">
            {saving ? 'Saving…' : 'Confirm Sign'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## SECTION 6 — API FRONTEND ADDITIONS

Add to `frontend/src/features/support/supportApi.js` (or create it):

```javascript
const BASE = '/api/support-parts';

export const raiseSupportPartRequest = (data) =>
  api.post(`${BASE}/requests`, data);

export const listSupportPartRequests = (params) =>
  api.get(`${BASE}/requests`, { params });

export const approveAndGenerateChallan = (requestIds) =>
  api.post(`${BASE}/requests/approve-and-challan`, { request_ids: requestIds });

export const markPartUsed = (requestId) =>
  api.patch(`${BASE}/requests/${requestId}/mark-used`);

export const returnPart = (requestId, data) =>
  api.post(`${BASE}/requests/${requestId}/return`, data);

export const acceptReturn = (requestId, data) =>
  api.patch(`${BASE}/requests/${requestId}/accept-return`, data);

export const getChallan = (challanId) =>
  api.get(`${BASE}/challans/${challanId}`);

export const signAndIssueChallan = (challanId, data) =>
  api.post(`${BASE}/challans/${challanId}/sign-and-issue`, data);

export const getTechnicianBucket = () =>
  api.get(`${BASE}/bucket`);

export const getSupportPartsWarehouseQueue = () =>
  api.get(`${BASE}/warehouse-queue`);
```

---

## SECTION 7 — SIDEBAR ADDITIONS

In `frontend/src/config/menuConfig.js`, Support section:

```javascript
{ label: 'Support Tickets',   path: '/support/tickets',    section: 'support' },
{ label: 'My Parts Bucket',   path: '/support/tech-bucket', section: 'support_part_requests',
  icon: Package },
{ label: 'Support Part Queue', path: '/support/parts-queue', section: 'support_part_challan',
  icon: ClipboardList },
```

Count badge for Support Part Queue: number of pending support part requests.

---

## SECTION 8 — BUILD ORDER

1. Run migration `098_support_parts_bucket.sql`
2. Create `backend/services/supportPartChallanPdfService.js`
3. Create `backend/controllers/supportPartsController.js`
4. Create `backend/routes/supportParts.js`
5. Mount route + static files in `backend/server.js`
6. Frontend: create `supportPartsApi.js`
7. Frontend: add `RaisePartRequestForm` inside `SupportTechItemCard`
8. Frontend: create `SupportTechBucketPage.jsx`
9. Frontend: create `SupportPartsQueuePage.jsx` (warehouse queue)
10. Frontend: create `ChallanViewPage.jsx` with e-sign modal
11. Frontend: install `signature_pad` if not already installed
12. Frontend: update `menuConfig.js` sidebar
13. Frontend: add routes

---

## SECTION 9 — QUALITY CHECKLIST

Part Request:
  [ ] Tech can raise request from inside a support ticket
  [ ] Part selector shows stock count next to each part name
  [ ] Request number auto-generated: SPR-0001
  [ ] Ticket ID and TTSPL ID shown on request
  [ ] Warehouse sees pending request with: Tech name, Ticket, TTSPL, Part, Qty, Stock

Challan + Approve:
  [ ] Warehouse selects one or more requests (same ticket, same tech) → Approve
  [ ] Challan auto-created: SPC-20260619-0001
  [ ] Part instances moved from 'in_stock' → 'reserved'
  [ ] PDF auto-generated on challan creation
  [ ] PDF has: company logo + GSTIN, challan number, technician details, TTSPL, parts table, two sign boxes

E-Sign:
  [ ] Tech/warehouse opens ChallanViewPage → sees sign button
  [ ] Signature pad works with touch on mobile
  [ ] Name input required before sign
  [ ] Sign saves as PNG file (uploads/support-parts/challan_SPC-XXXX_esign_timestamp.png)
  [ ] PDF regenerated with e-sign embedded in signature box
  [ ] Part instances move: 'reserved' → 'with_technician'
  [ ] parts.quantity decremented by issued qty

Technician Bucket:
  [ ] Tech sees only their own parts
  [ ] Manager/lead sees all techs grouped
  [ ] Each part shows: PRT-ID, Part name, Ticket ref, TTSPL, Challan number, [Use] [Return]
  [ ] "Mark Used" → instance status → 'installed'
  [ ] "Return" → two options: "Bring to warehouse" / "Request pickup"

Return — Self:
  [ ] Tech brings part → warehouse e-signs acceptance
  [ ] Warehouse sign saved as PNG
  [ ] Instance status → 'in_stock'
  [ ] parts.quantity incremented

Return — Pickup Request:
  [ ] Tech clicks "Request Pickup" → status → 'return_requested'
  [ ] Warehouse sees return requests in their queue tab
  [ ] Warehouse accepts → instance → 'in_stock'

PDF Quality:
  [ ] Company name + GSTIN at top
  [ ] Logo displayed (Rentfoxxy)
  [ ] Challan number prominent (top right)
  [ ] Parts table with PRT-ID, name, qty, cost, total
  [ ] Grand total shown
  [ ] Terms box (orange background)
  [ ] Two signature boxes (left: tech, right: warehouse)
  [ ] E-sign image embedded in tech signature box when signed
  [ ] Footer with generation timestamp
  [ ] Download link works: GET /uploads/support-parts/SPC-XXXX.pdf
