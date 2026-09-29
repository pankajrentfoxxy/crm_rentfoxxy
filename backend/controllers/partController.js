const pool = require('../config/db');
const { recordMovement, MOVEMENT } = require('../services/partMovementService');

function isBatteryPart(part) {
  const cat = String(part?.category || part?.part_type || '').toLowerCase().trim();
  const name = String(part?.part_name || '').toLowerCase();
  return cat === 'battery' || cat.includes('battery') || name.includes('battery');
}

// Get All Parts — optional ?search= filters by part_name (case-insensitive)
exports.getAllParts = async (req, res) => {
  try {
    const search = String(req.query.search || req.query.q || '').trim();
    // The catalogue page asks for every part; 500 used to cut it short silently.
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 2000);
    const params = [];
    let where = 'WHERE 1=1';
    if (search) {
      params.push(`%${search}%`);
      where += ` AND p.part_name ILIKE $${params.length}`;
    }
    params.push(limit);
    const result = await pool.query(
      `SELECT p.part_id, p.part_name, p.part_type, p.category, p.quantity, p.vendor, p.cost,
              p.location_code, p.model_number, p.pin_size, p.part_sku, p.description,
              p.compatible_brands, p.compatible_models, p.default_fitment,
              p.default_brand, p.default_model,
              -- The edit form needs these; without them saving a part reset its
              -- minimum to 5, warranty to 0 and consumable to false.
              p.min_threshold, p.is_consumable, p.warranty_months, p.notes, p.archived,
              p.created_at, p.updated_at,
              COALESCE(st.in_stock_count, 0)::int AS in_stock_count,
              COALESCE(st.reserved_count, 0)::int AS reserved_count,
              COALESCE(st.installed_count, 0)::int AS installed_count,
              COALESCE(st.defective_count, 0)::int AS defective_count,
              COALESCE(st.unit_count, 0)::int AS unit_count
         FROM parts p
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE pi.status = 'in_stock') AS in_stock_count,
                  COUNT(*) FILTER (WHERE pi.status = 'reserved') AS reserved_count,
                  COUNT(*) FILTER (WHERE pi.status = 'installed') AS installed_count,
                  COUNT(*) FILTER (WHERE pi.status = 'defective') AS defective_count,
                  COUNT(*) AS unit_count
             FROM part_instances pi
            WHERE pi.part_id = p.part_id
         ) st ON true
        ${where}
        ORDER BY p.part_name ASC
        LIMIT $${params.length}`,
      params
    );

    res.json({
      success: true,
      count: result.rows.length,
      parts: result.rows,
    });
  } catch (error) {
    console.error('Get parts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching parts',
    });
  }
};

function toBrandArray(val) {
  if (val == null || val === '') return null;
  if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean);
  return String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toModelArray(val) {
  return toBrandArray(val);
}

function normalizeDefaultFitment(val) {
  const f = String(val || 'unset').toLowerCase();
  return ['unset', 'universal', 'specific'].includes(f) ? f : 'unset';
}

// Create Part
//
// "Initial quantity" used to set parts.quantity with no units behind it — stock
// nobody could reserve, scan or label (P3). It now creates that many tracked
// units (PRT ids, ledger rows) in the same transaction as the part.
exports.createPart = async (req, res) => {
  const {
    part_name, part_type, quantity, vendor, cost, location_code,
    category, description, part_sku, compatible_brands, compatible_models,
    default_fitment, is_consumable,
    warranty_months, notes, min_threshold, model_number, pin_size,
  } = req.body || {};

  const name = String(part_name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, message: 'Part name is required' });
  }
  if (cost != null && cost !== '' && !(Number(cost) >= 0)) {
    return res.status(400).json({ success: false, message: 'Unit cost must be zero or more' });
  }
  const opening = quantity == null || quantity === '' ? 0 : Number(quantity);
  if (!Number.isInteger(opening) || opening < 0 || opening > 500) {
    return res.status(400).json({ success: false, message: 'Opening quantity must be a whole number from 0 to 500' });
  }
  const cat = (category || part_type || 'general').toString().trim().toLowerCase() || 'general';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Same name, category and model number is the same part: a second row splits
    // its stock and its requests between two catalogue entries.
    const dup = await client.query(
      `SELECT part_id, part_name FROM parts
        WHERE LOWER(TRIM(part_name)) = LOWER($1)
          AND LOWER(COALESCE(category, part_type, 'general')) = LOWER($2)
          AND LOWER(COALESCE(TRIM(model_number), '')) = LOWER($3)
        LIMIT 1`,
      [name, cat, model_number ? String(model_number).trim() : '']
    );
    if (dup.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `"${dup.rows[0].part_name}" is already in the catalogue (part #${dup.rows[0].part_id}) — add units to it instead`,
        part_id: dup.rows[0].part_id,
      });
    }
    const fitment = normalizeDefaultFitment(default_fitment);
    const brands = toBrandArray(compatible_brands);
    const models = toModelArray(compatible_models);
    const result = await client.query(
      `INSERT INTO parts
         (part_name, part_type, quantity, vendor, cost, location_code,
          category, description, part_sku, compatible_brands, compatible_models,
          default_fitment, is_consumable,
          warranty_months, notes, min_threshold, model_number, pin_size)
       VALUES ($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        name, (part_type && String(part_type).trim()) || cat, vendor || null, Number(cost) || 0, location_code || null,
        cat, description || null, part_sku || null, brands, models,
        fitment,
        is_consumable === true || is_consumable === 'true',
        Number(warranty_months) || 0, notes || null,
        min_threshold != null && min_threshold !== '' && Number.isFinite(Number(min_threshold)) ? Number(min_threshold) : 5,
        model_number ? String(model_number).trim() : null,
        pin_size ? String(pin_size).trim() : null,
      ]
    );
    let part = result.rows[0];

    let units = [];
    if (opening > 0) {
      const { addUnitsByHand } = require('../services/partInventoryService');
      ({ created: units } = await addUnitsByHand(client, {
        partId: part.part_id,
        serials: Array.from({ length: opening }, () => null),
        unitCost: part.cost,
        locationCode: part.location_code,
        notes: 'Opening stock when the part was added',
        fit: null,
        receivedBy: req.user?.user_id,
        actorName: req.user?.name || req.user?.email || null,
      }));
      part = { ...part, quantity: units.length };
    }

    await client.query('SAVEPOINT catalog_sync');
    try {
      await client.query(
        `INSERT INTO vendor_spare_parts_catalog (name, active, floor_part_id, category, model_number, pin_size)
         SELECT $1, true, $2, $3, $4, $5
          WHERE NOT EXISTS (SELECT 1 FROM vendor_spare_parts_catalog WHERE floor_part_id = $2)`,
        [part.part_name, part.part_id, cat, part.model_number || null, part.pin_size || null]
      );
      await client.query('RELEASE SAVEPOINT catalog_sync');
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT catalog_sync');
      console.warn('[createPart] catalog sync (non-fatal):', e.message);
    }

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: units.length ? `Part created with ${units.length} unit(s) in stock` : 'Part created successfully',
      part,
      units,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Create part error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating part',
    });
  } finally {
    client.release();
  }
};

// Update Part Details
exports.updatePart = async (req, res) => {
  const { id } = req.params;
  const {
    part_name, part_type, vendor, cost, location_code,
    category, description, part_sku, compatible_brands, compatible_models,
    default_fitment, is_consumable,
    warranty_months, notes, min_threshold, model_number, pin_size,
  } = req.body;

  try {
    const brands = compatible_brands === undefined ? null : toBrandArray(compatible_brands);
    const models = compatible_models === undefined ? null : toModelArray(compatible_models);
    const fitment = default_fitment === undefined ? null : normalizeDefaultFitment(default_fitment);
    const result = await pool.query(
      `UPDATE parts 
       SET part_name = COALESCE($1, part_name),
           part_type = COALESCE($2, part_type),
           vendor = COALESCE($3, vendor),
           cost = COALESCE($4, cost),
           location_code = COALESCE($5, location_code),
           category = COALESCE($7, category),
           description = COALESCE($8, description),
           part_sku = COALESCE($9, part_sku),
           compatible_brands = COALESCE($10, compatible_brands),
           is_consumable = COALESCE($11, is_consumable),
           warranty_months = COALESCE($12, warranty_months),
           notes = COALESCE($13, notes),
           min_threshold = COALESCE($14, min_threshold),
           model_number = COALESCE($15, model_number),
           pin_size = COALESCE($16, pin_size),
           compatible_models = COALESCE($17, compatible_models),
           default_fitment = COALESCE($18, default_fitment),
           updated_at = NOW()
       WHERE part_id = $6
       RETURNING *`,
      [
        part_name, part_type, vendor, cost, location_code, id,
        category || null, description || null, part_sku || null, brands,
        typeof is_consumable === 'boolean' ? is_consumable : null,
        warranty_months != null && warranty_months !== '' ? Number(warranty_months) : null,
        notes || null,
        min_threshold != null && min_threshold !== '' ? Number(min_threshold) : null,
        model_number !== undefined ? (model_number ? String(model_number).trim() : null) : null,
        pin_size !== undefined ? (pin_size ? String(pin_size).trim() : null) : null,
        models,
        fitment,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Part not found' });
    }

    const part = result.rows[0];
    try {
      await pool.query(
        `UPDATE vendor_spare_parts_catalog
            SET name = COALESCE($2, name),
                category = COALESCE($3, category),
                model_number = COALESCE($4, model_number),
                pin_size = COALESCE($5, pin_size),
                updated_at = NOW()
          WHERE floor_part_id = $1`,
        [id, part.part_name, part.category, part.model_number, part.pin_size]
      );
    } catch (_) { /* catalog sync optional */ }

    res.json({
      success: true,
      message: 'Part updated successfully',
      part,
    });
  } catch (error) {
    console.error('Update part error:', error);
    res.status(500).json({ success: false, message: 'Server error updating part' });
  }
};

exports.getPartUsage = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT tp.quantity_used, tp.notes, tp.added_at,
              t.ticket_id, t.serial_number, t.machine_number,
              u.name AS technician_name
       FROM ticket_parts tp
       JOIN tickets t ON t.ticket_id = tp.ticket_id
       LEFT JOIN LATERAL (
         SELECT wl.user_id FROM work_logs wl
         WHERE wl.ticket_id = t.ticket_id
         ORDER BY wl.start_time DESC LIMIT 1
       ) wl ON TRUE
       LEFT JOIN users u ON u.user_id = wl.user_id
       WHERE tp.part_id = $1
       ORDER BY tp.added_at DESC
       LIMIT 100`,
      [id]
    );
    res.json({ success: true, usage: result.rows });
  } catch (error) {
    console.error('Get part usage error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching part usage' });
  }
};

// PUT /api/parts/:id/quantity  { quantity: <signed delta>, reason? }
//
// Only the counter: tracked parts count their units (in_stock_count), so this
// is for consumables (paste, screws) that have no units. It took any value —
// "abc" was a 500 and a big negative left the count below zero — and wrote no
// ledger row. Now: a whole non-zero delta, never below zero, logged.
exports.updatePartQuantity = async (req, res) => {
  const { id } = req.params;
  const delta = Number(req.body?.quantity);
  const reason = String(req.body?.reason || '').trim();
  if (!Number.isInteger(delta) || delta === 0) {
    return res.status(400).json({ success: false, message: 'quantity must be a whole number other than 0 (the change, e.g. -2 or 5)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      'SELECT part_id, part_name, category, cost, quantity FROM parts WHERE part_id = $1 FOR UPDATE',
      [id]
    );
    if (!cur.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Part not found' });
    }
    const before = Number(cur.rows[0].quantity) || 0;
    if (before + delta < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Only ${before} on record — cannot take off ${-delta}` });
    }
    const result = await client.query(
      'UPDATE parts SET quantity = $1, updated_at = NOW() WHERE part_id = $2 RETURNING *',
      [before + delta, id]
    );
    await recordMovement(client, {
      type: MOVEMENT.ADJUSTED,
      partId: cur.rows[0].part_id,
      category: cur.rows[0].category,
      partName: cur.rows[0].part_name,
      quantity: delta,
      unitCost: cur.rows[0].cost,
      notes: `Count ${before} → ${before + delta}${reason ? ` — ${reason}` : ''}`,
      actorUserId: req.user?.user_id,
      actorName: req.user?.name || req.user?.email || null,
    });
    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Part quantity updated successfully',
      part: result.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Update part quantity error:', error);
    res.status(500).json({ success: false, message: 'Server error updating part' });
  } finally {
    client.release();
  }
};

exports.isBatteryPart = isBatteryPart;
