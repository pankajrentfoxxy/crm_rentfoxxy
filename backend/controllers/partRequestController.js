/**
 * Part Request Controller (Phase 16)
 *
 * Flow: floor raises request -> warehouse approves (reserves a PRT instance)
 *       OR escalates to procurement -> SPO -> received -> approved
 *       -> technician attaches part (config update for upgrades) + returns old
 *       -> ticket unblocked -> expense tracked per laptop.
 */
const pool = require('../config/db');
const { generatePrqNumber, generatePrtId } = require('../services/partIdService');
const { logTtsplEvent, logConfigChange, resolveTtsplAsset } = require('../services/ttsplAuditService');
const { recordMovement, MOVEMENT } = require('../services/partMovementService');
const { createReturnedPartInstance, normalizeCategory } = require('../services/partInventoryService');
const productionAssetService = require('../services/productionAssetService');

const FULL_SELECT = `
  SELECT pr.*,
         COALESCE(pr.part_name, p.part_name) AS part_name,
         p.category, p.part_type, p.cost AS catalog_cost, p.quantity AS stock_qty,
         p.model_number AS catalog_model_number, p.pin_size AS catalog_pin_size,
         pi.prt_id, pi.serial_number AS instance_serial, pi.asset_code AS instance_asset_code,
         pi.location_code, pi.status AS instance_status, pi.unit_cost AS instance_cost,
         op.part_name AS old_part_catalog_name, op.category AS old_part_catalog_category,
         opi.prt_id AS old_part_prt_id,
         t.ttspl_id, t.brand, t.model, t.processor, t.ram, t.storage,
         t.vendor_serial_id, t.current_stage_id,
         st.stage_name,
         u.name AS requester_name,
         au.name AS approver_name,
         spo.purchase_order_number AS spo_number
    FROM part_requests pr
    LEFT JOIN parts p              ON p.part_id = pr.part_id
    LEFT JOIN part_instances pi    ON pi.instance_id = pr.instance_id
    LEFT JOIN parts op             ON op.part_id = pr.old_part_part_id
    LEFT JOIN part_instances opi   ON opi.instance_id = pr.old_part_instance_id
    LEFT JOIN tickets t            ON t.ticket_id = pr.ticket_id
    LEFT JOIN stages st            ON st.stage_id = COALESCE(pr.ticket_stage_id, t.current_stage_id)
    LEFT JOIN users u              ON u.user_id = pr.requested_by
    LEFT JOIN users au             ON au.user_id = pr.approved_by
    LEFT JOIN vendor_spare_parts_purchase_orders spo ON spo.spo_id = pr.spo_id
`;

const PRIVILEGED = ['admin', 'manager', 'super_admin'];

let partsSpecEnsured = false;
async function ensurePartsSpecColumns(db) {
  if (partsSpecEnsured) return;
  await db.query(`
    ALTER TABLE parts ADD COLUMN IF NOT EXISTS model_number VARCHAR(120);
    ALTER TABLE parts ADD COLUMN IF NOT EXISTS pin_size VARCHAR(60);
    ALTER TABLE part_requests ADD COLUMN IF NOT EXISTS battery_model_number VARCHAR(120);
    ALTER TABLE part_requests ADD COLUMN IF NOT EXISTS battery_photos JSONB;
  `);
  partsSpecEnsured = true;
}

let serialColEnsured = false;
/**
 * Columns the part-tracking reads depend on. Migration 178 adds these properly
 * (with the ledger and backfill); this only keeps the read paths working on an
 * environment where it has not run yet.
 */
async function ensurePartInstanceSerialColumn(db) {
  if (serialColEnsured) return;
  await db.query(`
    ALTER TABLE part_instances ADD COLUMN IF NOT EXISTS serial_number VARCHAR(255);
    ALTER TABLE part_instances ADD COLUMN IF NOT EXISTS asset_code VARCHAR(64);
    ALTER TABLE part_instances ADD COLUMN IF NOT EXISTS vendor_id INT;
    ALTER TABLE part_instances ADD COLUMN IF NOT EXISTS source VARCHAR(24) NOT NULL DEFAULT 'purchase';
    ALTER TABLE part_instances ADD COLUMN IF NOT EXISTS removed_from_ttspl_id VARCHAR(50);
    CREATE INDEX IF NOT EXISTS idx_part_instances_serial ON part_instances (serial_number);
    CREATE INDEX IF NOT EXISTS idx_part_instances_part_status ON part_instances (part_id, status);
  `);
  serialColEnsured = true;
}

// Request config fields -> the patch key productionAssetService.updateConfig
// understands. Storage is passed as `storage`; the service maps it to the
// production_assets `ssd` column and normalizes the value.
const PA_CONFIG_PATCH = {
  ram: 'ram',
  storage: 'storage',
  processor: 'processor',
  gpu: 'gpu',
  display: 'screen_size',
};

// Statuses that count as physically available stock (feed parts.quantity).
const IN_STOCK_STATUS = 'in_stock';
const EDITABLE_INSTANCE_STATUSES = ['in_stock', 'defective', 'discarded'];

function isBatteryPart(part) {
  const cat = String(part?.category || part?.part_type || '').toLowerCase().trim();
  const name = String(part?.part_name || '').toLowerCase();
  return cat === 'battery' || cat.includes('battery') || name.includes('battery');
}

/**
 * The old part coming off a laptop may be a type the catalog does not carry yet
 * (inventory picks a category and types a name). Resolve it, creating the
 * catalog row when needed so the defective unit has somewhere to live.
 */
async function resolveOldPartCatalogId(client, { partId, category, name }) {
  if (partId) {
    const r = await client.query(`SELECT part_id FROM parts WHERE part_id = $1`, [Number(partId)]);
    if (r.rows.length) return r.rows[0].part_id;
  }
  const cleanName = String(name || '').trim();
  if (!cleanName) return null;

  const existing = await client.query(
    `SELECT part_id FROM parts WHERE LOWER(part_name) = LOWER($1) LIMIT 1`,
    [cleanName]
  );
  if (existing.rows.length) return existing.rows[0].part_id;

  const cat = normalizeCategory(category);
  const ins = await client.query(
    `INSERT INTO parts (part_name, part_type, category, quantity, min_threshold, description)
     VALUES ($1, $2, $3, 0, 5, $4) RETURNING part_id`,
    [cleanName, cat, cat, `Created from a defective part returned by the floor`]
  );
  return ins.rows[0].part_id;
}

function normalizeBatteryPhotos(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((u) => String(u || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((u) => String(u || '').trim()).filter(Boolean);
      }
    } catch (_) { /* single URL */ }
    const s = raw.trim();
    return s ? [s] : [];
  }
  return [];
}

// POST /api/part-requests
exports.createPartRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      ticket_id, request_type = 'replacement', part_id, quantity = 1,
      description, config_field, old_value, new_value, blocks_stage = true,
      battery_model_number, battery_photos,
    } = req.body || {};

    if (!ticket_id) return res.status(400).json({ success: false, message: 'ticket_id required' });
    if (!part_id) return res.status(400).json({ success: false, message: 'part_id required — select a part from the catalog' });
    if (!['replacement', 'upgrade', 'consumable'].includes(request_type)) {
      return res.status(400).json({ success: false, message: 'Invalid request_type' });
    }
    if (request_type === 'upgrade' && (!config_field || !new_value)) {
      return res.status(400).json({ success: false, message: 'Upgrade requires config_field and new_value' });
    }

    const partRes = await client.query(
      `SELECT part_id, part_name, quantity, cost, category, part_type, model_number, pin_size
         FROM parts WHERE part_id = $1`,
      [part_id]
    );
    if (!partRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Part not found in catalog' });
    }
    const part = partRes.rows[0];

    const battery = isBatteryPart(part);
    const batteryModel = String(battery_model_number || '').trim();
    const photos = normalizeBatteryPhotos(battery_photos);
    if (battery) {
      if (!batteryModel) {
        return res.status(400).json({
          success: false,
          message: 'Battery Model Number is required for battery parts',
        });
      }
      if (!photos.length) {
        return res.status(400).json({
          success: false,
          message: 'At least one battery photo is required for battery parts',
        });
      }
    }

    const tRes = await client.query(
      `SELECT ticket_id, ttspl_id, vendor_serial_id, current_stage_id FROM tickets WHERE ticket_id = $1`,
      [ticket_id]
    );
    if (!tRes.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });
    const ticket = tRes.rows[0];

    let stageName = null;
    if (ticket.current_stage_id) {
      const sRes = await client.query(`SELECT stage_name FROM stages WHERE stage_id = $1`, [ticket.current_stage_id]);
      stageName = sRes.rows[0]?.stage_name || null;
    }

    const inStock = Number(part.quantity) > 0;
    const status = inStock ? 'pending' : 'escalated';
    const blocks = blocks_stage !== false;

    await client.query('BEGIN');

    const reqNumber = await generatePrqNumber(client);
    const ins = await client.query(
      `INSERT INTO part_requests
         (ticket_id, requested_by, part_name, description, status, request_number,
          request_type, part_id, quantity, stage_name, ticket_stage_id,
          config_field, old_value, new_value, blocks_stage,
          escalated_by, escalated_at, battery_model_number, battery_photos, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,$18,$19::jsonb,NOW())
       RETURNING request_id`,
      [
        ticket_id, req.user.user_id, part.part_name, description || null, status, reqNumber,
        request_type, part_id, Number(quantity) || 1, stageName, ticket.current_stage_id || null,
        config_field || null, old_value || null, new_value || null, blocks,
        inStock ? null : req.user.user_id, inStock ? null : new Date(),
        battery ? batteryModel : null,
        battery ? JSON.stringify(photos) : null,
      ]
    );
    const requestId = ins.rows[0].request_id;

    if (blocks) {
      await client.query(
        `INSERT INTO ticket_part_blocks (ticket_id, request_id)
         VALUES ($1,$2) ON CONFLICT (ticket_id, request_id) DO NOTHING`,
        [ticket_id, requestId]
      );
      await client.query(
        `UPDATE tickets SET open_part_requests = COALESCE(open_part_requests,0) + 1, updated_at = NOW()
          WHERE ticket_id = $1`,
        [ticket_id]
      );
    }

    await logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      eventType: 'part_requested',
      description: `Part requested: ${part.part_name} (${request_type})${inStock ? '' : ' — out of stock, escalated to procurement'}`,
      metadata: {
        request_id: requestId, request_number: reqNumber, part_id, request_type,
        config_field, old_value, new_value,
        battery_model_number: battery ? batteryModel : undefined,
        battery_photo_count: battery ? photos.length : undefined,
      },
      actorUserId: req.user.user_id,
      actorName: req.user.name,
      db: client,
    });

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      request_id: requestId,
      request_number: reqNumber,
      status,
      in_stock: inStock,
      message: inStock ? 'Part request submitted for warehouse approval' : 'Part out of stock — escalated to procurement',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('createPartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

/** POST /api/part-requests/upload-photos — battery (or part) photos; returns relative upload URLs */
exports.uploadPartRequestPhotos = async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ success: false, message: 'At least one photo is required' });
    }
    const urls = files.map((f) => `uploads/part-requests/${f.filename}`);
    res.json({ success: true, urls, count: urls.length });
  } catch (err) {
    console.error('uploadPartRequestPhotos:', err);
    res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
};

// GET /api/part-requests
exports.listPartRequests = async (req, res) => {
  try {
    await ensurePartsSpecColumns(pool);
    const { ticket_id, status } = req.query;
    const where = [];
    const params = [];

    if (ticket_id) { params.push(Number(ticket_id)); where.push(`pr.ticket_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`pr.status = $${params.length}`); }

    // Non-privileged users without a ticket filter only see their own requests.
    if (!ticket_id && !PRIVILEGED.includes(req.user.role) && req.user.role !== 'warehouse' && req.user.role !== 'procurement') {
      params.push(req.user.user_id);
      where.push(`pr.requested_by = $${params.length}`);
    }

    const sql = `${FULL_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pr.created_at DESC LIMIT 500`;
    const result = await pool.query(sql, params);
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    console.error('listPartRequests:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/part-requests/:requestId
exports.getPartRequest = async (req, res) => {
  try {
    await ensurePartsSpecColumns(pool);
    const result = await pool.query(`${FULL_SELECT} WHERE pr.request_id = $1`, [req.params.requestId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Request not found' });
    res.json({ success: true, request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/tickets/:ticketId/part-requests  (also reachable via list with ?ticket_id=)
exports.getTicketPartRequests = async (req, res) => {
  try {
    await ensurePartsSpecColumns(pool);
    const result = await pool.query(
      `${FULL_SELECT} WHERE pr.ticket_id = $1 ORDER BY pr.created_at DESC`,
      [req.params.ticketId]
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/part-requests/:requestId/approve
// body: { instance_id } | { prt_id } (scanned QR) | { auto_select: true }
//       plus the old-part declaration: { old_part_expected, old_part_category,
//       old_part_part_id, old_part_name }
exports.approvePartRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    const {
      instance_id, auto_select, prt_id,
      old_part_expected, old_part_category, old_part_part_id, old_part_name,
    } = req.body || {};

    if (old_part_expected && !['yes', 'not_available', 'unknown'].includes(old_part_expected)) {
      return res.status(400).json({ success: false, message: 'Invalid old_part_expected value' });
    }
    if (old_part_expected === 'yes' && !old_part_part_id && !String(old_part_name || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'Select the category and part name of the old part being returned',
      });
    }

    await client.query('BEGIN');

    const prRes = await client.query(
      `SELECT * FROM part_requests WHERE request_id = $1 FOR UPDATE`, [requestId]
    );
    if (!prRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const pr = prRes.rows[0];
    if (!['pending', 'escalated', 'ordered', 'received'].includes(pr.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Cannot approve a request with status '${pr.status}'` });
    }

    let instanceId = instance_id ? Number(instance_id) : null;

    // Scanned QR label (or a typed Part ID / serial) picks the exact unit.
    if (!instanceId && String(prt_id || '').trim()) {
      const code = String(prt_id).trim();
      const scanned = await client.query(
        `SELECT instance_id, prt_id, part_id, status FROM part_instances
          WHERE UPPER(prt_id) = UPPER($1)
             OR UPPER(COALESCE(serial_number, '')) = UPPER($1)
             OR UPPER(COALESCE(asset_code, '')) = UPPER($1)
          ORDER BY (UPPER(prt_id) = UPPER($1)) DESC, instance_id DESC
          LIMIT 1`,
        [code]
      );
      if (!scanned.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: `No part unit found for "${code}"` });
      }
      instanceId = scanned.rows[0].instance_id;
    }

    if (!instanceId) {
      if (!auto_select && pr.instance_id) instanceId = pr.instance_id;
    }
    if (!instanceId) {
      // auto-select oldest in_stock instance for this part
      const pick = await client.query(
        `SELECT instance_id FROM part_instances
          WHERE part_id = $1 AND status = 'in_stock'
          ORDER BY received_at ASC, instance_id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [pr.part_id]
      );
      if (pick.rows.length) {
        instanceId = pick.rows[0].instance_id;
      } else {
        // No PRT instance exists yet. Legacy stock may live only in parts.quantity
        // (added before Phase 16). If there is stock, mint a PRT instance on-the-fly.
        const partRow = await client.query(
          `SELECT part_id, part_name, quantity, cost FROM parts WHERE part_id = $1 FOR UPDATE`,
          [pr.part_id]
        );
        const part = partRow.rows[0];
        if (!part || Number(part.quantity) <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Part "${part?.part_name || pr.part_id}" is out of stock (0 available). Escalate to procurement.`
          });
        }
        const prtId = await generatePrtId(new Date(), client);
        const created = await client.query(
          `INSERT INTO part_instances
             (prt_id, part_id, unit_cost, status, notes, received_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'in_stock', 'Auto-created from legacy stock on approval', NOW(), NOW(), NOW())
           RETURNING instance_id`,
          [prtId, pr.part_id, Number(part.cost || 0)]
        );
        instanceId = created.rows[0].instance_id;
      }
    }

    const instRes = await client.query(
      `SELECT * FROM part_instances WHERE instance_id = $1 FOR UPDATE`, [instanceId]
    );
    if (!instRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Part instance not found' }); }
    const inst = instRes.rows[0];
    if (Number(inst.part_id) !== Number(pr.part_id)) {
      const names = await client.query(
        `SELECT part_id, part_name FROM parts WHERE part_id = ANY($1::int[])`,
        [[Number(inst.part_id), Number(pr.part_id)]]
      );
      const nameOf = (id) => names.rows.find((n) => Number(n.part_id) === Number(id))?.part_name || `part ${id}`;
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `${inst.prt_id} is a "${nameOf(inst.part_id)}" but this request is for "${nameOf(pr.part_id)}"`,
      });
    }
    if (inst.status !== 'in_stock' && inst.status !== 'reserved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `${inst.prt_id} is '${inst.status}', not available` });
    }

    // Inventory declares here whether a defective part is coming back off the
    // laptop; the physical unit is created when the technician hands it over.
    let oldPartId = null;
    if (old_part_expected === 'yes') {
      oldPartId = await resolveOldPartCatalogId(client, {
        partId: old_part_part_id,
        category: old_part_category,
        name: old_part_name,
      });
      if (!oldPartId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Could not resolve the old part — pick a category and part name' });
      }
    }

    await client.query(
      `UPDATE part_instances SET status = 'reserved', updated_at = NOW() WHERE instance_id = $1`, [instanceId]
    );
    await client.query(
      `UPDATE part_requests
          SET status = 'approved', instance_id = $1, approved_by = $2, approved_at = NOW(),
              old_part_expected = COALESCE($4, old_part_expected),
              old_part_category = $5,
              old_part_part_id = $6,
              old_part_name = $7,
              updated_at = NOW()
        WHERE request_id = $3`,
      [
        instanceId, req.user.user_id, requestId,
        old_part_expected || null,
        old_part_expected === 'yes' ? normalizeCategory(old_part_category) : null,
        oldPartId,
        old_part_expected === 'yes' ? (String(old_part_name || '').trim() || null) : null,
      ]
    );

    const tRes = await client.query(`SELECT ttspl_id, vendor_serial_id FROM tickets WHERE ticket_id = $1`, [pr.ticket_id]);

    const partMeta = await client.query(
      `SELECT part_name, category FROM parts WHERE part_id = $1`, [pr.part_id]
    );
    await recordMovement(client, {
      type: MOVEMENT.RESERVED,
      partId: pr.part_id,
      instanceId,
      prtId: inst.prt_id,
      serialNumber: inst.serial_number,
      category: partMeta.rows[0]?.category,
      partName: partMeta.rows[0]?.part_name,
      unitCost: inst.unit_cost,
      requestId: Number(requestId),
      ticketId: pr.ticket_id,
      ttsplId: tRes.rows[0]?.ttspl_id,
      isUpgrade: pr.request_type === 'upgrade',
      actorUserId: req.user.user_id,
      actorName: req.user.name,
    });

    await logTtsplEvent({
      ttsplId: tRes.rows[0]?.ttspl_id,
      vendorSerialId: tRes.rows[0]?.vendor_serial_id,
      eventType: 'part_approved',
      description: `Part request ${pr.request_number} approved — ${inst.prt_id} reserved`,
      metadata: { request_id: Number(requestId), instance_id: instanceId, prt_id: inst.prt_id },
      actorUserId: req.user.user_id, actorName: req.user.name, db: client,
    });

    await client.query('COMMIT');
    res.json({
      success: true,
      instance_id: instanceId,
      prt_id: inst.prt_id,
      serial_number: inst.serial_number,
      location_code: inst.location_code,
      old_part_expected: old_part_expected || null,
      old_part_part_id: oldPartId,
      message: `${inst.prt_id} reserved for this request`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('approvePartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// PATCH /api/part-requests/:requestId/reject   body: { reason }
exports.rejectPartRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) return res.status(400).json({ success: false, message: 'Rejection reason required' });

    await client.query('BEGIN');
    const prRes = await client.query(`SELECT * FROM part_requests WHERE request_id = $1 FOR UPDATE`, [requestId]);
    if (!prRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const pr = prRes.rows[0];

    // Free a reserved instance, if any.
    if (pr.instance_id) {
      await client.query(`UPDATE part_instances SET status = 'in_stock', updated_at = NOW() WHERE instance_id = $1 AND status = 'reserved'`, [pr.instance_id]);
      await recordUnreserved(client, pr, req.user, `Request rejected: ${reason}`);
    }
    await client.query(
      `UPDATE part_requests SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE request_id = $2`,
      [reason, requestId]
    );
    await unblockTicket(client, pr);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Part request rejected' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('rejectPartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// PATCH /api/part-requests/:requestId/escalate
exports.escalateToProcurement = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { notes } = req.body || {};
    const upd = await pool.query(
      `UPDATE part_requests SET status = 'escalated', escalated_by = $1, escalated_at = NOW(),
              old_part_notes = COALESCE(old_part_notes, $2), updated_at = NOW()
        WHERE request_id = $3 AND status IN ('pending','rejected')
        RETURNING request_id, request_number`,
      [req.user.user_id, notes || null, requestId]
    );
    if (!upd.rows.length) return res.status(400).json({ success: false, message: 'Request cannot be escalated from its current status' });
    res.json({ success: true, message: 'Escalated to procurement', request: upd.rows[0] });
  } catch (err) {
    console.error('escalateToProcurement:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/part-requests/:requestId/link-spo   body: { spo_id }
exports.linkRequestToSpo = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { spo_id } = req.body || {};
    if (!spo_id) return res.status(400).json({ success: false, message: 'spo_id required' });
    const upd = await pool.query(
      `UPDATE part_requests SET status = 'ordered', spo_id = $1, updated_at = NOW()
        WHERE request_id = $2 AND status IN ('escalated','pending')
        RETURNING request_id`,
      [Number(spo_id), requestId]
    );
    if (!upd.rows.length) return res.status(400).json({ success: false, message: 'Request cannot be linked from its current status' });
    res.json({ success: true, message: 'Linked to spare parts order' });
  } catch (err) {
    console.error('linkRequestToSpo:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/part-requests/:requestId/received   body: { instance_id }
exports.markPartReceived = async (req, res) => {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    const { instance_id } = req.body || {};
    if (!instance_id) return res.status(400).json({ success: false, message: 'instance_id required' });

    await client.query('BEGIN');
    const prRes = await client.query(`SELECT * FROM part_requests WHERE request_id = $1 FOR UPDATE`, [requestId]);
    if (!prRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const pr = prRes.rows[0];

    const instRes = await client.query(`SELECT * FROM part_instances WHERE instance_id = $1 FOR UPDATE`, [Number(instance_id)]);
    if (!instRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Part instance not found' }); }
    const inst = instRes.rows[0];
    if (Number(inst.part_id) !== Number(pr.part_id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Part unit does not match the requested part' });
    }

    await client.query(`UPDATE part_instances SET status = 'reserved', updated_at = NOW() WHERE instance_id = $1`, [Number(instance_id)]);
    await client.query(
      `UPDATE part_requests SET status = 'approved', instance_id = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW()
        WHERE request_id = $3`,
      [Number(instance_id), req.user.user_id, requestId]
    );
    await client.query('COMMIT');
    res.json({ success: true, prt_id: inst.prt_id, message: 'Part received and reserved for this request' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('markPartReceived:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// POST /api/part-requests/:requestId/attach
// body: { old_part_returned, old_part_condition, old_part_notes,
//         old_part_part_id?, old_part_category?, old_part_name?, old_part_serial? }
exports.attachPartAndReturnOld = async (req, res) => {
  const { requestId } = req.params;
  const {
    old_part_returned, old_part_condition, old_part_notes,
    old_part_part_id, old_part_category, old_part_name, old_part_serial,
  } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const reqRes = await client.query(
      `SELECT pr.*, p.part_name, p.cost AS part_cost, p.category,
              pi.prt_id, pi.serial_number AS instance_serial, pi.unit_cost AS instance_cost,
              t.ttspl_id, t.vendor_serial_id, t.current_stage_id
         FROM part_requests pr
         JOIN parts p ON p.part_id = pr.part_id
         LEFT JOIN part_instances pi ON pi.instance_id = pr.instance_id
         JOIN tickets t ON t.ticket_id = pr.ticket_id
        WHERE pr.request_id = $1 FOR UPDATE OF pr`,
      [requestId]
    );
    if (!reqRes.rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });

    const r = reqRes.rows[0];
    if (r.status !== 'approved') {
      throw Object.assign(new Error(`Cannot attach part: request status is '${r.status}'. Must be approved.`), { status: 400 });
    }

    const unitCost = parseFloat(r.instance_cost || r.part_cost || 0);
    const isUpgrade = r.request_type === 'upgrade';
    const qty = Number(r.quantity) || 1;

    if (r.instance_id) {
      await client.query(
        `UPDATE part_instances SET status = 'installed', installed_ttspl_id = $1,
                installed_ticket_id = $2, installed_at = NOW(), updated_at = NOW()
          WHERE instance_id = $3`,
        [r.ttspl_id, r.ticket_id, r.instance_id]
      );
    }

    await client.query(
      `UPDATE parts SET quantity = GREATEST(0, quantity - $1), updated_at = NOW() WHERE part_id = $2`,
      [qty, r.part_id]
    );

    await client.query(
      `INSERT INTO ticket_parts (ticket_id, part_id, quantity_used, notes, unit_cost, is_upgrade)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.ticket_id, r.part_id, qty, r.description || null, unitCost, isUpgrade]
    );

    let configUpdated = false;
    if (isUpgrade && r.config_field && r.new_value) {
      await logConfigChange({
        ttsplId: r.ttspl_id, vendorSerialId: r.vendor_serial_id, ticketId: r.ticket_id,
        changedBy: req.user.user_id, changeType: 'upgrade', fieldName: r.config_field,
        oldValue: r.old_value, newValue: r.new_value,
        notes: `Part ${r.part_name} upgraded (${r.old_value || '—'} → ${r.new_value})`,
        partUsedId: r.part_id, partCost: unitCost, db: client,
      });

      // Prefer the production asset writer: it normalizes RAM and storage to the
      // same format the rest of the pipeline uses and mirrors the change to the
      // inventory record, the ticket header and the change log in one place.
      const paPatch = PA_CONFIG_PATCH[r.config_field];
      let wroteViaProductionAsset = false;
      if (paPatch) {
        const pa = await productionAssetService.getByTicket(client, r.ticket_id);
        if (pa) {
          await productionAssetService.updateConfig(
            client,
            pa.production_asset_id,
            { [paPatch]: r.new_value },
            req.user.user_id,
            r.stage_name || null
          );
          wroteViaProductionAsset = true;
        }
      }

      // Laptops that never entered the production pipeline have no asset row;
      // fall back to writing the inventory record and ticket header directly.
      if (!wroteViaProductionAsset) {
        const fieldMap = { ram: 'ram', storage: 'storage', display: 'screen_size', processor: 'processor', gpu: 'gpu', os: 'os' };
        const jsonbKey = fieldMap[r.config_field] || r.config_field;
        if (r.vendor_serial_id) {
          await client.query(
            `UPDATE vendor_serial_numbers
                SET extra = jsonb_set(COALESCE(extra, '{}'::jsonb), $1, $2::jsonb), updated_at = NOW()
              WHERE serial_id = $3`,
            [`{${jsonbKey}}`, JSON.stringify(r.new_value), r.vendor_serial_id]
          );
        }
        if (['ram', 'storage', 'processor'].includes(r.config_field)) {
          await client.query(
            `UPDATE tickets SET ${r.config_field} = $1, updated_at = NOW() WHERE ticket_id = $2`,
            [r.new_value, r.ticket_id]
          );
        }
      }
      configUpdated = true;
    }

    // The removed part becomes its own tracked unit with its own Part ID, so it
    // can be labelled, scanned, repaired or written off later. Inventory usually
    // declared what to expect at approval; the technician can still correct it.
    let returnedInstance = null;
    if (old_part_returned) {
      const returnedPartId = await resolveOldPartCatalogId(client, {
        partId: old_part_part_id || r.old_part_part_id || r.part_id,
        category: old_part_category || r.old_part_category || r.category,
        name: old_part_name || r.old_part_name || r.part_name,
      });
      if (returnedPartId) {
        returnedInstance = await createReturnedPartInstance(client, {
          partId: returnedPartId,
          condition: old_part_condition || 'defective',
          ttsplId: r.ttspl_id,
          ticketId: r.ticket_id,
          requestId: Number(requestId),
          serialNumber: old_part_serial || null,
          notes: old_part_notes || null,
          actorUserId: req.user.user_id,
          actorName: req.user.name,
        });
      }
    }

    await client.query(
      `UPDATE part_requests SET status = 'attached', attached_by = $1, attached_at = NOW(),
              old_part_returned = $2,
              old_part_returned_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
              old_part_condition = $3, old_part_notes = $4,
              old_part_instance_id = $6,
              updated_at = NOW()
        WHERE request_id = $5`,
      [
        req.user.user_id, Boolean(old_part_returned), old_part_condition || null,
        old_part_notes || null, requestId, returnedInstance?.instance_id || null,
      ]
    );

    await recordMovement(client, {
      type: MOVEMENT.INSTALLED,
      partId: r.part_id,
      instanceId: r.instance_id,
      prtId: r.prt_id,
      serialNumber: r.instance_serial,
      category: r.category,
      partName: r.part_name,
      quantity: qty,
      unitCost,
      requestId: Number(requestId),
      ticketId: r.ticket_id,
      ttsplId: r.ttspl_id,
      isUpgrade,
      notes: isUpgrade ? `${r.config_field}: ${r.old_value || '—'} → ${r.new_value}` : null,
      actorUserId: req.user.user_id,
      actorName: req.user.name,
    });

    await unblockTicket(client, r);

    await logTtsplEvent({
      ttsplId: r.ttspl_id, vendorSerialId: r.vendor_serial_id, eventType: 'part_attached',
      description: `Part attached: ${r.part_name} (${r.prt_id || 'no PRT ID'})${isUpgrade ? ` — Upgrade: ${r.old_value || '—'} → ${r.new_value}` : ''}`,
      metadata: {
        request_id: Number(requestId), part_id: r.part_id, prt_id: r.prt_id, part_name: r.part_name,
        unit_cost: unitCost, is_upgrade: isUpgrade, config_field: r.config_field,
        old_value: r.old_value, new_value: r.new_value, old_part_returned: Boolean(old_part_returned), old_part_condition,
        old_part_prt_id: returnedInstance?.prt_id || null,
      },
      actorUserId: req.user.user_id, actorName: req.user.name, db: client,
    });

    await client.query('COMMIT');
    res.json({
      success: true,
      message: returnedInstance
        ? `Part attached. Old part logged as ${returnedInstance.prt_id} — print its label.`
        : 'Part attached successfully',
      config_updated: configUpdated,
      ticket_unblocked: Boolean(r.blocks_stage),
      returned_part: returnedInstance || null,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('attachPartAndReturnOld:', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// PATCH /api/part-requests/:requestId/cancel
exports.cancelPartRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    await client.query('BEGIN');
    const prRes = await client.query(`SELECT * FROM part_requests WHERE request_id = $1 FOR UPDATE`, [requestId]);
    if (!prRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const pr = prRes.rows[0];
    if (['attached', 'cancelled'].includes(pr.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Cannot cancel a request that is '${pr.status}'` });
    }
    // Only the requester, floor managers or admins may cancel.
    if (!PRIVILEGED.includes(req.user.role) && req.user.role !== 'floor_manager' && Number(pr.requested_by) !== Number(req.user.user_id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You can only cancel your own requests' });
    }
    if (pr.instance_id) {
      await client.query(`UPDATE part_instances SET status = 'in_stock', updated_at = NOW() WHERE instance_id = $1 AND status = 'reserved'`, [pr.instance_id]);
      await recordUnreserved(client, pr, req.user, 'Request cancelled');
    }
    await client.query(`UPDATE part_requests SET status = 'cancelled', updated_at = NOW() WHERE request_id = $1`, [requestId]);
    await unblockTicket(client, pr);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Part request cancelled' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('cancelPartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// GET /api/part-requests/warehouse-queue
exports.getWarehouseQueue = async (req, res) => {
  try {
    await ensurePartsSpecColumns(pool);
    const result = await pool.query(
      `${FULL_SELECT} WHERE pr.status IN ('pending','escalated','ordered','received')
        ORDER BY CASE pr.status WHEN 'pending' THEN 0 WHEN 'received' THEN 1 WHEN 'ordered' THEN 2 ELSE 3 END,
                 pr.created_at ASC`
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/part-requests/procurement-queue
exports.getProcurementQueue = async (req, res) => {
  try {
    await ensurePartsSpecColumns(pool);
    const result = await pool.query(
      `${FULL_SELECT} WHERE pr.status IN ('escalated','ordered') ORDER BY pr.created_at ASC`
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/part-requests/cost-summary/:ttsplId
exports.getPartCostSummary = async (req, res) => {
  try {
    const { ttsplId } = req.params;
    const ctx = await resolveTtsplAsset(ttsplId);
    if (!ctx) {
      return res.json({
        success: true,
        ttspl_id: ttsplId,
        base_cost: 0,
        parts_cost: 0,
        total_expense: 0,
        parts_breakdown: []
      });
    }

    const aliasArr = ctx.aliases.length ? ctx.aliases : [ctx.canonicalTtspl];

    const breakdown = await pool.query(
      `SELECT pi.prt_id, p.part_name, pi.unit_cost, pi.installed_at,
              COALESCE(pr.request_type, CASE WHEN tp.is_upgrade THEN 'upgrade' ELSE 'replacement' END) AS type
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
         LEFT JOIN part_requests pr ON pr.instance_id = pi.instance_id
         LEFT JOIN ticket_parts tp ON tp.part_id = pi.part_id AND tp.ticket_id = pi.installed_ticket_id
        WHERE UPPER(COALESCE(pi.installed_ttspl_id, '')) = ANY($1::text[])
          AND pi.status = 'installed'
        ORDER BY pi.installed_at ASC`,
      [aliasArr]
    );

    const totals = await pool.query(
      `SELECT COALESCE(SUM(tp.quantity_used * COALESCE(tp.unit_cost, p.cost, 0)),0)::numeric AS parts_cost
         FROM tickets t
         JOIN ticket_parts tp ON tp.ticket_id = t.ticket_id
         LEFT JOIN parts p ON p.part_id = tp.part_id
        WHERE ($1::int IS NOT NULL AND t.vendor_serial_id = $1)
           OR UPPER(COALESCE(t.ttspl_id, '')) = ANY($2::text[])
           OR UPPER(COALESCE(t.serial_number, '')) = ANY($2::text[])`,
      [ctx.serialId, aliasArr]
    );

    const baseRes = ctx.serialId
      ? await pool.query(
        `SELECT COALESCE(MAX(vpd.rate),0)::numeric AS base_cost
           FROM vendor_serial_numbers vsn
           LEFT JOIN vendor_product_details vpd ON vpd.po_id = vsn.po_id
          WHERE vsn.serial_id = $1`,
        [ctx.serialId]
      )
      : await pool.query(
        `SELECT COALESCE(MAX(vpd.rate),0)::numeric AS base_cost
           FROM vendor_serial_numbers vsn
           LEFT JOIN vendor_product_details vpd ON vpd.po_id = vsn.po_id
          WHERE UPPER(COALESCE(vsn.inventory_asset_code, '')) = ANY($1::text[])`,
        [aliasArr]
      );

    const partsCost = parseFloat(totals.rows[0]?.parts_cost || 0);
    const baseCost = parseFloat(baseRes.rows[0]?.base_cost || 0);

    res.json({
      success: true,
      ttspl_id: ctx.canonicalTtspl,
      base_cost: baseCost,
      parts_cost: partsCost,
      total_expense: partsCost + baseCost,
      parts_breakdown: breakdown.rows.map((b) => ({
        prt_id: b.prt_id,
        part_name: b.part_name,
        unit_cost: parseFloat(b.unit_cost || 0),
        installed_at: b.installed_at,
        type: b.type,
      })),
    });
  } catch (err) {
    console.error('getPartCostSummary:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/part-requests/instances?status=&part_id=&category=&search=&limit=
exports.listPartInstances = async (req, res) => {
  try {
    await ensurePartInstanceSerialColumn(pool);
    const { status, part_id, category, search, limit = 200 } = req.query;
    const conditions = [];
    const params = [];
    if (status) { params.push(status); conditions.push(`pi.status = $${params.length}`); }
    if (part_id) { params.push(Number(part_id)); conditions.push(`pi.part_id = $${params.length}`); }
    if (category) { params.push(category); conditions.push(`p.category = $${params.length}`); }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const i = params.length;
      conditions.push(`(pi.prt_id ILIKE $${i} OR pi.serial_number ILIKE $${i}
        OR p.part_name ILIKE $${i} OR pi.installed_ttspl_id ILIKE $${i}
        OR pi.location_code ILIKE $${i} OR pi.asset_code ILIKE $${i}
        OR spo.purchase_order_number ILIKE $${i}
        OR COALESCE(vend.business_name, vend.first_name) ILIKE $${i})`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(Math.min(1000, Number(limit) || 200));

    // The PO and vendor travel with the unit so a warranty claim can be traced
    // back to who supplied it without hunting through GRN history.
    const result = await pool.query(
      `SELECT pi.instance_id, pi.prt_id, pi.serial_number, pi.part_id, pi.status, pi.location_code,
              pi.unit_cost, pi.notes, pi.installed_ttspl_id, pi.installed_ticket_id, pi.installed_at,
              pi.received_at, pi.created_at, pi.asset_code, pi.source, pi.spo_id, pi.grn_id,
              pi.removed_from_ttspl_id, pi.condition_on_removal,
              p.part_name, p.category, p.part_type,
              spo.purchase_order_number, spo.purchase_order_date,
              COALESCE(pi.vendor_id, spo.vendor_id) AS vendor_id,
              COALESCE(NULLIF(TRIM(vend.business_name), ''), NULLIF(TRIM(vend.first_name), '')) AS vendor_name
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
         LEFT JOIN vendor_spare_parts_purchase_orders spo ON spo.spo_id = pi.spo_id
         LEFT JOIN vendors vend ON vend.vendor_id = COALESCE(pi.vendor_id, spo.vendor_id)
         ${where}
         ORDER BY pi.created_at DESC, pi.instance_id DESC
         LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, instances: result.rows });
  } catch (err) {
    console.error('listPartInstances:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/part-requests/instances
// Add one or more physical units (with serial numbers) for a catalog part.
// Body: { part_id, serial_number?, serial_numbers?[], quantity?, unit_cost?, location_code?, notes? }
exports.addPartInstances = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensurePartInstanceSerialColumn(pool);
    const {
      part_id, serial_number, serial_numbers, quantity,
      unit_cost, location_code, notes,
    } = req.body || {};

    if (!part_id) {
      return res.status(400).json({ success: false, message: 'part_id required' });
    }

    // Build the list of serials to create. An explicit array wins; otherwise
    // create `quantity` units, all sharing the single serial (or null).
    let serials;
    if (Array.isArray(serial_numbers) && serial_numbers.length) {
      serials = serial_numbers.map((s) => String(s || '').trim()).filter(Boolean);
    } else {
      const qty = Math.max(1, Math.min(500, Number(quantity) || 1));
      const single = serial_number ? String(serial_number).trim() : null;
      serials = Array.from({ length: qty }, () => single);
    }
    if (!serials.length) {
      return res.status(400).json({ success: false, message: 'Provide at least one serial number or a quantity' });
    }

    await client.query('BEGIN');

    const partRes = await client.query(
      `SELECT part_id, part_name, cost FROM parts WHERE part_id = $1 FOR UPDATE`,
      [Number(part_id)]
    );
    if (!partRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Part not found' });
    }
    const part = partRes.rows[0];
    const cost = unit_cost != null && unit_cost !== '' ? Number(unit_cost) : Number(part.cost || 0);

    const created = [];
    for (const s of serials) {
      const prtId = await generatePrtId(new Date(), client);
      const ins = await client.query(
        `INSERT INTO part_instances
           (prt_id, serial_number, part_id, unit_cost, location_code, status, notes,
            received_by, received_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'in_stock',$6,$7,NOW(),NOW(),NOW())
         RETURNING instance_id, prt_id, serial_number, status, location_code, unit_cost`,
        [prtId, s || null, Number(part_id), cost, location_code || null, notes || null, req.user.user_id]
      );
      created.push(ins.rows[0]);
    }

    await client.query(
      `UPDATE parts SET quantity = COALESCE(quantity,0) + $1, updated_at = NOW() WHERE part_id = $2`,
      [created.length, Number(part_id)]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      created,
      count: created.length,
      message: `${created.length} unit(s) added to ${part.part_name}`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('addPartInstances:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// PATCH /api/part-requests/instances/:instanceId
// Edit a unit's serial/location/cost/notes and manage its stock status
// (in_stock / defective / discarded). Keeps parts.quantity in sync.
exports.updatePartInstance = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensurePartInstanceSerialColumn(pool);
    const { instanceId } = req.params;
    const { serial_number, location_code, unit_cost, notes, status } = req.body || {};

    await client.query('BEGIN');
    const instRes = await client.query(
      `SELECT * FROM part_instances WHERE instance_id = $1 FOR UPDATE`, [Number(instanceId)]
    );
    if (!instRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Part unit not found' });
    }
    const inst = instRes.rows[0];

    let nextStatus = inst.status;
    if (status !== undefined && status !== null && status !== inst.status) {
      if (!EDITABLE_INSTANCE_STATUSES.includes(status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: `Status '${status}' cannot be set here` });
      }
      // Only free stock (in_stock) may be reclassified — reserved/installed units
      // are locked to their workflow.
      if (!EDITABLE_INSTANCE_STATUSES.includes(inst.status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: `Unit is '${inst.status}' and cannot be changed here` });
      }
      nextStatus = status;
    }

    await client.query(
      `UPDATE part_instances
          SET serial_number = COALESCE($1, serial_number),
              location_code = COALESCE($2, location_code),
              unit_cost = COALESCE($3, unit_cost),
              notes = COALESCE($4, notes),
              status = $5,
              updated_at = NOW()
        WHERE instance_id = $6`,
      [
        serial_number !== undefined ? (serial_number === '' ? null : String(serial_number).trim()) : null,
        location_code !== undefined ? (location_code === '' ? null : location_code) : null,
        unit_cost != null && unit_cost !== '' ? Number(unit_cost) : null,
        notes !== undefined ? notes : null,
        nextStatus,
        Number(instanceId),
      ]
    );

    // Keep aggregate stock in sync when a unit enters/leaves in_stock.
    const wasInStock = inst.status === IN_STOCK_STATUS;
    const nowInStock = nextStatus === IN_STOCK_STATUS;
    if (wasInStock !== nowInStock) {
      const delta = nowInStock ? 1 : -1;
      await client.query(
        `UPDATE parts SET quantity = GREATEST(0, COALESCE(quantity,0) + $1), updated_at = NOW() WHERE part_id = $2`,
        [delta, inst.part_id]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Part unit updated' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updatePartInstance:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// Shared: a reserved unit going back to free stock.
async function recordUnreserved(client, pr, user, notes) {
  const info = await client.query(
    `SELECT pi.prt_id, pi.serial_number, pi.unit_cost, p.part_name, p.category
       FROM part_instances pi JOIN parts p ON p.part_id = pi.part_id
      WHERE pi.instance_id = $1`,
    [pr.instance_id]
  );
  const row = info.rows[0];
  if (!row) return;
  await recordMovement(client, {
    type: MOVEMENT.UNRESERVED,
    partId: pr.part_id,
    instanceId: pr.instance_id,
    prtId: row.prt_id,
    serialNumber: row.serial_number,
    category: row.category,
    partName: row.part_name,
    unitCost: row.unit_cost,
    requestId: pr.request_id,
    ticketId: pr.ticket_id,
    notes,
    actorUserId: user?.user_id,
    actorName: user?.name,
  });
}

// Shared: deactivate the block row and decrement the ticket's open counter.
async function unblockTicket(client, pr) {
  const upd = await client.query(
    `UPDATE ticket_part_blocks SET is_active = false, unblocked_at = NOW()
      WHERE ticket_id = $1 AND request_id = $2 AND is_active = true
      RETURNING block_id`,
    [pr.ticket_id, pr.request_id]
  );
  if (upd.rows.length) {
    await client.query(
      `UPDATE tickets SET open_part_requests = GREATEST(0, COALESCE(open_part_requests,0) - 1), updated_at = NOW()
        WHERE ticket_id = $1`,
      [pr.ticket_id]
    );
  }
}
