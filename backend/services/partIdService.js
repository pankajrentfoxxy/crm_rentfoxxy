/**
 * Part ID Service (Phase 16)
 *
 * Two kinds of identifiers:
 *
 * 1. part_id (catalog ID) — auto-increment integer from `parts`.
 *    Identifies the TYPE of part (e.g. "RAM 8GB DDR4"). Used in FKs.
 *
 * 2. PRT-YYYYMMDD-NNNN (instance ID) — generated when a physical unit is
 *    received. Identifies ONE physical unit, stored in part_instances.prt_id.
 *    Tracks lifecycle: in_stock -> reserved -> installed -> removed.
 *
 * PRT prefix is for parts only — never TTSPL (which is for laptops).
 *
 * All functions accept an optional `db` executor (a pg pool or a client inside
 * a transaction). Defaults to the shared pool.
 */
const pool = require('../config/db');

async function generatePrtId(receivedAt = new Date(), db = pool) {
  const dateStr = receivedAt.toISOString().slice(0, 10).replace(/-/g, '');
  const res = await db.query(
    `UPDATE sm_document_sequences
        SET last_value = last_value + 1, updated_at = NOW()
      WHERE doc_type = 'part_instance'
      RETURNING last_value`
  );
  const seq = res.rows[0].last_value;
  return `PRT-${dateStr}-${String(seq).padStart(4, '0')}`;
}

async function generatePrqNumber(db = pool) {
  const res = await db.query(
    `UPDATE sm_document_sequences
        SET last_value = last_value + 1, updated_at = NOW()
      WHERE doc_type = 'part_request'
      RETURNING last_value`
  );
  const seq = res.rows[0].last_value;
  return `PRQ-${String(seq).padStart(4, '0')}`;
}

/**
 * Bulk-create part instances when units are received from a vendor.
 * Returns an array of { instance_id, prt_id }.
 * Also increments parts.quantity by `quantity`.
 */
async function createPartInstances({
  partId, quantity, unitCost, locationCode,
  spoId, grnId, batchNumber, receivedBy, notes,
}, db = pool) {
  const instances = [];
  const now = new Date();
  const qty = Number(quantity) || 0;

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

module.exports = { generatePrtId, generatePrqNumber, createPartInstances };
