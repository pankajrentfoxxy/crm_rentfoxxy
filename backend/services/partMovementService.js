/**
 * Append-only ledger of physical spare-part movements.
 *
 * Every point that changes what a part unit is doing (received from a vendor,
 * reserved for a request, installed on a laptop, returned defective, written
 * off) writes one row here. The parts dashboard reads only this table, so its
 * day-wise and category-wise numbers can never drift from `part_instances`
 * status or the in-place `parts.quantity` counter.
 */
const pool = require('../config/db');

const MOVEMENT = Object.freeze({
  RECEIVED: 'received',
  RESERVED: 'reserved',
  UNRESERVED: 'unreserved',
  INSTALLED: 'installed',
  RETURNED_DEFECTIVE: 'returned_defective',
  RETURNED_GOOD: 'returned_good',
  ADJUSTED: 'adjusted',
  DISCARDED: 'discarded',
});

// Resolved once per process. A deployment that has not run migration 178 keeps
// working; it just does not accumulate ledger history.
let ledgerAvailable = null;

async function isLedgerAvailable(db = pool) {
  if (ledgerAvailable !== null) return ledgerAvailable;
  try {
    const r = await db.query(`SELECT to_regclass('public.part_movements') AS t`);
    ledgerAvailable = Boolean(r.rows[0]?.t);
  } catch {
    ledgerAvailable = false;
  }
  if (!ledgerAvailable) {
    console.warn('[partMovementService] part_movements missing — run migration 178 to enable parts tracking history.');
  }
  return ledgerAvailable;
}

/**
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {object} m
 * @param {string} m.type      one of MOVEMENT
 * @param {number} m.partId    required — catalog part
 */
async function recordMovement(db, m) {
  if (!m || !m.type || !m.partId) return null;
  if (!(await isLedgerAvailable(db))) return null;

  const res = await db.query(
    `INSERT INTO part_movements
       (movement_type, part_id, instance_id, prt_id, serial_number, category, part_name,
        quantity, unit_cost, request_id, ticket_id, ttspl_id, spo_id, grn_id, vendor_id,
        is_upgrade, part_condition, notes, actor_user_id, actor_name, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             COALESCE($21::timestamptz, NOW()))
     RETURNING movement_id`,
    [
      m.type,
      Number(m.partId),
      m.instanceId != null ? Number(m.instanceId) : null,
      m.prtId || null,
      m.serialNumber || null,
      m.category || null,
      m.partName || null,
      Number(m.quantity) || 1,
      Number(m.unitCost) || 0,
      m.requestId != null ? Number(m.requestId) : null,
      m.ticketId != null ? Number(m.ticketId) : null,
      m.ttsplId || null,
      m.spoId != null ? Number(m.spoId) : null,
      m.grnId != null ? Number(m.grnId) : null,
      m.vendorId != null ? Number(m.vendorId) : null,
      Boolean(m.isUpgrade),
      m.condition || null,
      m.notes || null,
      m.actorUserId != null ? Number(m.actorUserId) : null,
      m.actorName || null,
      m.occurredAt || null,
    ]
  );
  return res.rows[0]?.movement_id || null;
}

module.exports = { MOVEMENT, recordMovement, isLedgerAvailable };
