/**
 * Part ID Service
 *
 * Two distinct identifiers:
 *
 * 1. part_id (CATALOG id) — auto-increment integer from the `parts` table.
 *    Identifies the TYPE of part (e.g. "RAM 8GB DDR4"). Used in foreign keys.
 *
 * 2. PRT-YYYYMMDD-NNNN (INSTANCE id) — generated when a physical unit is
 *    received. Identifies ONE physical unit and tracks its lifecycle
 *    (in_stock -> reserved -> installed -> returned). Stored in
 *    part_instances.prt_id. The NNNN sequence is global (sm_document_sequences)
 *    so PRT ids are always unique even across days.
 *
 * TTSPL is reserved exclusively for laptops and is never used here.
 */
const pool = require('../config/db');

function formatPrt(seq, receivedAt = new Date()) {
  const dateStr = receivedAt.toISOString().slice(0, 10).replace(/-/g, '');
  return `PRT-${dateStr}-${String(seq).padStart(4, '0')}`;
}

async function generatePrtId(receivedAt = new Date(), db = pool) {
  const res = await db.query(
    `UPDATE sm_document_sequences
        SET last_value = last_value + 1, updated_at = NOW()
      WHERE doc_type = 'part_instance'
      RETURNING last_value`
  );
  return formatPrt(res.rows[0].last_value, receivedAt);
}

async function generatePrqNumber(db = pool) {
  const res = await db.query(
    `UPDATE sm_document_sequences
        SET last_value = last_value + 1, updated_at = NOW()
      WHERE doc_type = 'part_request'
      RETURNING last_value`
  );
  return `PRQ-${String(res.rows[0].last_value).padStart(4, '0')}`;
}

/**
 * Create N physical part instances (e.g. when a GRN is received) and bump the
 * catalog stock count. Pass a transaction client as `db` to run atomically.
 * Returns array of { instance_id, prt_id }.
 */
async function createPartInstances({
  partId, quantity, unitCost, locationCode,
  spoId, grnId, batchNumber, receivedBy, notes, db = pool
}) {
  const qty = Math.max(0, Number(quantity) || 0);
  const instances = [];
  const now = new Date();

  for (let i = 0; i < qty; i += 1) {
    const prtId = await generatePrtId(now, db);
    const res = await db.query(
      `INSERT INTO part_instances
         (prt_id, part_id, spo_id, grn_id, batch_number, unit_cost,
          location_code, status, notes, received_at, received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'in_stock',$8,NOW(),$9)
       RETURNING instance_id, prt_id`,
      [prtId, partId, spoId || null, grnId || null, batchNumber || null,
        Number(unitCost) || 0, locationCode || null, notes || null, receivedBy || null]
    );
    instances.push(res.rows[0]);
  }

  if (qty > 0) {
    await db.query(
      `UPDATE parts SET quantity = quantity + $1, updated_at = NOW() WHERE part_id = $2`,
      [qty, partId]
    );
  }

  return instances;
}

module.exports = { generatePrtId, generatePrqNumber, createPartInstances, formatPrt };
