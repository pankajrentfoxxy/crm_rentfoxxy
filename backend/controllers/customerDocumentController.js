const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const DOC_TYPES = ['gst_certificate', 'pan_card', 'agreement', 'kyc_id', 'other'];

function fileUrl(req, filePath) {
  if (!filePath) return null;
  const normalized = String(filePath).replace(/\\/g, '/');
  if (normalized.startsWith('http')) return normalized;
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}/${normalized.replace(/^\//, '')}`;
}

function formatDocRow(req, row) {
  return {
    doc_id: row.doc_id,
    customer_id: row.customer_id,
    lead_id: row.lead_id,
    doc_type: row.doc_type,
    doc_label: row.doc_label,
    file_path: row.file_path,
    file_url: fileUrl(req, row.file_path),
    file_name: row.file_name,
    file_size_bytes: row.file_size_bytes,
    uploaded_by: row.uploaded_by,
    uploaded_by_name: row.uploaded_by_name || null,
    is_signed: row.is_signed,
    notes: row.notes,
    created_at: row.created_at,
  };
}

exports.uploadDocument = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (Number.isNaN(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const docType = String(req.body.doc_type || '').trim();
    if (!DOC_TYPES.includes(docType)) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Invalid doc_type' });
    }

    const custCheck = await pool.query('SELECT customer_id, customer_type FROM customers WHERE customer_id = $1', [customerId]);
    if (!custCheck.rows.length) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const { isCustomerTypeAllowed } = require('../services/customerAccessScope');
    if (!isCustomerTypeAllowed(req.allowedCustomerTypes, custCheck.rows[0].customer_type)) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(403).json({ success: false, message: 'Access denied: customer is outside your Customer Access scope' });
    }

    const destDir = path.join('uploads', 'customer-documents', String(customerId));
    fs.mkdirSync(destDir, { recursive: true });
    const safeName = `${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const dest = path.join(destDir, safeName);
    fs.renameSync(req.file.path, dest);
    const filePath = dest.replace(/\\/g, '/');

    const isSigned = req.body.is_signed === true || req.body.is_signed === 'true' || req.body.is_signed === '1';
    const leadId = req.body.lead_id ? parseInt(req.body.lead_id, 10) : null;

    const result = await pool.query(
      `INSERT INTO customer_documents
        (customer_id, lead_id, doc_type, doc_label, file_path, file_name, file_size_bytes, uploaded_by, is_signed, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        customerId,
        Number.isNaN(leadId) ? null : leadId,
        docType,
        req.body.doc_label || null,
        filePath,
        req.file.originalname,
        req.file.size,
        req.user.user_id,
        isSigned,
        req.body.notes || null,
      ]
    );

    const row = result.rows[0];
    res.status(201).json({
      success: true,
      doc: formatDocRow(req, row),
    });
  } catch (error) {
    console.error('uploadDocument:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listDocuments = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (Number.isNaN(customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }

    const result = await pool.query(
      `SELECT d.*, u.name AS uploaded_by_name
       FROM customer_documents d
       LEFT JOIN users u ON u.user_id = d.uploaded_by
       WHERE d.customer_id = $1
       ORDER BY d.doc_type, d.created_at DESC`,
      [customerId]
    );

    const grouped = {};
    for (const type of DOC_TYPES) grouped[type] = [];
    for (const row of result.rows) {
      const formatted = formatDocRow(req, row);
      if (!grouped[row.doc_type]) grouped[row.doc_type] = [];
      grouped[row.doc_type].push(formatted);
    }

    res.json({ success: true, documents: grouped, all: result.rows.map((r) => formatDocRow(req, r)) });
  } catch (error) {
    console.error('listDocuments:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const docId = parseInt(req.params.docId, 10);
    if (Number.isNaN(customerId) || Number.isNaN(docId)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const result = await pool.query(
      'SELECT * FROM customer_documents WHERE doc_id = $1 AND customer_id = $2',
      [docId, customerId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const doc = result.rows[0];
    if (doc.file_path && fs.existsSync(doc.file_path)) {
      try { fs.unlinkSync(doc.file_path); } catch { /* ignore */ }
    }

    await pool.query('DELETE FROM customer_documents WHERE doc_id = $1', [docId]);
    res.json({ success: true, message: 'Document deleted' });
  } catch (error) {
    console.error('deleteDocument:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
