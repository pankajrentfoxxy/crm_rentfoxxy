const pool = require('../config/db');
const { listEwayRegister } = require('../services/gstDocumentQueueService');

/**
 * GET /api/finance-overview/eway-bills
 *   ?type=dc|demo_dc|vrdc|vrtdc|scrap
 *   &state=on_file|needed|not_needed|left_without|unknown
 *   &search=&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=
 *
 * Read-only register of e-way bills across the four documents that carry one.
 * A new endpoint because no existing API lists them together: each document
 * type has its own per-document e-way route, and none returns a list.
 */
exports.getEwayRegister = async (req, res) => {
  try {
    const data = await listEwayRegister(req.query || {});
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('getEwayRegister:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/finance-overview/number-changes?doc_type=&doc_number=
 * The attach / replace audit for one document (migration 375), shown on the
 * queue's attach drawer so a replaced number is never invisible.
 */
exports.getNumberChanges = async (req, res) => {
  try {
    const docType = ['delivery_challan', 'sales_order'].includes(req.query?.doc_type) ? req.query.doc_type : null;
    const docNumber = String(req.query?.doc_number || '').trim();
    if (!docType || !docNumber) {
      return res.status(400).json({ success: false, message: 'doc_type and doc_number are required' });
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.field, c.action, c.old_value, c.new_value, c.reason, c.changed_at,
              u.name AS changed_by_name
         FROM gst_document_number_changes c
         LEFT JOIN users u ON u.user_id = c.changed_by
        WHERE c.doc_type = $1 AND c.doc_number = $2
        ORDER BY c.changed_at DESC, c.id DESC
        LIMIT 50`,
      [docType, docNumber]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getNumberChanges:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
