const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { PRAMAN_DIR, getPraman } = require('../services/dispatchQcPramanService');

/**
 * Praman Device ID + report PDF for a Dispatch QC ticket (migration 410).
 * The PDF sits in private-uploads and is streamed only to signed-in users with
 * floor or sales-order view access.
 */
const removeFile = (p) => { if (p) fs.promises.unlink(p).catch(() => {}); };

exports.uploadPraman = async (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const file = req.file;
  try {
    if (!ticketId) { removeFile(file?.path); return res.status(400).json({ success: false, message: 'Invalid ticket' }); }
    const deviceId = String(req.body?.device_id || '').trim();
    if (!/^[A-Za-z0-9._:/-]{3,100}$/.test(deviceId)) {
      removeFile(file?.path);
      return res.status(400).json({ success: false, message: 'Enter the Praman Device ID (3–100 letters, digits, - _ . : /).' });
    }
    if (!file) return res.status(400).json({ success: false, message: 'Attach the Praman report PDF.' });

    const t = (await pool.query(
      `SELECT t.ticket_id, s.stage_name FROM tickets t JOIN stages s ON s.stage_id = t.current_stage_id WHERE t.ticket_id = $1`,
      [ticketId]
    )).rows[0];
    if (!t) { removeFile(file.path); return res.status(404).json({ success: false, message: 'Ticket not found' }); }
    if (t.stage_name !== 'Dispatch QC') {
      removeFile(file.path);
      return res.status(409).json({ success: false, message: `This laptop is at ${t.stage_name}, not Dispatch QC.` });
    }

    const rel = path.relative(PRAMAN_DIR, file.path);
    const prev = (await pool.query('SELECT report_path FROM dispatch_qc_praman WHERE ticket_id = $1', [ticketId])).rows[0];
    await pool.query(
      `INSERT INTO dispatch_qc_praman (ticket_id, device_id, report_path, report_name, uploaded_by, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (ticket_id) DO UPDATE
         SET device_id = EXCLUDED.device_id, report_path = EXCLUDED.report_path, report_name = EXCLUDED.report_name,
             uploaded_by = EXCLUDED.uploaded_by, uploaded_at = NOW()`,
      [ticketId, deviceId, rel, String(file.originalname || '').slice(0, 200) || null, req.user?.user_id || null]
    );
    if (prev?.report_path && prev.report_path !== rel) removeFile(path.join(PRAMAN_DIR, prev.report_path));
    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, $2, 'praman_attached', $3)`,
      [ticketId, req.user?.user_id || null, `Praman report attached · Device ID ${deviceId}`]
    );
    res.json({ success: true, praman: await getPraman(pool, ticketId) });
  } catch (e) {
    removeFile(file?.path);
    console.error('uploadPraman:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getPramanForTicket = async (req, res) => {
  try {
    res.json({ success: true, praman: await getPraman(pool, parseInt(req.params.id, 10) || 0) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.downloadPramanPdf = async (req, res) => {
  try {
    const row = (await pool.query('SELECT report_path, report_name FROM dispatch_qc_praman WHERE praman_id = $1', [parseInt(req.params.pramanId, 10) || 0])).rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'Praman report not found' });
    const abs = path.resolve(PRAMAN_DIR, row.report_path);
    if (!abs.startsWith(path.resolve(PRAMAN_DIR) + path.sep) || !fs.existsSync(abs)) {
      return res.status(404).json({ success: false, message: 'Praman report file is missing' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${String(row.report_name || 'praman-report.pdf').replace(/[^\w.-]+/g, '_')}"`);
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
