const pool = require('../config/db');
const { recordMovement, MOVEMENT } = require('../services/partMovementService');
const { normalizePartStructure } = require('../constants/partNaming');
const { CATALOGUE_PART_CATEGORY_VALUES } = require('../constants/laptopConditions');

function isBatteryPart(part) {
  // Structured parts (part naming redesign): only a laptop battery, not a CMOS
  // battery or a battery connector, needs the battery model number + photo.
  const kind = String(part?.part_type || '').toLowerCase().trim();
  if (String(part?.category || '').toLowerCase().trim() === 'battery'
    && ['battery', 'cmos_battery', 'battery_connector'].includes(kind)) return kind === 'battery';
  const cat = String(part?.category || part?.part_type || '').toLowerCase().trim();
  const name = String(part?.part_name || '').toLowerCase();
  return cat === 'battery' || cat.includes('battery') || name.includes('battery');
}

/**
 * Search words → ILIKE patterns. "8gb" also matches "8 GB" (a digit run and
 * the unit after it may be split by a space). At most six words.
 */
function searchWords(search) {
  return String(search || '')
    .toLowerCase()
    .replace(/[%_\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => `%${w.replace(/(\d)([a-z])/g, '$1%$2')}%`);
}

// Get All Parts — optional ?search= (every word must match)
exports.getAllParts = async (req, res) => {
  try {
    const search = String(req.query.search || req.query.q || '').trim();
    // The catalogue page asks for every part; 500 used to cut it short silently.
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 2000);
    const params = [];
    let where = 'WHERE 1=1';
    // Every word must match somewhere: name, category, kind, specs, fits,
    // part number. "8gb ddr4" finds "RAM 8 GB DDR4 SODIMM"; "battery 5420"
    // finds "Battery · Dell Latitude 5420".
    for (const word of searchWords(search)) {
      params.push(word);
      const i = params.length;
      where += ` AND (p.part_name ILIKE $${i} OR p.category ILIKE $${i} OR COALESCE(p.part_type, '') ILIKE $${i}
                  OR COALESCE(p.specs::text, '') ILIKE $${i} OR COALESCE(p.model_number, '') ILIKE $${i}
                  OR COALESCE(p.part_sku, '') ILIKE $${i}
                  OR COALESCE(array_to_string(p.compatible_models, ' '), '') ILIKE $${i}
                  OR COALESCE(array_to_string(p.compatible_brands, ' '), '') ILIKE $${i})`;
    }
    params.push(limit);
    const result = await pool.query(
      `SELECT p.part_id, p.part_name, p.part_type, p.category, p.quantity, p.vendor, p.cost,
              p.location_code, p.model_number, p.pin_size, p.part_sku, p.description,
              p.compatible_brands, p.compatible_models, p.default_fitment,
              p.default_brand, p.default_model, p.specs, p.name_override, p.spec_key,
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
// A part is category + kind + specs + fits; its name is generated from them
// (constants/partNaming.js) unless name_override is set. Two parts with the
// same structure are the same part (spec_key) and the second is refused.
//
// "Initial quantity" used to set parts.quantity with no units behind it — stock
// nobody could reserve, scan or label (P3). It now creates that many tracked
// units (PRT ids, ledger rows) in the same transaction as the part.

/** The structure fields of a request body, in the shape normalizePartStructure takes. */
function structureFromBody(body, current = {}) {
  const has = (k) => body[k] !== undefined;
  return {
    category: has('category') ? body.category : current.category,
    kind: has('kind') ? body.kind : has('part_type') ? body.part_type : current.part_type,
    specs: has('specs') ? body.specs : current.specs,
    default_fitment: has('default_fitment') ? body.default_fitment : current.default_fitment,
    compatible_brands: has('compatible_brands') ? toBrandArray(body.compatible_brands) || [] : current.compatible_brands || [],
    compatible_models: has('compatible_models') ? toModelArray(body.compatible_models) || [] : current.compatible_models || [],
    name_override: has('name_override') ? body.name_override === true || body.name_override === 'true' : Boolean(current.name_override),
    part_name: has('part_name') ? body.part_name : current.part_name,
  };
}

/** Another live part with the same structure (spec_key) or the same name. */
async function findDuplicate(db, { specKey, name, category, modelNumber, excludeId }) {
  const r = await db.query(
    `SELECT part_id, part_name,
            (spec_key IS NOT NULL AND spec_key = $1) AS same_structure
       FROM parts
      WHERE archived IS NOT TRUE
        AND ($5::int IS NULL OR part_id <> $5)
        AND ((spec_key IS NOT NULL AND spec_key = $1)
          OR (LOWER(TRIM(part_name)) = LOWER($2)
              AND LOWER(COALESCE(category, part_type, 'general')) = LOWER($3)
              AND LOWER(COALESCE(TRIM(model_number), '')) = LOWER($4)))
      ORDER BY same_structure DESC
      LIMIT 1`,
    [specKey || null, name, category, modelNumber || '', excludeId || null]
  );
  return r.rows[0] || null;
}

function duplicateMessage(dup) {
  return dup.same_structure
    ? `This part is already in the catalogue as "${dup.part_name}" (part #${dup.part_id}) — same category, details and fits. Add units to it instead.`
    : `"${dup.part_name}" is already in the catalogue (part #${dup.part_id}) — add units to it instead`;
}

exports.createPart = async (req, res) => {
  const body = req.body || {};
  const {
    quantity, vendor, cost, location_code, description, part_sku,
    is_consumable, warranty_months, notes, min_threshold, model_number, pin_size,
  } = body;

  if (cost != null && cost !== '' && !(Number(cost) >= 0)) {
    return res.status(400).json({ success: false, message: 'Unit cost must be zero or more' });
  }
  const opening = quantity == null || quantity === '' ? 0 : Number(quantity);
  if (!Number.isInteger(opening) || opening < 0 || opening > 500) {
    return res.status(400).json({ success: false, message: 'Opening quantity must be a whole number from 0 to 500' });
  }
  if (body.kind === undefined && body.specs === undefined) {
    // Old Parts Inventory screens send a free-text name; the catalogue now
    // needs the structure the name is generated from.
    return res.status(400).json({
      success: false,
      message: 'Add parts from Stock → Parts catalogue: choose the category, what it is and its details — the name is made from them.',
    });
  }
  const { ok, errors, value: st } = normalizePartStructure(structureFromBody(body));
  if (!ok) {
    return res.status(400).json({ success: false, message: `${errors.join('. ')}.`, errors });
  }
  const modelNo = model_number ? String(model_number).trim() : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dup = await findDuplicate(client, {
      specKey: st.spec_key, name: st.part_name, category: st.category, modelNumber: modelNo,
    });
    if (dup) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: duplicateMessage(dup), part_id: dup.part_id });
    }
    const result = await client.query(
      `INSERT INTO parts
         (part_name, part_type, quantity, vendor, cost, location_code,
          category, description, part_sku, compatible_brands, compatible_models,
          default_fitment, is_consumable,
          warranty_months, notes, min_threshold, model_number, pin_size,
          specs, name_override, spec_key)
       VALUES ($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        st.part_name, st.part_type, vendor || null, Number(cost) || 0, location_code || null,
        st.category, description || null, part_sku || null, st.compatible_brands, st.compatible_models,
        st.default_fitment,
        is_consumable === true || is_consumable === 'true',
        Number(warranty_months) || 0, notes || null,
        min_threshold != null && min_threshold !== '' && Number.isFinite(Number(min_threshold)) ? Number(min_threshold) : 5,
        modelNo,
        pin_size ? String(pin_size).trim() : null,
        JSON.stringify(st.specs), st.name_override, st.spec_key,
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
        `INSERT INTO vendor_spare_parts_catalog (name, active, floor_part_id, category, part_type, model_number, pin_size)
         SELECT $1, true, $2, $3, $4, $5, $6
          WHERE NOT EXISTS (SELECT 1 FROM vendor_spare_parts_catalog WHERE floor_part_id = $2)`,
        [part.part_name, part.part_id, st.category, st.part_type, part.model_number || null, part.pin_size || null]
      );
      await client.query('RELEASE SAVEPOINT catalog_sync');
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT catalog_sync');
      console.warn('[createPart] catalog sync (non-fatal):', e.message);
    }

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: units.length ? `${part.part_name} added with ${units.length} unit(s) in stock` : `${part.part_name} added`,
      part,
      units,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'This part is already in the catalogue — same category, details and fits.' });
    }
    console.error('Create part error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating part',
    });
  } finally {
    client.release();
  }
};

// Fields that make up a part's identity and name.
const STRUCTURE_FIELDS = ['kind', 'specs', 'name_override', 'category', 'part_type', 'part_name', 'default_fitment', 'compatible_brands', 'compatible_models'];
const sameList = (a, b) => JSON.stringify((a || []).map(String)) === JSON.stringify((b || []).map(String));

/**
 * Did a legacy (unstructured) request try to change a structured part's
 * identity? Old screens resend every field unchanged, which is fine.
 */
function legacyIdentityChange(body, cur) {
  const changed = [];
  const str = (v) => String(v ?? '').trim().toLowerCase();
  if (body.part_name !== undefined && str(body.part_name) !== str(cur.part_name)) changed.push('name');
  if (body.category !== undefined && str(body.category) !== str(cur.category)) changed.push('category');
  if (body.part_type !== undefined && str(body.part_type) !== str(cur.part_type) && str(body.part_type) !== str(cur.category)) changed.push('type');
  if (body.default_fitment !== undefined && str(body.default_fitment) !== str(cur.default_fitment)) changed.push('fitment');
  if (body.compatible_brands !== undefined && !sameList(toBrandArray(body.compatible_brands) || [], cur.compatible_brands || [])) changed.push('fits brand');
  if (body.compatible_models !== undefined && !sameList(toModelArray(body.compatible_models) || [], cur.compatible_models || [])) changed.push('fits models');
  return changed;
}

// Update Part Details
//
// With `kind` or `specs` in the body (the Parts catalogue form) the whole
// structure is validated and the name regenerated. Without them (old screens,
// or a price / minimum-stock edit) only the plain fields change; on a part
// that already has a structure its name, category, kind and fits are refused
// there, so a generated name never drifts from its details.
exports.updatePart = async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const {
    vendor, cost, location_code, description, part_sku, is_consumable,
    warranty_months, notes, min_threshold, model_number, pin_size,
  } = body;
  if (cost != null && cost !== '' && !(Number(cost) >= 0)) {
    return res.status(400).json({ success: false, message: 'Unit cost must be zero or more' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query('SELECT * FROM parts WHERE part_id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Part not found' });
    }

    const structured = body.kind !== undefined || body.specs !== undefined;
    let st = null;
    if (structured) {
      const n = normalizePartStructure(structureFromBody(body, cur));
      if (!n.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: `${n.errors.join('. ')}.`, errors: n.errors });
      }
      st = n.value;
      const modelNo = model_number !== undefined ? (model_number ? String(model_number).trim() : null) : cur.model_number;
      const dup = await findDuplicate(client, {
        specKey: st.spec_key, name: st.part_name, category: st.category, modelNumber: modelNo, excludeId: cur.part_id,
      });
      if (dup) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: duplicateMessage(dup), part_id: dup.part_id });
      }
    } else if (cur.spec_key) {
      const changed = legacyIdentityChange(body, cur);
      if (changed.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `This part's name comes from its details — change its ${changed.join(', ')} in Stock → Parts catalogue.`,
        });
      }
    } else if (body.category !== undefined && body.category !== null && body.category !== ''
      && !CATALOGUE_PART_CATEGORY_VALUES.includes(String(body.category).trim().toLowerCase())) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Category must be one of: ${CATALOGUE_PART_CATEGORY_VALUES.join(', ')}` });
    }

    // Legacy path on an unstructured part: the old behaviour (COALESCE keeps
    // what is not sent). Structured path: the normalised structure wins.
    const legacyOpen = !structured && !cur.spec_key;
    const brands = st ? st.compatible_brands
      : legacyOpen && body.compatible_brands !== undefined ? toBrandArray(body.compatible_brands) : null;
    const models = st ? st.compatible_models
      : legacyOpen && body.compatible_models !== undefined ? toModelArray(body.compatible_models) : null;
    const fitment = st ? st.default_fitment
      : legacyOpen && body.default_fitment !== undefined ? normalizeDefaultFitment(body.default_fitment) : null;
    const result = await client.query(
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
           specs = COALESCE($19::jsonb, specs),
           name_override = COALESCE($20, name_override),
           spec_key = COALESCE($21, spec_key),
           updated_at = NOW()
       WHERE part_id = $6
       RETURNING *`,
      [
        st ? st.part_name : legacyOpen && body.part_name ? String(body.part_name).trim() : null,
        st ? st.part_type : legacyOpen && body.part_type ? String(body.part_type).trim() : null,
        vendor, cost === '' ? null : cost, location_code, id,
        st ? st.category : legacyOpen && body.category ? String(body.category).trim().toLowerCase() : null,
        description || null, part_sku || null, brands,
        typeof is_consumable === 'boolean' ? is_consumable : null,
        warranty_months != null && warranty_months !== '' ? Number(warranty_months) : null,
        notes || null,
        min_threshold != null && min_threshold !== '' ? Number(min_threshold) : null,
        model_number !== undefined ? (model_number ? String(model_number).trim() : null) : null,
        pin_size !== undefined ? (pin_size ? String(pin_size).trim() : null) : null,
        models,
        fitment,
        st ? JSON.stringify(st.specs) : null,
        st ? st.name_override : null,
        st ? st.spec_key : null,
      ]
    );
    const part = result.rows[0];

    await client.query('SAVEPOINT catalog_sync');
    try {
      await client.query(
        `UPDATE vendor_spare_parts_catalog
            SET name = COALESCE($2, name),
                category = COALESCE($3, category),
                part_type = COALESCE($6, part_type),
                model_number = COALESCE($4, model_number),
                pin_size = COALESCE($5, pin_size),
                updated_at = NOW()
          WHERE floor_part_id = $1`,
        [id, part.part_name, part.category, part.model_number, part.pin_size, st ? st.part_type : null]
      );
      await client.query('RELEASE SAVEPOINT catalog_sync');
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT catalog_sync');
      console.warn('[updatePart] catalog sync (non-fatal):', e.message);
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Part updated successfully',
      part,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Another part already has this category, details and fits.' });
    }
    console.error('Update part error:', error);
    res.status(500).json({ success: false, message: 'Server error updating part' });
  } finally {
    client.release();
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
