const pool = require('../config/db');
const { normalizeDcNumber } = require('./dcNumberRoutes');

/**
 * Cancelled pickups and cancelled Return DCs are frozen: no reached / POD / OTP / e-sign /
 * gate / warehouse / reassignment on them. Only reads and comments go through.
 */

const CANCELLED_PICKUP_MESSAGE = 'This pickup has been cancelled — no further changes are allowed.';
const CANCELLED_RDC_MESSAGE = 'This Return DC has been cancelled — no further changes are allowed.';

/** Mount on `/items/:itemId`; blocks mutating calls on a cancelled pickup item. */
async function rejectCancelledPickupItem(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (/\/comments\/?$/.test(req.path)) return next();
  const itemId = parseInt(req.params.itemId, 10);
  if (!Number.isFinite(itemId)) return next();
  try {
    const r = await pool.query(
      `SELECT sti.item_type, sti.status, rdc.status AS rdc_status
         FROM support_ticket_items sti
         LEFT JOIN LATERAL (
           SELECT d.status FROM delivery_challan_lines d
            WHERE d.dc_number = sti.return_dc_number AND d.movement_type = 'return'
            LIMIT 1
         ) rdc ON TRUE
        WHERE sti.id = $1`,
      [itemId]
    );
    const row = r.rows[0];
    if (row && row.item_type === 'pickup'
      && (row.status === 'cancelled' || row.rdc_status === 'cancelled')) {
      return res.status(409).json({ success: false, message: CANCELLED_PICKUP_MESSAGE });
    }
    return next();
  } catch (e) {
    return next(e);
  }
}

/** For routes addressed by `:rdcNumber`; blocks actions on a cancelled Return DC. */
async function rejectCancelledReturnDc(req, res, next) {
  const rdc = String(req.params.rdcNumber || '').trim();
  if (!rdc) return next();
  try {
    const r = await pool.query(
      `SELECT 1 FROM delivery_challan_lines
        WHERE dc_number = $1 AND movement_type = 'return' AND status = 'cancelled'
        LIMIT 1`,
      [rdc]
    );
    if (r.rows.length) {
      return res.status(409).json({ success: false, message: CANCELLED_RDC_MESSAGE });
    }
    return next();
  } catch (e) {
    return next(e);
  }
}

/**
 * Mount on `/delivery-challans`: any write to a cancelled Return DC (assign, dispatch,
 * deliver, OTP, edit…) is refused. Reads and PDF regeneration pass; outbound DCs untouched.
 */
async function rejectCancelledReturnDcWrite(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const rawPath = String(req.path || '').replace(/^\/+/, '');
  if (!rawPath || /\/pdf$/i.test(rawPath)) return next();
  // Return DC numbers (RDC######) carry no slash, so the first segment is also a candidate.
  const candidates = [normalizeDcNumber(rawPath), normalizeDcNumber(rawPath.split('/')[0])]
    .filter(Boolean);
  if (!candidates.length) return next();
  try {
    const r = await pool.query(
      `SELECT 1 FROM delivery_challan_lines
        WHERE dc_number = ANY($1::text[]) AND movement_type = 'return' AND status = 'cancelled'
        LIMIT 1`,
      [candidates]
    );
    if (r.rows.length) {
      return res.status(409).json({ success: false, message: CANCELLED_RDC_MESSAGE });
    }
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { rejectCancelledPickupItem, rejectCancelledReturnDc, rejectCancelledReturnDcWrite };
