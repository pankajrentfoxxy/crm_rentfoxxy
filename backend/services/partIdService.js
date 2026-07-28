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
 * Spare-parts GRN receive uses: PRT_{SHORTCUT}_{NNNN}
 *   e.g. Speaker → PRT_SPEAKER_0001, Internal Speaker → PRT_IS_0001
 * part_instances.prt_id keeps the legacy PRT-YYYYMMDD-NNNN format.
 *
 * All functions accept an optional `db` executor (a pg pool or a client inside
 * a transaction). Defaults to the shared pool.
 */
const pool = require('../config/db');

const PRT_ASSET_PAD = 4;

/**
 * Derive a stable uppercase shortcut from a spare-part / catalog name.
 * Single word → up to 10 chars (SPEAKER). Multi-word → acronym (INTERNAL SPEAKER → IS).
 */
function derivePartShortcut(partName) {
  const words = String(partName || 'PART')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'PART';
  if (words.length === 1) {
    const w = words[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
    return (w || 'PART').slice(0, 10);
  }
  const acronym = words.map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z]/g, '');
  if (acronym.length >= 2) return acronym.slice(0, 10);
  return words[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'PART';
}

function formatPartAssetCode(shortcut, num) {
  return `PRT_${shortcut}_${String(num).padStart(PRT_ASSET_PAD, '0')}`;
}

/**
 * Reserve spare-part asset codes for GRN receive (never uses TTSPL sequence).
 * @param {import('pg').PoolClient} client — must be inside an open transaction
 * @param {string} partName — catalog / line name used for the shortcut
 * @param {number} qty
 */
async function allocatePartAssetCodes(client, partName, qty) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n < 1 || n > 500) {
    throw new RangeError('Invalid quantity for part code allocation');
  }

  const shortcut = derivePartShortcut(partName);
  const docType = `prt_asset_${shortcut.toLowerCase()}`;

  await client.query(
    `INSERT INTO sm_document_sequences (doc_type, last_value, prefix, updated_at)
     VALUES ($1, 0, $2, NOW())
     ON CONFLICT (doc_type) DO NOTHING`,
    [docType, `PRT_${shortcut}_`]
  );

  const r = await client.query(
    `UPDATE sm_document_sequences
        SET last_value = last_value + $1, updated_at = NOW()
      WHERE doc_type = $2
      RETURNING last_value - $1 AS start_num`,
    [n, docType]
  );
  if (!r.rows?.length) {
    throw new Error('Part asset sequence missing — sm_document_sequences row not created');
  }

  const start = Number(r.rows[0].start_num);
  const codes = [];
  for (let i = 0; i < n; i += 1) {
    codes.push(formatPartAssetCode(shortcut, start + i));
  }
  return codes;
}

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
 *
 * `serialNumbers` (optional) is a per-unit array of physical serial numbers
 * captured at receive time; index i maps to unit i.
 */
async function createPartInstances({
  partId, quantity, unitCost, locationCode,
  spoId, grnId, batchNumber, receivedBy, notes, serialNumbers,
}, db = pool) {
  const instances = [];
  const now = new Date();
  const qty = Number(quantity) || 0;
  const serials = Array.isArray(serialNumbers) ? serialNumbers : [];

  for (let i = 0; i < qty; i += 1) {
    const prtId = await generatePrtId(now, db);
    const serial = serials[i] != null && String(serials[i]).trim() !== ''
      ? String(serials[i]).trim()
      : null;
    const res = await db.query(
      `INSERT INTO part_instances
         (prt_id, part_id, spo_id, grn_id, batch_number, unit_cost,
          location_code, status, notes, serial_number, received_at, received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'in_stock',$8,$9,NOW(),$10)
       RETURNING instance_id, prt_id`,
      [prtId, partId, spoId || null, grnId || null, batchNumber || null,
        Number(unitCost) || 0, locationCode || null, notes || null, serial, receivedBy || null]
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

module.exports = {
  generatePrtId,
  generatePrqNumber,
  createPartInstances,
  derivePartShortcut,
  formatPartAssetCode,
  allocatePartAssetCodes,
};
