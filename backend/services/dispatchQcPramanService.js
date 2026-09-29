/**
 * Praman proof on Dispatch QC (migration 410). A laptop may only pass Dispatch
 * QC once its Praman Device ID and report PDF are on record, so the sales order
 * keeps proof it was Praman-verified and tested before dispatch.
 */
const path = require('path');

const PRAMAN_DIR = path.join(__dirname, '..', 'private-uploads', 'praman');

async function getPraman(db, ticketId) {
  const { rows } = await db.query(
    `SELECT p.praman_id, p.ticket_id, p.device_id, p.report_name, p.uploaded_at, p.uploaded_by, u.name AS uploaded_by_name
       FROM dispatch_qc_praman p LEFT JOIN users u ON u.user_id = p.uploaded_by
      WHERE p.ticket_id = $1`,
    [ticketId]
  );
  return rows[0] || null;
}

/** Throws a 409 when a Dispatch QC pass has no Praman proof. */
async function assertPramanForPass(db, ticketId) {
  const p = await getPraman(db, ticketId);
  if (!p) {
    throw Object.assign(
      new Error('Add the Praman Device ID and attach the Praman report (PDF) before passing Dispatch QC.'),
      { status: 409, code: 'PRAMAN_REQUIRED' }
    );
  }
  return p;
}

module.exports = { PRAMAN_DIR, getPraman, assertPramanForPass };
