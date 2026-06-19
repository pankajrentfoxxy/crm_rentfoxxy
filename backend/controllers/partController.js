const pool = require('../config/db');

// Get All Parts
exports.getAllParts = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM parts ORDER BY part_name ASC'
    );

    res.json({
      success: true,
      count: result.rows.length,
      parts: result.rows
    });
  } catch (error) {
    console.error('Get parts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching parts'
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

// Create Part
exports.createPart = async (req, res) => {
  const {
    part_name, part_type, quantity, vendor, cost, location_code,
    category, description, part_sku, compatible_brands, is_consumable,
    warranty_months, notes, min_threshold
  } = req.body;

  try {
    // category drives the spare-parts catalog link; default to part_type.
    const cat = (category || part_type || 'general').toString();
    const result = await pool.query(
      `INSERT INTO parts
         (part_name, part_type, quantity, vendor, cost, location_code,
          category, description, part_sku, compatible_brands, is_consumable,
          warranty_months, notes, min_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        part_name, part_type, quantity || 0, vendor, cost || 0, location_code,
        cat, description || null, part_sku || null, toBrandArray(compatible_brands),
        is_consumable === true || is_consumable === 'true',
        Number(warranty_months) || 0, notes || null,
        Number.isFinite(Number(min_threshold)) ? Number(min_threshold) : 5
      ]
    );

    const part = result.rows[0];

    // Keep the spare-parts (SPO) catalog in sync so the part is orderable.
    try {
      await pool.query(
        `INSERT INTO vendor_spare_parts_catalog (name, active, floor_part_id, category)
         SELECT $1, true, $2, $3
          WHERE NOT EXISTS (SELECT 1 FROM vendor_spare_parts_catalog WHERE floor_part_id = $2)`,
        [part.part_name, part.part_id, cat]
      );
    } catch (e) {
      console.warn('[createPart] catalog sync (non-fatal):', e.message);
    }

    res.status(201).json({
      success: true,
      message: 'Part created successfully',
      part
    });
  } catch (error) {
    console.error('Create part error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating part'
    });
  }
};

// Update Part Details (Name, Location, Cost, etc.)
exports.updatePart = async (req, res) => {
  const { id } = req.params;
  const {
    part_name, part_type, vendor, cost, location_code,
    category, description, part_sku, compatible_brands, is_consumable,
    warranty_months, notes, min_threshold
  } = req.body;

  try {
    const brands = compatible_brands === undefined ? null : toBrandArray(compatible_brands);
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
           updated_at = NOW()
       WHERE part_id = $6
       RETURNING *`,
      [
        part_name, part_type, vendor, cost, location_code, id,
        category || null, description || null, part_sku || null, brands,
        typeof is_consumable === 'boolean' ? is_consumable : null,
        warranty_months != null && warranty_months !== '' ? Number(warranty_months) : null,
        notes || null,
        min_threshold != null && min_threshold !== '' ? Number(min_threshold) : null
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Part not found' });
    }

    res.json({
      success: true,
      message: 'Part updated successfully',
      part: result.rows[0]
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

// Update Part Quantity (Restock or Consume)
exports.updatePartQuantity = async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body; // Can be positive (add) or negative (consume)

  try {
    const result = await pool.query(
      `UPDATE parts SET quantity = quantity + $1 WHERE part_id = $2 RETURNING *`,
      [quantity, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Part not found'
      });
    }

    res.json({
      success: true,
      message: 'Part quantity updated successfully',
      part: result.rows[0]
    });
  } catch (error) {
    console.error('Update part error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating part'
    });
  }
};
