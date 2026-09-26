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
const {
  resolvePartConfigUpdate,
  applyConfigFromPartAttach,
  revertConfigFromPartDetach,
} = require('../services/partConfigUpdateService');
const {
  validateFitment,
  assertAssignmentAllowed,
  FitmentValidationError,
  fits,
  loadKnownBrands,
} = require('../services/partFitmentService');

/**
 * Migration 313 (support v2) unified the two part-request tables: every row of
 * support_part_requests was copied into part_requests with context='FIELD' and
 * legacy_support_request_id set. These are the FLOOR screens -- the floor queue,
 * the warehouse queue and the procurement queue -- and a field request must not
 * appear in any of them. Rows that predate the column are NULL and are FLOOR.
 */
const FLOOR_ONLY = `COALESCE(pr.context, 'FLOOR') = 'FLOOR'`;

const FULL_SELECT = `
  SELECT pr.*,
         COALESCE(pr.part_name, p.part_name) AS part_name,
         p.category, p.part_type, p.cost AS catalog_cost, p.quantity AS stock_qty,
         p.model_number AS catalog_model_number, p.pin_size AS catalog_pin_size,
         pi.prt_id, pi.serial_number AS instance_serial, pi.asset_code AS instance_asset_code,
         pi.location_code, pi.status AS instance_status, pi.unit_cost AS instance_cost,
         op.part_name AS old_part_catalog_name, op.category AS old_part_catalog_category,
         opi.prt_id AS old_part_prt_id,
         t.ttspl_id, t.serial_number AS laptop_serial_number, t.brand, t.model, t.processor, t.ram, t.storage,
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

    // P5: "in stock" means a unit is on the shelf, not parts.quantity (which
    // also counts reserved units and drifts). P4: one request is one unit.
    if (Number(quantity) > 1) {
      return res.status(400).json({ success: false, message: 'Request one part per request — raise another request for the next unit.' });
    }
    const shelf = await pool.query(
      `SELECT COUNT(*)::int AS n FROM part_instances WHERE part_id = $1 AND status = 'in_stock'`, [part_id]
    );
    const inStock = shelf.rows[0].n > 0;
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

    where.push(FLOOR_ONLY);

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

    // P7: part_requests has no brand/model columns, so pr.brand was always
    // undefined and the fitment check never ran. The laptop is the ticket's.
    const lap = (await client.query('SELECT brand, model FROM tickets WHERE ticket_id = $1', [pr.ticket_id])).rows[0] || {};
    pr.brand = lap.brand || null;
    pr.model = lap.model || null;

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
      // Prefer fit, then unknown; never auto-pick unfit.
      const laptopBrand = pr.brand || null;
      const laptopModel = pr.model || null;
      await loadKnownBrands(client);
      const pick = await client.query(
        `SELECT instance_id, fitment, fits_laptop_brand, fits_laptop_models
           FROM part_instances
          WHERE part_id = $1 AND status = 'in_stock'
          ORDER BY received_at ASC, instance_id ASC
          FOR UPDATE`,
        [pr.part_id]
      );
      let chosen = null;
      for (const pref of ['fit', 'unknown']) {
        for (const row of pick.rows) {
          if (fits(row, laptopBrand, laptopModel) === pref) {
            chosen = row;
            break;
          }
        }
        if (chosen) break;
      }
      if (chosen) {
        instanceId = chosen.instance_id;
      } else {
        // P3: no unit is on the shelf. This used to create one whenever
        // parts.quantity > 0 — which counts reserved units, and with SKIP
        // LOCKED fired under concurrency — so parts that did not exist were
        // reserved and later installed. Nothing is invented now.
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          code: 'NO_UNIT_ON_SHELF',
          message: 'No unit of this part is on the shelf. If there is stock, add its units (with their labels) in Parts first; otherwise escalate to procurement.',
        });
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
    // P1: a reserved unit may only be re-confirmed for the request that holds
    // it — it could be reserved for a second request and installed twice.
    if (inst.status === 'reserved') {
      const holder = (await client.query(
        `SELECT request_number FROM part_requests
          WHERE instance_id = $1 AND request_id <> $2 AND status IN ('approved', 'ordered', 'received', 'pending', 'escalated')
          LIMIT 1`,
        [inst.instance_id, pr.request_id]
      )).rows[0];
      if (holder || Number(pr.instance_id) !== Number(inst.instance_id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: `${inst.prt_id} is already reserved${holder ? ` for ${holder.request_number}` : ' for another job'}. Pick a unit that is on the shelf.`,
        });
      }
    }
    // Re-approving with a different unit gives the old one back to the shelf.
    if (pr.instance_id && Number(pr.instance_id) !== Number(instanceId)) {
      await client.query(
        `UPDATE part_instances SET status = 'in_stock', updated_at = NOW() WHERE instance_id = $1 AND status = 'reserved'`,
        [pr.instance_id]
      );
    }

    const fitGate = await assertAssignmentAllowed({
      unit: inst,
      laptopBrand: pr.brand,
      laptopModel: pr.model,
      mismatchReason: req.body?.fitment_mismatch_reason,
      db: client,
    });
    if (!fitGate.ok) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: fitGate.message,
        code: fitGate.code,
        fit_status: fitGate.status,
      });
    }
    if (fitGate.allowedMismatch || fitGate.status === 'unknown') {
      await recordMovement(client, {
        type: MOVEMENT.FITMENT_MISMATCH,
        partId: inst.part_id,
        instanceId: inst.instance_id,
        prtId: inst.prt_id,
        serialNumber: inst.serial_number,
        requestId: pr.request_id,
        ticketId: pr.ticket_id,
        notes: JSON.stringify({
          event: fitGate.allowedMismatch ? 'allowed_mismatch' : 'unknown_laptop_or_unit',
          stage: fitGate.stage,
          fit_status: fitGate.status,
          unit: {
            fitment: inst.fitment,
            fits_laptop_brand: inst.fits_laptop_brand,
            fits_laptop_models: inst.fits_laptop_models,
          },
          laptop: { brand: pr.brand, model: pr.model },
          reason: fitGate.reason || null,
        }),
        actorUserId: req.user?.user_id,
        actorName: req.user?.name,
      });
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

    // P2: only a request still waiting for its part, and only a unit that is
    // on the shelf (it could revive cancelled requests and reserve installed
    // or defective units).
    if (!['escalated', 'ordered', 'received', 'pending'].includes(pr.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: `This request is ${pr.status} — it is not waiting for a part.` });
    }
    const instRes = await client.query(`SELECT * FROM part_instances WHERE instance_id = $1 FOR UPDATE`, [Number(instance_id)]);
    if (!instRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Part instance not found' }); }
    const inst = instRes.rows[0];
    if (Number(inst.part_id) !== Number(pr.part_id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Part unit does not match the requested part' });
    }
    if (inst.status !== 'in_stock') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: `${inst.prt_id} is ${inst.status}, not on the shelf.` });
    }
    if (pr.instance_id && Number(pr.instance_id) !== Number(inst.instance_id)) {
      await client.query(
        `UPDATE part_instances SET status = 'in_stock', updated_at = NOW() WHERE instance_id = $1 AND status = 'reserved'`,
        [pr.instance_id]
      );
    }

    await client.query(`UPDATE part_instances SET status = 'reserved', updated_at = NOW() WHERE instance_id = $1`, [Number(instance_id)]);
    await recordMovement(client, {
      type: MOVEMENT.RESERVED, partId: pr.part_id, instanceId: inst.instance_id, prtId: inst.prt_id,
      serialNumber: inst.serial_number, unitCost: inst.unit_cost, requestId: Number(requestId), ticketId: pr.ticket_id,
      actorUserId: req.user.user_id, actorName: req.user.name,
    });
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
              pi.fitment, pi.fits_laptop_brand, pi.fits_laptop_models,
              t.ttspl_id, t.serial_number, t.vendor_serial_id, t.current_stage_id,
              t.ram, t.storage, t.processor, t.brand AS laptop_brand, t.model AS laptop_model,
              st.stage_name
         FROM part_requests pr
         JOIN parts p ON p.part_id = pr.part_id
         LEFT JOIN part_instances pi ON pi.instance_id = pr.instance_id
         JOIN tickets t ON t.ticket_id = pr.ticket_id
         LEFT JOIN stages st ON st.stage_id = COALESCE(pr.ticket_stage_id, t.current_stage_id)
        WHERE pr.request_id = $1 FOR UPDATE OF pr`,
      [requestId]
    );
    if (!reqRes.rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });

    const r = reqRes.rows[0];
    if (r.status !== 'approved') {
      throw Object.assign(new Error(`Cannot attach part: request status is '${r.status}'. Must be approved.`), { status: 400 });
    }

    if (r.instance_id) {
      const fitGate = await assertAssignmentAllowed({
        unit: r,
        laptopBrand: r.laptop_brand,
        laptopModel: r.laptop_model,
        mismatchReason: req.body?.fitment_mismatch_reason,
        db: client,
      });
      if (!fitGate.ok) {
        throw Object.assign(new Error(fitGate.message), { status: 400, code: fitGate.code });
      }
      if (fitGate.allowedMismatch) {
        await recordMovement(client, {
          type: MOVEMENT.FITMENT_MISMATCH,
          partId: r.part_id,
          instanceId: r.instance_id,
          prtId: r.prt_id,
          requestId: r.request_id,
          ticketId: r.ticket_id,
          notes: JSON.stringify({
            event: 'allowed_mismatch_attach',
            stage: fitGate.stage,
            laptop: { brand: r.laptop_brand, model: r.laptop_model },
            reason: fitGate.reason || null,
          }),
          actorUserId: req.user?.user_id,
          actorName: req.user?.name,
        });
      }
    }

    if (r.old_part_expected === 'yes' && !old_part_returned) {
      throw Object.assign(new Error('Return the old part to warehouse before completing attach.'), { status: 400 });
    }

    // P4/P5: a part is fitted only as a real reserved unit, one at a time.
    // Without a unit this took stock off the count with nothing issued, and
    // a quantity above 1 took several off while installing one.
    if (!r.instance_id) {
      throw Object.assign(new Error('No part unit is reserved for this request — approve it with a unit first.'), { status: 400 });
    }
    const unitCost = parseFloat(r.instance_cost || r.part_cost || 0);
    const isUpgrade = r.request_type === 'upgrade';
    const qty = 1;

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
    const ticket = {
      ticket_id: r.ticket_id,
      ttspl_id: r.ttspl_id,
      serial_number: r.serial_number,
      vendor_serial_id: r.vendor_serial_id,
      ram: r.ram,
      storage: r.storage,
      processor: r.processor,
    };
    const resolved = resolvePartConfigUpdate(r, ticket, { isUpgrade });
    if (resolved?.configField && resolved?.newValue) {
      configUpdated = await applyConfigFromPartAttach(client, {
        ticket,
        configField: resolved.configField,
        newValue: resolved.newValue,
        oldValue: resolved.oldValue,
        changeType: resolved.changeType || (isUpgrade ? 'upgrade' : 'replacement'),
        unitCost,
        partId: r.part_id,
        partName: r.part_name,
        stageName: r.stage_name || null,
        notes: isUpgrade
          ? `Part ${r.part_name} upgraded (${resolved.oldValue || '—'} → ${resolved.newValue})`
          : `Part ${r.part_name} attached (${resolved.oldValue || '—'} → ${resolved.newValue})`,
        userId: req.user.user_id,
        userName: req.user.name,
      });
    }

    // The removed part becomes its own tracked unit with its own Part ID, so it
    // can be labelled, scanned, repaired or written off later. Inventory usually
    // declared what to expect at approval; the technician can still correct it.
    let returnedInstance = null;
    if (old_part_returned) {
      // P6 / PD8: on an upgrade the part that came off is NOT the new part
      // (an 8GB stick out, a 16GB in). Defaulting to the new part booked the
      // removed 8GB as a 16GB unit — sellable stock at cost 0 if "good".
      const declared = old_part_part_id || r.old_part_part_id || String(old_part_name || r.old_part_name || '').trim();
      if (isUpgrade && !declared) {
        throw Object.assign(new Error('Say which part came off the laptop (e.g. "8GB DDR4 RAM") — on an upgrade it is not the new part.'), { status: 400 });
      }
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

// POST /api/part-requests/:requestId/detach — undo attach; PRT back to reserved, request → approved.
exports.detachAttachedPart = async (req, res) => {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    const reason = String(req.body?.reason || '').trim();
    const returnToInventory = req.body?.return_to_inventory === true;
    await client.query('BEGIN');

    const reqRes = await client.query(
      `${FULL_SELECT} WHERE pr.request_id = $1 FOR UPDATE OF pr`,
      [requestId]
    );
    if (!reqRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    const r = reqRes.rows[0];
    if (r.status !== 'attached') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Only attached parts can be removed this way (current status: ${r.status})`,
      });
    }

    if (!returnToInventory) {
      const canDetach = PRIVILEGED.includes(req.user.role)
        || req.user.role === 'floor_manager'
        || req.user.role === 'warehouse'
        || Number(r.requested_by) === Number(req.user.user_id);
      if (!canDetach) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, message: 'Not allowed to remove this attached part' });
      }
    }

    const tpRes = await client.query(
      `SELECT id FROM ticket_parts WHERE ticket_id = $1 AND part_id = $2 ORDER BY added_at DESC LIMIT 1`,
      [r.ticket_id, r.part_id]
    );

    if (r.ttspl_id) {
      const ticket = {
        ticket_id: r.ticket_id,
        ttspl_id: r.ttspl_id,
        serial_number: r.serial_number,
        vendor_serial_id: r.vendor_serial_id,
        ram: r.ram,
        storage: r.storage,
        processor: r.processor,
      };
      await revertConfigFromPartDetach(client, {
        partRequestOrPart: r,
        ticket,
        isUpgrade: r.request_type === 'upgrade',
        userId: req.user.user_id,
        userName: req.user.name,
        stageName: r.stage_name || null,
        reason,
      });
    }

    if (r.instance_id) {
      if (returnToInventory) {
        await client.query(
          `UPDATE part_instances
              SET status = 'in_stock', installed_ticket_id = NULL, installed_ttspl_id = NULL,
                  installed_at = NULL, updated_at = NOW()
            WHERE instance_id = $1`,
          [r.instance_id]
        );
        await recordMovement(client, {
          type: MOVEMENT.RETURNED_GOOD,
          partId: r.part_id,
          instanceId: r.instance_id,
          prtId: r.prt_id,
          serialNumber: r.instance_serial,
          category: r.category,
          partName: r.part_name,
          unitCost: parseFloat(r.instance_cost || r.catalog_cost || 0),
          requestId: Number(requestId),
          ticketId: r.ticket_id,
          ttsplId: r.ttspl_id,
          notes: reason || 'Detached from laptop — returned to inventory stock',
          actorUserId: req.user.user_id,
          actorName: req.user.name,
        });
      } else {
        await client.query(
          `UPDATE part_instances
              SET status = 'reserved', installed_ticket_id = NULL, installed_ttspl_id = NULL,
                  installed_at = NULL, updated_at = NOW()
            WHERE instance_id = $1`,
          [r.instance_id]
        );
        await recordMovement(client, {
          type: MOVEMENT.UNRESERVED,
          partId: r.part_id,
          instanceId: r.instance_id,
          prtId: r.prt_id,
          serialNumber: r.instance_serial,
          category: r.category,
          partName: r.part_name,
          unitCost: parseFloat(r.instance_cost || r.catalog_cost || 0),
          requestId: Number(requestId),
          ticketId: r.ticket_id,
          ttsplId: r.ttspl_id,
          notes: reason || 'Attached part removed — returned to reserved for re-attach',
          actorUserId: req.user.user_id,
          actorName: req.user.name,
        });
      }
    }

    const qty = Number(r.quantity) || 1;
    await client.query(
      `UPDATE parts SET quantity = COALESCE(quantity, 0) + $1, updated_at = NOW() WHERE part_id = $2`,
      [qty, r.part_id]
    );

    if (tpRes.rows[0]?.id) {
      await client.query(`DELETE FROM ticket_parts WHERE id = $1`, [tpRes.rows[0].id]);
    }

    if (returnToInventory) {
      await client.query(
        `UPDATE part_requests
            SET status = 'cancelled',
                instance_id = NULL,
                attached_by = NULL,
                attached_at = NULL,
                updated_at = NOW()
          WHERE request_id = $1`,
        [requestId]
      );
      await unblockTicket(client, r);
    } else {
      await client.query(
        `UPDATE part_requests
            SET status = 'approved',
                attached_by = NULL,
                attached_at = NULL,
                updated_at = NOW()
          WHERE request_id = $1`,
        [requestId]
      );

      if (r.blocks_stage) {
        await client.query(
          `INSERT INTO ticket_part_blocks (ticket_id, request_id, is_active, blocked_at)
           VALUES ($1, $2, true, NOW())
           ON CONFLICT (ticket_id, request_id)
           DO UPDATE SET is_active = true, unblocked_at = NULL, blocked_at = NOW()`,
          [r.ticket_id, r.request_id]
        );
        await client.query(
          `UPDATE tickets
              SET open_part_requests = COALESCE(open_part_requests, 0) + 1, updated_at = NOW()
            WHERE ticket_id = $1`,
          [r.ticket_id]
        );
      }
    }

    const detachNote = returnToInventory
      ? `Detached ${r.part_name} (${r.prt_id || 'no PRT'}) from laptop — returned to inventory.${reason ? ` Reason: ${reason}` : ''}`
      : `Removed attached part ${r.part_name} (${r.prt_id || 'no PRT'}). Request back to approved.${reason ? ` Reason: ${reason}` : ''}`;

    await client.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes)
       VALUES ($1, $2, 'part_detached', $3)`,
      [r.ticket_id, req.user.user_id, detachNote]
    );

    if (r.ttspl_id) {
      await logTtsplEvent({
        ttsplId: r.ttspl_id,
        vendorSerialId: r.vendor_serial_id,
        eventType: 'part_detached',
        description: returnToInventory
          ? `Part detached to inventory: ${r.part_name} (${r.prt_id || ''})`
          : `Attached part removed: ${r.part_name} (${r.prt_id || ''}) — request reset to approved`,
        metadata: {
          request_id: Number(requestId),
          part_id: r.part_id,
          prt_id: r.prt_id,
          reason: reason || null,
          return_to_inventory: returnToInventory,
        },
        actorUserId: req.user.user_id,
        actorName: req.user.name,
        db: client,
      });
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: returnToInventory
        ? `${r.part_name} detached from laptop and returned to inventory stock.`
        : `${r.part_name} removed from ticket. Part request is approved again — re-attach when ready.${r.blocks_stage ? ' Ticket blocked until re-attached.' : ''}`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('detachAttachedPart:', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// POST /api/part-requests/instances/:instanceId/detach-from-ttspl
// Detach an installed PRT unit from a TTSPL back to inventory stock.
// Works even when the unit was installed outside the part-request flow.
exports.detachInstalledPartFromTtspl = async (req, res) => {
  const client = await pool.connect();
  try {
    const { instanceId } = req.params;
    const reason = String(req.body?.reason || '').trim();
    const ttsplHint = String(req.body?.ttspl_id || '').trim();

    const linkedReq = await pool.query(
      `SELECT request_id FROM part_requests WHERE instance_id = $1 AND status = 'attached' LIMIT 1`,
      [Number(instanceId)]
    );
    if (linkedReq.rows.length) {
      client.release();
      req.params.requestId = String(linkedReq.rows[0].request_id);
      req.body = { ...(req.body || {}), return_to_inventory: true };
      return exports.detachAttachedPart(req, res);
    }

    await client.query('BEGIN');
    const instRes = await client.query(
      `SELECT pi.*, p.part_name, p.category, p.cost AS catalog_cost
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
        WHERE pi.instance_id = $1 FOR UPDATE OF pi`,
      [Number(instanceId)]
    );
    if (!instRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Part unit not found' });
    }
    const inst = instRes.rows[0];
    if (inst.status !== 'installed') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Only installed parts can be detached (current status: ${inst.status})`,
      });
    }
    if (
      ttsplHint
      && inst.installed_ttspl_id
      && inst.installed_ttspl_id.toUpperCase() !== ttsplHint.toUpperCase()
    ) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Part is installed on ${inst.installed_ttspl_id}, not ${ttsplHint}`,
      });
    }

    const ttsplId = inst.installed_ttspl_id;
    const ctx = ttsplId ? await resolveTtsplAsset(ttsplId) : null;

    await client.query(
      `UPDATE part_instances
          SET status = 'in_stock', installed_ticket_id = NULL, installed_ttspl_id = NULL,
              installed_at = NULL, updated_at = NOW()
        WHERE instance_id = $1`,
      [Number(instanceId)]
    );

    await recordMovement(client, {
      type: MOVEMENT.RETURNED_GOOD,
      partId: inst.part_id,
      instanceId: inst.instance_id,
      prtId: inst.prt_id,
      serialNumber: inst.serial_number,
      category: inst.category,
      partName: inst.part_name,
      unitCost: parseFloat(inst.unit_cost || inst.catalog_cost || 0),
      ticketId: inst.installed_ticket_id,
      ttsplId,
      notes: reason || 'Detached from TTSPL — returned to inventory stock',
      actorUserId: req.user.user_id,
      actorName: req.user.name,
    });

    await client.query(
      `UPDATE parts SET quantity = COALESCE(quantity, 0) + 1, updated_at = NOW() WHERE part_id = $1`,
      [inst.part_id]
    );

    if (inst.installed_ticket_id) {
      await client.query(
        `DELETE FROM ticket_parts WHERE ticket_id = $1 AND part_id = $2`,
        [inst.installed_ticket_id, inst.part_id]
      );
      await client.query(
        `INSERT INTO activities (ticket_id, user_id, action, notes)
         VALUES ($1, $2, 'part_detached', $3)`,
        [
          inst.installed_ticket_id,
          req.user.user_id,
          `Detached ${inst.part_name} (${inst.prt_id || 'no PRT'}) from ${ttsplId || 'laptop'} — returned to inventory.${reason ? ` Reason: ${reason}` : ''}`,
        ]
      );
    }

    if (ttsplId) {
      await logTtsplEvent({
        ttsplId: ctx?.canonicalTtspl || ttsplId,
        vendorSerialId: ctx?.serialId || inst.vendor_serial_id || null,
        eventType: 'part_detached',
        description: `Part detached to inventory: ${inst.part_name} (${inst.prt_id || ''})`,
        metadata: {
          instance_id: inst.instance_id,
          part_id: inst.part_id,
          prt_id: inst.prt_id,
          reason: reason || null,
          return_to_inventory: true,
        },
        actorUserId: req.user.user_id,
        actorName: req.user.name,
        db: client,
      });
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `${inst.part_name} detached and returned to inventory stock.`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('detachInstalledPartFromTtspl:', err);
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
      return res.status(400).json({
        success: false,
        message: pr.status === 'attached'
          ? 'Use Remove attached part — this request is already installed on the laptop.'
          : `Cannot cancel a request that is '${pr.status}'`,
      });
    }
    // Requester, floor manager, warehouse (released reserved PRT), or admin.
    const canCancel = PRIVILEGED.includes(req.user.role)
      || req.user.role === 'floor_manager'
      || req.user.role === 'warehouse'
      || Number(pr.requested_by) === Number(req.user.user_id);
    if (!canCancel) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You can only cancel your own requests' });
    }
    if (pr.instance_id) {
      await client.query(
        `UPDATE part_instances SET status = 'in_stock', updated_at = NOW()
          WHERE instance_id = $1 AND status IN ('reserved', 'in_stock')`,
        [pr.instance_id]
      );
      await recordUnreserved(client, pr, req.user, pr.status === 'approved' ? 'Approved request removed from ticket' : 'Request cancelled');
    }
    await client.query(`UPDATE part_requests SET status = 'cancelled', updated_at = NOW() WHERE request_id = $1`, [requestId]);
    await unblockTicket(client, pr);
    await client.query('COMMIT');
    res.json({
      success: true,
      message: pr.status === 'approved'
        ? 'Approved part removed from ticket. Reserved PRT returned to stock.'
        : 'Part request cancelled',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('cancelPartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

const WAREHOUSE_QUEUE_STATUSES = ['pending', 'escalated', 'ordered', 'received', 'approved'];

function partRequestMatchesSearch(row, search) {
  if (!search) return true;
  const q = search.toLowerCase();
  const hay = [
    row.request_number,
    row.part_name,
    row.ttspl_id,
    row.requester_name,
    row.stage_name,
    row.status,
  ]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return hay.includes(q);
}

function csvEscapePartExport(value) {
  return `"${String(value ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

function buildWarehouseQueueCsv(rows) {
  const header = [
    'Request #',
    'Status',
    'Type',
    'Part name',
    'TTSPL',
    'Laptop serial number',
    'Requester',
    'Stage',
    'Brand',
    'Model',
    'Created at',
    'Approved by',
  ];
  const body = rows.map((r) => [
    r.request_number,
    r.status,
    r.request_type,
    r.part_name,
    r.ttspl_id,
    r.laptop_serial_number,
    r.requester_name,
    r.stage_name,
    r.brand,
    r.model,
    r.created_at ? new Date(r.created_at).toISOString() : '',
    r.approver_name,
  ]);
  return [
    header.join(','),
    ...body.map((row) => row.map(csvEscapePartExport).join(',')),
  ].join('\r\n');
}

// GET /api/part-requests/warehouse-queue
exports.getWarehouseQueue = async (req, res) => {
  try {
    await ensurePartsSpecColumns(pool);
    const result = await pool.query(
      `${FULL_SELECT} WHERE pr.status = ANY($1::text[]) AND ${FLOOR_ONLY}
        ORDER BY CASE pr.status WHEN 'pending' THEN 0 WHEN 'received' THEN 1 WHEN 'ordered' THEN 2 ELSE 3 END,
                 pr.created_at ASC`,
      [WAREHOUSE_QUEUE_STATUSES]
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/part-requests/warehouse-queue/export.csv?scope=tab&statuses=...&search=...
exports.exportWarehouseQueueCsv = async (req, res) => {
  try {
    await ensurePartsSpecColumns(pool);
    const scope = String(req.query.scope || 'tab').toLowerCase();
    const search = String(req.query.search || '').trim();
    const statusesRaw = String(req.query.statuses || '').trim();

    let statuses = WAREHOUSE_QUEUE_STATUSES;
    if (scope === 'pending') {
      statuses = ['pending'];
    } else if (scope === 'tab') {
      const parsed = statusesRaw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      statuses = parsed.length ? parsed : ['pending'];
    }

    const result = await pool.query(
      `${FULL_SELECT} WHERE pr.status = ANY($1::text[]) AND ${FLOOR_ONLY}
        ORDER BY pr.created_at ASC`,
      [statuses]
    );

    const rows = result.rows.filter((row) => partRequestMatchesSearch(row, search));
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'No rows to export for the selected scope' });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const label = scope === 'tab' ? 'filtered' : scope;
    const csv = buildWarehouseQueueCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="parts-approval-${label}-${stamp}.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error('exportWarehouseQueueCsv:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/part-requests/procurement-queue
exports.getProcurementQueue = async (req, res) => {
  try {
    await ensurePartsSpecColumns(pool);
    const result = await pool.query(
      `${FULL_SELECT} WHERE pr.status IN ('escalated','ordered') AND ${FLOOR_ONLY} ORDER BY pr.created_at ASC`
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
      `SELECT pi.prt_id, pi.instance_id, p.part_name, pi.unit_cost, pi.installed_at,
              pr.request_id,
              COALESCE(pr.request_type, CASE WHEN tp.is_upgrade THEN 'upgrade' ELSE 'replacement' END) AS type
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
         LEFT JOIN part_requests pr ON pr.instance_id = pi.instance_id AND pr.status = 'attached'
         LEFT JOIN ticket_parts tp ON tp.part_id = pi.part_id AND tp.ticket_id = pi.installed_ticket_id
        WHERE UPPER(COALESCE(pi.installed_ttspl_id, '')) = ANY($1::text[])
          AND pi.status = 'installed'
        ORDER BY pi.installed_at DESC NULLS LAST`,
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
        instance_id: b.instance_id,
        request_id: b.request_id,
        part_name: b.part_name,
        unit_cost: parseFloat(b.unit_cost || 0),
        installed_at: b.installed_at,
        type: b.type,
        can_detach: Boolean(b.instance_id),
      })),
    });
  } catch (err) {
    console.error('getPartCostSummary:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/part-requests/instances?status=&part_id=&category=&brand=&model=&search=&limit=
// Optional: for_request_id + for_request_kind=floor|support → fit_status per row
exports.listPartInstances = async (req, res) => {
  try {
    await ensurePartInstanceSerialColumn(pool);
    const {
      status, part_id, category, brand, model, search, limit = 200,
      for_request_id, for_request_kind, include_incompatible,
      fits_laptop_brand, fits_laptop_model,
    } = req.query;
    const conditions = [];
    const params = [];
    if (status) { params.push(status); conditions.push(`pi.status = $${params.length}`); }
    if (part_id) { params.push(Number(part_id)); conditions.push(`pi.part_id = $${params.length}`); }
    if (category) { params.push(category); conditions.push(`p.category = $${params.length}`); }

    const brandExpr = `COALESCE(
      NULLIF(TRIM(pi.brand), ''),
      NULLIF(TRIM(vsn.extra->>'brand_name'), ''),
      NULLIF(TRIM(p.default_brand), '')
    )`;
    const modelExpr = `COALESCE(
      NULLIF(TRIM(pi.model), ''),
      NULLIF(TRIM(vsn.extra->>'model_name'), ''),
      NULLIF(TRIM(p.default_model), '')
    )`;

    // Spare vendor brand (legacy param) — keep for callers that still pass brand/model
    if (brand && String(brand).trim() && !fits_laptop_brand) {
      params.push(String(brand).trim().toLowerCase());
      conditions.push(`LOWER(${brandExpr}) = $${params.length}`);
    }
    if (model && String(model).trim() && !fits_laptop_model) {
      params.push(String(model).trim().toLowerCase());
      conditions.push(`LOWER(${modelExpr}) = $${params.length}`);
    }
    // Laptop fitment tagged at GRN
    if (fits_laptop_brand && String(fits_laptop_brand).trim()) {
      params.push(String(fits_laptop_brand).trim().toLowerCase());
      conditions.push(`LOWER(TRIM(COALESCE(pi.fits_laptop_brand, ''))) = $${params.length}`);
    }
    if (fits_laptop_model && String(fits_laptop_model).trim()) {
      params.push(String(fits_laptop_model).trim().toLowerCase());
      conditions.push(`EXISTS (
        SELECT 1 FROM UNNEST(COALESCE(pi.fits_laptop_models, ARRAY[]::text[])) AS m(val)
         WHERE LOWER(TRIM(m.val)) = $${params.length}
      )`);
    }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const i = params.length;
      conditions.push(`(pi.prt_id ILIKE $${i} OR pi.serial_number ILIKE $${i}
        OR p.part_name ILIKE $${i} OR pi.installed_ttspl_id ILIKE $${i}
        OR pi.location_code ILIKE $${i} OR pi.asset_code ILIKE $${i}
        OR COALESCE(pi.brand, '') ILIKE $${i} OR COALESCE(pi.model, '') ILIKE $${i}
        OR spo.purchase_order_number ILIKE $${i}
        OR COALESCE(vend.business_name, vend.first_name) ILIKE $${i})`);
    }

    // Fitment is matched in JS (services/partFitmentService.fits) rather than in
    // SQL so there is exactly one implementation of the rule. The row set here is
    // one part's stock, so the post-filter is cheap.
    let laptopBrand = null;
    let laptopModel = null;
    const showAll = String(include_incompatible || '').toLowerCase() === 'true'
      || include_incompatible === '1';
    if (for_request_id) {
      const kind = String(for_request_kind || 'floor').toLowerCase();
      if (kind === 'support') {
        const lr = await pool.query(
          `SELECT sti.brand, sti.model
             FROM support_part_requests spr
             LEFT JOIN support_ticket_items sti ON sti.id = spr.support_item_id
            WHERE spr.id = $1`,
          [Number(for_request_id)]
        );
        laptopBrand = lr.rows[0]?.brand || null;
        laptopModel = lr.rows[0]?.model || null;
      } else {
        const lr = await pool.query(
          `SELECT t.brand, t.model
             FROM part_requests pr
             LEFT JOIN tickets t ON t.ticket_id = pr.ticket_id
            WHERE pr.request_id = $1`,
          [Number(for_request_id)]
        );
        laptopBrand = lr.rows[0]?.brand || null;
        laptopModel = lr.rows[0]?.model || null;
      }
      await loadKnownBrands(pool);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    // The fit filter runs after the query, so fetch the whole stock of this part
    // before trimming — otherwise LIMIT could cut off the fitting units.
    params.push(for_request_id && !showAll ? 1000 : Math.min(1000, Number(limit) || 200));

    const result = await pool.query(
      `SELECT pi.instance_id, pi.prt_id, pi.serial_number, pi.part_id, pi.status, pi.location_code,
              pi.unit_cost, pi.notes, pi.installed_ttspl_id, pi.installed_ticket_id, pi.installed_at,
              pi.received_at, pi.created_at, pi.asset_code, pi.source, pi.spo_id, pi.grn_id,
              pi.vendor_repair_dc_number, pi.brand, pi.model, pi.spo_line_index,
              pi.removed_from_ttspl_id, pi.condition_on_removal,
              pi.fitment, pi.fits_laptop_brand, pi.fits_laptop_models,
              p.part_name, p.category, p.part_type, p.default_brand, p.default_model,
              spo.purchase_order_number, spo.purchase_order_date,
              COALESCE(pi.vendor_id, spo.vendor_id) AS vendor_id,
              COALESCE(NULLIF(TRIM(vend.business_name), ''), NULLIF(TRIM(vend.first_name), '')) AS vendor_name,
              ${brandExpr} AS brand_name,
              ${modelExpr} AS model_name
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
         LEFT JOIN vendor_spare_parts_purchase_orders spo ON spo.spo_id = pi.spo_id
         LEFT JOIN vendors vend ON vend.vendor_id = COALESCE(pi.vendor_id, spo.vendor_id)
         LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = pi.vendor_serial_id
         ${where}
         ORDER BY pi.created_at DESC, pi.instance_id DESC
         LIMIT $${params.length}`,
      params
    );

    // Fit status + fit-first ordering, so the picker sees the right unit on top.
    const FIT_RANK = { fit: 0, unknown: 1, unfit: 2 };
    let instances = result.rows.map((r) => ({
      ...r,
      fit_status: for_request_id ? fits(r, laptopBrand, laptopModel) : 'unknown',
    }));
    let fitCounts = null;
    if (for_request_id) {
      fitCounts = instances.reduce(
        (acc, r) => { acc[r.fit_status] += 1; acc.total += 1; return acc; },
        { fit: 0, unknown: 0, unfit: 0, total: 0 }
      );
      if (!showAll) instances = instances.filter((r) => r.fit_status !== 'unfit');
      instances.sort((a, b) => FIT_RANK[a.fit_status] - FIT_RANK[b.fit_status]);
      const cap = Math.min(1000, Number(limit) || 200);
      if (instances.length > cap) instances = instances.slice(0, cap);
    }

    // Filter dropdowns: laptop fitment tagged at GRN (authority for listing)
    const opts = await pool.query(
      `SELECT DISTINCT
         NULLIF(TRIM(pi.fits_laptop_brand), '') AS brand_name,
         NULLIF(TRIM(m.val), '') AS model_name,
         p.category
       FROM part_instances pi
       JOIN parts p ON p.part_id = pi.part_id
       LEFT JOIN LATERAL UNNEST(COALESCE(pi.fits_laptop_models, ARRAY[]::text[])) AS m(val) ON TRUE
       WHERE pi.fits_laptop_brand IS NOT NULL
          OR cardinality(COALESCE(pi.fits_laptop_models, ARRAY[]::text[])) > 0
          OR p.category IS NOT NULL`
    );
    const brands = [...new Set(opts.rows.map((r) => r.brand_name).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );
    const modelsByBrand = {};
    const models = [];
    for (const row of opts.rows) {
      if (row.model_name) {
        models.push(row.model_name);
        const b = row.brand_name || '';
        if (!modelsByBrand[b]) modelsByBrand[b] = new Set();
        modelsByBrand[b].add(row.model_name);
      }
    }
    const modelsUnique = [...new Set(models)].sort((a, b) => a.localeCompare(b));
    const models_by_brand = Object.fromEntries(
      Object.entries(modelsByBrand).map(([k, set]) => [k, [...set].sort((a, b) => a.localeCompare(b))])
    );

    const catOpts = await pool.query(
      `SELECT DISTINCT p.category FROM part_instances pi JOIN parts p ON p.part_id = pi.part_id WHERE p.category IS NOT NULL`
    );

    res.json({
      success: true,
      instances,
      laptop: for_request_id
        ? {
            brand: laptopBrand,
            model: laptopModel,
            for_request_id: Number(for_request_id),
            for_request_kind: for_request_kind || 'floor',
            counts: fitCounts,
          }
        : undefined,
      filters: {
        brands,
        models: modelsUnique,
        models_by_brand,
        categories: catOpts.rows.map((r) => r.category).filter(Boolean).sort(),
      },
    });
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
      fitment, fits_laptop_brand, fits_laptop_models,
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

    let fit;
    try {
      fit = validateFitment({ fitment, fits_laptop_brand, fits_laptop_models });
    } catch (e) {
      if (e instanceof FitmentValidationError) {
        return res.status(400).json({ success: false, message: e.message, code: e.code });
      }
      throw e;
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
            fitment, fits_laptop_brand, fits_laptop_models,
            received_by, received_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'in_stock',$6,$7,$8,$9,$10,NOW(),NOW(),NOW())
         RETURNING instance_id, prt_id, serial_number, status, location_code, unit_cost,
                   fitment, fits_laptop_brand, fits_laptop_models`,
        [
          prtId, s || null, Number(part_id), cost, location_code || null, notes || null,
          fit.fitment, fit.fits_laptop_brand, fit.fits_laptop_models,
          req.user.user_id,
        ]
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

// PATCH /api/part-requests/instances/:instanceId/fitment
exports.updatePartInstanceFitment = async (req, res) => {
  const client = await pool.connect();
  try {
    const { instanceId } = req.params;
    const { fitment, fits_laptop_brand, fits_laptop_models, reason } = req.body || {};
    let fit;
    try {
      fit = validateFitment({ fitment, fits_laptop_brand, fits_laptop_models });
    } catch (e) {
      if (e instanceof FitmentValidationError) {
        return res.status(400).json({ success: false, message: e.message, code: e.code });
      }
      throw e;
    }

    await client.query('BEGIN');
    const instRes = await client.query(
      `SELECT pi.*, p.part_name, p.category
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
        WHERE pi.instance_id = $1 FOR UPDATE OF pi`,
      [Number(instanceId)]
    );
    if (!instRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Part unit not found' });
    }
    const before = instRes.rows[0];
    const upd = await client.query(
      `UPDATE part_instances
          SET fitment = $2,
              fits_laptop_brand = $3,
              fits_laptop_models = $4,
              updated_at = NOW()
        WHERE instance_id = $1
        RETURNING instance_id, prt_id, fitment, fits_laptop_brand, fits_laptop_models`,
      [Number(instanceId), fit.fitment, fit.fits_laptop_brand, fit.fits_laptop_models]
    );

    await recordMovement(client, {
      type: MOVEMENT.FITMENT_RETAG,
      partId: before.part_id,
      instanceId: before.instance_id,
      prtId: before.prt_id,
      serialNumber: before.serial_number,
      category: before.category,
      partName: before.part_name,
      unitCost: before.unit_cost,
      notes: JSON.stringify({
        from: {
          fitment: before.fitment,
          fits_laptop_brand: before.fits_laptop_brand,
          fits_laptop_models: before.fits_laptop_models,
        },
        to: fit,
        reason: reason || null,
      }),
      actorUserId: req.user?.user_id,
      actorName: req.user?.name,
    });

    await client.query('COMMIT');
    res.json({ success: true, instance: upd.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updatePartInstanceFitment:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// POST /api/part-requests/instances/bulk-fitment
// Tag many units of one part in a single pass. Without this, the 1600+ units
// that predate fitment stay 'unset' for ever and the pick-list filter has
// nothing to narrow on.
exports.bulkUpdatePartInstanceFitment = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      part_id, instance_ids, status, only_untagged,
      fitment, fits_laptop_brand, fits_laptop_models, reason,
    } = req.body || {};

    let fit;
    try {
      fit = validateFitment({ fitment, fits_laptop_brand, fits_laptop_models });
    } catch (e) {
      if (e instanceof FitmentValidationError) {
        return res.status(400).json({ success: false, message: e.message, code: e.code });
      }
      throw e;
    }

    const ids = Array.isArray(instance_ids)
      ? instance_ids.map(Number).filter(Number.isFinite)
      : [];
    if (!ids.length && !part_id) {
      return res.status(400).json({
        success: false,
        message: 'Pass instance_ids, or a part_id to tag that part\'s units',
      });
    }

    const conditions = [];
    const params = [];
    if (ids.length) {
      params.push(ids);
      conditions.push(`pi.instance_id = ANY($${params.length}::int[])`);
    }
    if (part_id) {
      params.push(Number(part_id));
      conditions.push(`pi.part_id = $${params.length}`);
    }
    if (status) {
      params.push(String(status));
      conditions.push(`pi.status = $${params.length}`);
    }
    if (only_untagged === true || String(only_untagged) === 'true') {
      conditions.push(`COALESCE(pi.fitment, 'unset') = 'unset'`);
    }

    await client.query('BEGIN');
    const sel = await client.query(
      `SELECT pi.instance_id, pi.part_id, pi.prt_id, pi.serial_number, pi.unit_cost,
              pi.fitment, pi.fits_laptop_brand, pi.fits_laptop_models,
              p.part_name, p.category
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY pi.instance_id
        FOR UPDATE OF pi`,
      params
    );

    if (!sel.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ success: true, updated: 0, message: 'No units matched' });
    }

    const targetIds = sel.rows.map((r) => r.instance_id);
    await client.query(
      `UPDATE part_instances
          SET fitment = $2,
              fits_laptop_brand = $3,
              fits_laptop_models = $4,
              updated_at = NOW()
        WHERE instance_id = ANY($1::int[])`,
      [targetIds, fit.fitment, fit.fits_laptop_brand, fit.fits_laptop_models]
    );

    for (const before of sel.rows) {
      await recordMovement(client, {
        type: MOVEMENT.FITMENT_RETAG,
        partId: before.part_id,
        instanceId: before.instance_id,
        prtId: before.prt_id,
        serialNumber: before.serial_number,
        category: before.category,
        partName: before.part_name,
        unitCost: before.unit_cost,
        notes: JSON.stringify({
          from: {
            fitment: before.fitment,
            fits_laptop_brand: before.fits_laptop_brand,
            fits_laptop_models: before.fits_laptop_models,
          },
          to: fit,
          reason: reason || 'Bulk fitment tagging',
          bulk: true,
        }),
        actorUserId: req.user?.user_id,
        actorName: req.user?.name,
      });
    }

    await client.query('COMMIT');
    res.json({ success: true, updated: targetIds.length, fitment: fit });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('bulkUpdatePartInstanceFitment:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ---------------------------------------------------------------------------
// PD8 — old parts to collect. The technician records the removed part at
// fitting (a defective_return unit); the warehouse confirms it has it.
// ---------------------------------------------------------------------------
// GET /api/part-requests/old-parts/to-collect
exports.listOldPartsToCollect = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT pi.instance_id, pi.prt_id, pi.status, pi.condition_on_removal, pi.removed_at, pi.serial_number,
              pi.removed_from_ttspl_id AS ttspl_id, pi.removed_from_ticket_id AS ticket_id, pi.notes,
              p.part_name, p.category, pr.request_number, u.name AS technician_name
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
         LEFT JOIN part_requests pr ON pr.request_id = pi.origin_request_id
         LEFT JOIN users u ON u.user_id = pr.requested_by
        WHERE pi.source = 'defective_return' AND pi.collected_at IS NULL
          AND pi.removed_at > NOW() - interval '180 days'
        ORDER BY pi.removed_at ASC
        LIMIT 500`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('listOldPartsToCollect:', err);
    res.status(500).json({ success: false, message: 'Could not load old parts' });
  }
};

// POST /api/part-requests/old-parts/:instanceId/collect  body: { location_code?, condition? }
exports.collectOldPart = async (req, res) => {
  try {
    const id = Number(req.params.instanceId);
    const cond = req.body?.condition;
    const u = await pool.query(
      `UPDATE part_instances
          SET collected_at = NOW(), collected_by = $2,
              location_code = COALESCE(NULLIF($3, ''), location_code), updated_at = NOW()
        WHERE instance_id = $1 AND source = 'defective_return' AND collected_at IS NULL
        RETURNING instance_id, prt_id, part_id, status`,
      [id, req.user.user_id, String(req.body?.location_code || '').trim()]
    );
    if (!u.rows.length) return res.status(409).json({ success: false, message: 'Already collected, or not an old part.' });
    // The warehouse can correct the condition the technician recorded.
    if (cond === 'defective' && u.rows[0].status === 'in_stock') {
      await pool.query(`UPDATE part_instances SET status = 'defective', updated_at = NOW() WHERE instance_id = $1`, [id]);
      await pool.query('UPDATE parts SET quantity = GREATEST(COALESCE(quantity, 0) - 1, 0), updated_at = NOW() WHERE part_id = $1', [u.rows[0].part_id]);
    }
    res.json({ success: true, message: `${u.rows[0].prt_id} collected` });
  } catch (err) {
    console.error('collectOldPart:', err);
    res.status(500).json({ success: false, message: 'Could not record it' });
  }
};
