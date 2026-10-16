/**
 * Praman proof on Dispatch QC (migration 410). A laptop may only pass Dispatch
 * QC once its Praman Device ID and report PDF are on record, so the sales order
 * keeps proof it was Praman-verified and tested before dispatch.
 */
const path = require('path');

const PRAMAN_DIR = path.join(__dirname, '..', 'private-uploads', 'praman');

async function getPraman(db, ticketId) {
  const { rows } = await db.query(
    `SELECT p.praman_id, p.ticket_id, p.device_id, p.report_name, p.uploaded_at, p.uploaded_by, u.name AS uploaded_by_name,
            p.report_source, COALESCE(p.report_uploaded_at, p.uploaded_at) AS report_uploaded_at
       FROM dispatch_qc_praman p LEFT JOIN users u ON u.user_id = p.uploaded_by
      WHERE p.ticket_id = $1`,
    [ticketId]
  );
  return rows[0] || null;
}

/** Throws a 409 when a Dispatch QC pass has no Praman proof. */
async function assertPramanForPass(db, ticketId) {
  const p = await getPraman(db, ticketId);
  // A report sent from the tested laptop (migration 429) has no Device ID yet.
  if (!p || !p.device_id) {
    throw Object.assign(
      new Error('Add the Praman Device ID and attach the Praman report (PDF) before passing Dispatch QC.'),
      { status: 409, code: 'PRAMAN_REQUIRED' }
    );
  }
  return p;
}

/**
 * The tested laptop sends its Praman PDF from the Dispatch QC verification
 * page (migration 429). Only after its configuration matched, only while the
 * ticket is still at Dispatch QC, and only through the ticket's latest link.
 * It never replaces a report the inspector already completed with a Device ID.
 */
const DEVICE_UPLOAD_WINDOW_HOURS = 12;

async function saveReportFromDevice(db, { tokenRow, relPath, originalName }) {
  if (!tokenRow) return { ok: false, code: 404, message: 'Link not found or expired' };
  if (tokenRow.status !== 'matched') return { ok: false, code: 409, message: 'Verify the configuration first.' };
  if (tokenRow.matched_at && Date.now() - new Date(tokenRow.matched_at).getTime() > DEVICE_UPLOAD_WINDOW_HOURS * 3600 * 1000) {
    return { ok: false, code: 410, message: 'This link is too old — start a new check on Dispatch QC.' };
  }
  const t = (await db.query(
    `SELECT t.ticket_id, s.stage_name,
            (SELECT token_id FROM dispatch_qc_capture_tokens WHERE ticket_id = t.ticket_id ORDER BY created_at DESC LIMIT 1) AS latest_token
       FROM tickets t JOIN stages s ON s.stage_id = t.current_stage_id WHERE t.ticket_id = $1`,
    [tokenRow.ticket_id]
  )).rows[0];
  if (!t || t.stage_name !== 'Dispatch QC') return { ok: false, code: 409, message: 'This laptop is no longer at Dispatch QC.' };
  if (String(t.latest_token) !== String(tokenRow.token_id)) return { ok: false, code: 409, message: 'A newer check was started — use that link.' };

  const prev = (await db.query('SELECT device_id, report_path FROM dispatch_qc_praman WHERE ticket_id = $1', [t.ticket_id])).rows[0];
  if (prev?.device_id) return { ok: false, code: 409, message: 'The Praman report is already attached on Dispatch QC.' };
  await db.query(
    `INSERT INTO dispatch_qc_praman (ticket_id, device_id, report_path, report_name, uploaded_by, uploaded_at, report_source, report_uploaded_at)
     VALUES ($1, NULL, $2, $3, NULL, NOW(), 'device', NOW())
     ON CONFLICT (ticket_id) DO UPDATE
       SET report_path = EXCLUDED.report_path, report_name = EXCLUDED.report_name,
           report_source = 'device', report_uploaded_at = NOW(), uploaded_at = NOW()`,
    [t.ticket_id, relPath, String(originalName || '').slice(0, 200) || null]
  );
  await db.query(
    `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, NULL, 'praman_report_from_device', $2)`,
    [t.ticket_id, 'Praman report uploaded from the tested laptop — Device ID still to be entered']
  );
  return { ok: true, ticketId: t.ticket_id, previousPath: prev?.report_path || null };
}

module.exports = { PRAMAN_DIR, getPraman, assertPramanForPass, saveReportFromDevice };
