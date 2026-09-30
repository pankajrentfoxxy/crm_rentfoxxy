/**
 * QC Ready hold — after QC2 a laptop sits on its ticket in stage 'Pending Inventory' until the
 * warehouse receives it (serial check + carret/slot, POST /production-assets/:id/receive).
 * Until then it must not go back to the floor, onto a new ticket, or onto a sales order.
 */
const pool = require('../config/db');

const QC_READY_STAGE = 'Pending Inventory';
const CLOSED_TICKET_STATUSES = ['completed', 'cancelled', 'qc_failed_return_vendor'];

function httpError(message, status = 409) {
  return Object.assign(new Error(message), { status, qcReadyHold: true });
}

function holdMessage(hold) {
  const code = hold.ttspl_id || hold.serial_number || 'This laptop';
  return `${code} is waiting in QC Ready (ticket #${hold.ticket_id}). `
    + 'The warehouse must receive it into a carret first (Floor Pipeline → QC Ready).';
}

/** Open ticket in QC Ready for this laptop, matched by vendor serial id, serial or TTSPL. */
async function findQcReadyHold(db, { vendorSerialId, serialNumber, ttsplId } = {}) {
  const clauses = [];
  const params = [];
  if (vendorSerialId) {
    params.push(Number(vendorSerialId));
    clauses.push(`t.vendor_serial_id = $${params.length}`);
  }
  const sn = serialNumber && String(serialNumber).trim();
  if (sn) {
    params.push(sn);
    clauses.push(`LOWER(TRIM(COALESCE(t.serial_number, ''))) = LOWER($${params.length})`);
  }
  const tt = ttsplId && String(ttsplId).trim();
  if (tt) {
    params.push(tt);
    clauses.push(`UPPER(TRIM(COALESCE(t.ttspl_id, ''))) = UPPER($${params.length})`);
  }
  if (!clauses.length) return null;
  params.push(QC_READY_STAGE, CLOSED_TICKET_STATUSES);
  const r = await db.query(
    `SELECT t.ticket_id, t.ttspl_id, t.serial_number, t.vendor_serial_id
       FROM tickets t
       JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE (${clauses.join(' OR ')})
        AND s.stage_name = $${params.length - 1}
        AND t.status <> ALL($${params.length})
      ORDER BY t.ticket_id DESC
      LIMIT 1`,
    params
  );
  return r.rows[0] || null;
}

async function assertNotOnQcReadyHold(db, ident) {
  const hold = await findQcReadyHold(db, ident);
  if (hold) throw httpError(holdMessage(hold));
}

async function ticketQcReadyHold(db, ticketId) {
  const id = Number(ticketId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = await db.query(
    `SELECT t.ticket_id, t.ttspl_id, t.serial_number, t.vendor_serial_id
       FROM tickets t
       JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE t.ticket_id = $1
        AND s.stage_name = $2
        AND t.status <> ALL($3)`,
    [id, QC_READY_STAGE, CLOSED_TICKET_STATUSES]
  );
  return r.rows[0] || null;
}

/**
 * Route middleware for ticket endpoints that move a ticket or change its status.
 * Only the warehouse receive may take a ticket out of QC Ready; super_admin can still correct mistakes.
 */
function rejectQcReadyTicketMove({ onlyIfBodyHas } = {}) {
  return async (req, res, next) => {
    try {
      if (req.user?.role === 'super_admin') return next();
      if (onlyIfBodyHas && !onlyIfBodyHas.some((k) => req.body?.[k] !== undefined)) return next();
      const hold = await ticketQcReadyHold(pool, req.params.id);
      if (!hold) return next();
      return res.status(409).json({ success: false, message: holdMessage(hold) });
    } catch (e) {
      return next(e);
    }
  };
}

/** Bulk stage move: refuse when the source stage is QC Ready. */
async function rejectQcReadyBulkMove(req, res, next) {
  try {
    if (req.user?.role === 'super_admin') return next();
    const stageId = Number(req.body?.current_stage_id);
    if (!stageId) return next();
    const r = await pool.query(`SELECT stage_name FROM stages WHERE stage_id = $1`, [stageId]);
    if (r.rows[0]?.stage_name !== QC_READY_STAGE) return next();
    return res.status(409).json({
      success: false,
      message: 'Laptops in QC Ready can only leave through warehouse receive (Floor Pipeline → QC Ready).',
    });
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  QC_READY_STAGE,
  findQcReadyHold,
  assertNotOnQcReadyHold,
  ticketQcReadyHold,
  holdMessage,
  rejectQcReadyTicketMove,
  rejectQcReadyBulkMove,
};
