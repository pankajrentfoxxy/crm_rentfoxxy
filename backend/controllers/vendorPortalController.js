const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { body, param, query, validationResult } = require('express-validator');
const pool = require('../config/db');
const { generatePurchaseOrderPdf, formatPoType } = require('../services/vendorPurchaseOrderPdfService');

const TOKEN_TTL = '24h';

function parseLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function sanitizeVendor(row) {
  if (!row) return row;
  // eslint-disable-next-line no-unused-vars
  const { password_hash, vendor_portal_password_hash, remember_pass_plain, ...rest } = row;
  return {
    ...rest,
    id: row.vendor_id,
    vendor_id: row.vendor_id
  };
}

const loginValidators = [
  body('email').trim().notEmpty().isEmail(),
  body('password').notEmpty().isLength({ min: 1, max: 256 })
];

async function login(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const email = String(req.body.email).trim().toLowerCase();
  const password = String(req.body.password);

  const r = await pool.query(
    `SELECT vendor_id, email, status, business_name, first_name, password_hash,
            vendor_portal_password_hash, vendor_portal_enabled
     FROM vendors WHERE LOWER(email) = $1 AND deleted_at IS NULL`,
    [email]
  );
  if (!r.rows.length) {
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  }

  const vendor = r.rows[0];
  if (vendor.status !== 'approved') {
    return res.status(403).json({ success: false, message: 'Your vendor account is not approved yet' });
  }
  if (vendor.vendor_portal_enabled === false) {
    return res.status(403).json({ success: false, message: 'Vendor portal access is disabled. Contact Rentfoxxy.' });
  }

  const hash = vendor.vendor_portal_password_hash || vendor.password_hash;
  const ok = await bcrypt.compare(password, hash);
  if (!ok) {
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { type: 'vendor_portal', vendor_id: vendor.vendor_id, email: vendor.email },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO vendor_portal_sessions (vendor_id, token, expires_at) VALUES ($1, $2, $3)`,
    [vendor.vendor_id, token, expiresAt]
  );
  await pool.query(`UPDATE vendors SET vendor_portal_last_login = NOW() WHERE vendor_id = $1`, [vendor.vendor_id]);

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      token,
      vendor: {
        vendor_id: vendor.vendor_id,
        email: vendor.email,
        business_name: vendor.business_name,
        first_name: vendor.first_name
      }
    }
  });
}

async function logout(req, res) {
  if (req.vendorToken) {
    await pool.query(`DELETE FROM vendor_portal_sessions WHERE token = $1`, [req.vendorToken]);
  }
  res.json({ success: true, message: 'Logged out' });
}

async function me(req, res) {
  const r = await pool.query(
    `SELECT vendor_id, status, first_name, last_name, business_name, email, phone, address,
            business_type, registration_date, state, city, pincode, gst_number, pan_number, msme_number,
            contact_person_name, contact_person_phone, alternate_phone, po_payment_terms, credit_days,
            bank_name, account_number, bank_ifsc_code, account_holder_name, logo_url, image_url,
            vendor_portal_last_login, notes
     FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`,
    [req.vendor.vendor_id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Vendor not found' });
  res.json({ success: true, data: sanitizeVendor(r.rows[0]) });
}

const listPoValidators = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('search').optional().isString().trim(),
  query('status').optional().isString().trim()
];

async function listPurchaseOrders(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page = req.query.page || 1;
  const limit = req.query.limit || 25;
  const offset = (page - 1) * limit;
  const vendorId = req.vendor.vendor_id;

  let where = `p.deleted_at IS NULL AND p.vendor_id = $1 AND p.status NOT IN ('draft', 'pending', 'pending_approval', 'rejected')`;
  const params = [vendorId];
  let idx = 2;

  if (req.query.status) {
    where += ` AND LOWER(p.status) = LOWER($${idx})`;
    params.push(req.query.status);
    idx += 1;
  }
  if (req.query.search) {
    where += ` AND (p.purchase_order_number ILIKE $${idx} OR p.remarks ILIKE $${idx})`;
    params.push(`%${req.query.search}%`);
    idx += 1;
  }

  const countR = await pool.query(`SELECT COUNT(*)::int AS c FROM vendor_purchase_orders p WHERE ${where}`, params);
  const total = countR.rows[0].c;

  params.push(limit, offset);
  const dataR = await pool.query(
    `SELECT p.po_id, p.purchase_order_number, p.purchase_order_date, p.purchase_order_type,
            p.status, p.sub_total_amount, p.total_amount, p.expected_delivery_date, p.remarks,
            p.sent_to_vendor_at, p.approved_at, p.created_at
     FROM vendor_purchase_orders p
     WHERE ${where}
     ORDER BY p.purchase_order_date DESC, p.po_id DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );

  res.json({
    success: true,
    data: dataR.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1
  });
}

const poIdParam = [param('poId').isInt().toInt()];

async function getPurchaseOrder(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const r = await pool.query(
    `SELECT p.* FROM vendor_purchase_orders p
     WHERE p.po_id = $1 AND p.vendor_id = $2 AND p.deleted_at IS NULL
       AND p.status NOT IN ('draft', 'pending', 'pending_approval', 'rejected')`,
    [req.params.poId, req.vendor.vendor_id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Purchase order not found' });

  const po = r.rows[0];
  const serials = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, rental_start_date, qc_status, extra, created_at
     FROM vendor_serial_numbers
     WHERE po_id = $1 AND deleted_at IS NULL
     ORDER BY serial_id ASC`,
    [po.po_id]
  );

  res.json({
    success: true,
    data: {
      ...po,
      line_items: parseLineItems(po.line_items),
      serial_numbers: serials.rows
    }
  });
}

async function downloadPurchaseOrderPdf(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const r = await pool.query(
    `SELECT p.*, v.business_name AS vendor_business_name, v.first_name AS vendor_first_name,
            v.email AS vendor_email, v.phone AS vendor_phone, v.gst_number AS vendor_gst
     FROM vendor_purchase_orders p
     JOIN vendors v ON v.vendor_id = p.vendor_id
     WHERE p.po_id = $1 AND p.vendor_id = $2 AND p.deleted_at IS NULL
       AND p.status NOT IN ('draft', 'pending', 'pending_approval', 'rejected')`,
    [req.params.poId, req.vendor.vendor_id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Purchase order not found' });

  const { absolutePath, relativePath } = await generatePurchaseOrderPdf({ po: r.rows[0] });
  res.download(absolutePath, path.basename(absolutePath), (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ success: false, message: 'Could not download PDF' });
    }
  });
}

const listSerialValidators = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('search').optional().isString().trim(),
  query('status').optional().isString().trim()
];

async function listSerialNumbers(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page = req.query.page || 1;
  const limit = req.query.limit || 25;
  const offset = (page - 1) * limit;
  const vendorId = req.vendor.vendor_id;

  let where = `s.deleted_at IS NULL AND p.vendor_id = $1 AND p.deleted_at IS NULL`;
  const params = [vendorId];
  let idx = 2;

  if (req.query.search) {
    where += ` AND (s.serial_number ILIKE $${idx} OR s.inventory_asset_code ILIKE $${idx})`;
    params.push(`%${req.query.search}%`);
    idx += 1;
  }
  if (req.query.status) {
    where += ` AND LOWER(COALESCE(s.qc_status, '')) = LOWER($${idx})`;
    params.push(req.query.status);
    idx += 1;
  }

  const countR = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM vendor_serial_numbers s
     JOIN vendor_purchase_orders p ON p.po_id = s.po_id
     WHERE ${where}`,
    params
  );
  const total = countR.rows[0].c;

  params.push(limit, offset);
  const dataR = await pool.query(
    `SELECT s.serial_id, s.serial_number, s.inventory_asset_code, s.rental_start_date,
            s.qc_status, s.extra, s.created_at, p.purchase_order_number, p.purchase_order_type
     FROM vendor_serial_numbers s
     JOIN vendor_purchase_orders p ON p.po_id = s.po_id
     WHERE ${where}
     ORDER BY s.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );

  res.json({
    success: true,
    data: dataR.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1
  });
}

async function dashboardStats(req, res) {
  const vendorId = req.vendor.vendor_id;
  const [pos, serials, bills] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS c FROM vendor_purchase_orders
       WHERE vendor_id = $1 AND deleted_at IS NULL
         AND status IN ('approved', 'sent', 'processing', 'completed', 'vendor_accepted')`,
      [vendorId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c
       FROM vendor_serial_numbers s
       JOIN vendor_purchase_orders p ON p.po_id = s.po_id
       WHERE p.vendor_id = $1 AND s.deleted_at IS NULL AND p.deleted_at IS NULL
         AND COALESCE(s.inventory_status, 'in_stock') NOT IN ('returned')`,
      [vendorId]
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('generated', 'approved'))::int AS pending_bills,
         COALESCE(SUM(total_payable) FILTER (WHERE status NOT IN ('paid', 'cancelled')), 0) AS total_outstanding,
         COALESCE(SUM(total_payable) FILTER (WHERE status IN ('generated', 'approved')), 0) AS pending_amount
       FROM vendor_monthly_bills
       WHERE vendor_id = $1`,
      [vendorId]
    )
  ]);

  res.json({
    success: true,
    data: {
      active_pos: pos.rows[0].c,
      laptops_with_rentfoxxy: serials.rows[0].c,
      pending_bills: bills.rows[0].pending_bills || 0,
      pending_bills_amount: parseFloat(bills.rows[0].pending_amount || 0),
      total_outstanding: parseFloat(bills.rows[0].total_outstanding || 0),
      overdue_amount: parseFloat(bills.rows[0].total_outstanding || 0)
    }
  });
}

async function acceptPurchaseOrder(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const r = await pool.query(
    `SELECT po_id, status FROM vendor_purchase_orders
     WHERE po_id = $1 AND vendor_id = $2 AND deleted_at IS NULL`,
    [req.params.poId, req.vendor.vendor_id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Purchase order not found' });

  const st = String(r.rows[0].status || '').toLowerCase();
  if (st !== 'sent' && st !== 'approved') {
    return res.status(400).json({ success: false, message: 'This purchase order cannot be accepted in its current status' });
  }

  await pool.query(
    `UPDATE vendor_purchase_orders SET status = 'vendor_accepted', updated_at = NOW() WHERE po_id = $1`,
    [req.params.poId]
  );
  res.json({ success: true, message: 'Purchase order accepted' });
}

const rejectPoValidators = [
  ...poIdParam,
  body('reason').trim().notEmpty().isLength({ min: 10, max: 500 })
];

async function rejectPurchaseOrder(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const r = await pool.query(
    `SELECT po_id, status FROM vendor_purchase_orders
     WHERE po_id = $1 AND vendor_id = $2 AND deleted_at IS NULL`,
    [req.params.poId, req.vendor.vendor_id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Purchase order not found' });

  const st = String(r.rows[0].status || '').toLowerCase();
  if (st !== 'sent' && st !== 'approved') {
    return res.status(400).json({ success: false, message: 'This purchase order cannot be rejected in its current status' });
  }

  await pool.query(
    `UPDATE vendor_purchase_orders
     SET status = 'vendor_rejected', rejection_reason = $1, updated_at = NOW()
     WHERE po_id = $2`,
    [req.body.reason, req.params.poId]
  );
  res.json({ success: true, message: 'Purchase order rejected' });
}

function createVendorInvoiceUpload() {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', 'uploads', 'vendor-invoice-uploads', String(req.params.poId));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const safe = String(file.originalname || 'invoice').replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}_${safe}`);
      }
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok =
        /pdf|image\/jpeg|image\/png|image\/gif|image\/webp/i.test(file.mimetype) ||
        /\.(pdf|jpe?g|png|gif|webp)$/i.test(file.originalname || '');
      cb(ok ? null : new Error('Only PDF or image files are allowed'), ok);
    }
  });
}

async function uploadPurchaseOrderInvoice(req, res) {
  try {
    const poId = Number(req.params.poId);
    const invoice_number = String(req.body.invoice_number || '').trim();
    if (!invoice_number) {
      return res.status(400).json({ success: false, message: 'Invoice number is required' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Invoice file is required' });
    }

    const cur = await pool.query(
      `SELECT po_id, status FROM vendor_purchase_orders
       WHERE po_id = $1 AND vendor_id = $2 AND deleted_at IS NULL`,
      [poId, req.vendor.vendor_id]
    );
    if (!cur.rows.length) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }

    const st = String(cur.rows[0].status || '').toLowerCase();
    if (!['approved', 'vendor_accepted', 'processing', 'completed', 'sent'].includes(st)) {
      return res.status(400).json({
        success: false,
        message: 'Invoice upload is not allowed for this purchase order status'
      });
    }

    const relativePath = `/uploads/vendor-invoice-uploads/${poId}/${req.file.filename}`;
    await pool.query(
      `UPDATE vendor_purchase_orders
       SET vendor_invoice_number = $1, vendor_invoice_file = $2, vendor_invoice_uploaded_at = NOW(), updated_at = NOW()
       WHERE po_id = $3`,
      [invoice_number, relativePath, poId]
    );

    res.json({
      success: true,
      message: 'Invoice uploaded successfully',
      data: {
        invoice_number,
        invoice_file: relativePath,
        uploaded_at: new Date().toISOString()
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || 'Upload failed' });
  }
}

const listBillsValidators = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
];

async function listVendorBills(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page = req.query.page || 1;
  const limit = req.query.limit || 25;
  const offset = (page - 1) * limit;
  const vendorId = req.vendor.vendor_id;

  const countR = await pool.query(
    `SELECT COUNT(*)::int AS c FROM vendor_monthly_bills WHERE vendor_id = $1`,
    [vendorId]
  );
  const total = countR.rows[0].c;

  const dataR = await pool.query(
    `SELECT bill_id, bill_number, bill_month, bill_year, bill_date, from_date, to_date,
            line_items, subtotal, gst_amount, debit_note_adjustment, total_payable, status,
            payment_date, payment_reference, created_at
     FROM vendor_monthly_bills
     WHERE vendor_id = $1
     ORDER BY bill_year DESC, bill_month DESC, bill_id DESC
     LIMIT $2 OFFSET $3`,
    [vendorId, limit, offset]
  );

  const data = dataR.rows.map((row) => {
    const items = Array.isArray(row.line_items)
      ? row.line_items
      : typeof row.line_items === 'string'
        ? JSON.parse(row.line_items || '[]')
        : [];
    return {
      ...row,
      line_items: items,
      units: items.length,
      period: `${row.from_date} – ${row.to_date}`
    };
  });

  res.json({
    success: true,
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1
  });
}

const billIdParam = [param('billId').isInt({ min: 1 }).toInt()];

async function getBillDetail(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const vendorId = req.vendor.vendor_id;
  const billId = req.params.billId;

  const dataR = await pool.query(
    `SELECT bill_id, bill_number, bill_month, bill_year, bill_date, from_date, to_date,
            line_items, subtotal, gst_amount, debit_note_adjustment, total_payable, status,
            payment_date, payment_reference, pdf_path, created_at
     FROM vendor_monthly_bills
     WHERE bill_id = $1 AND vendor_id = $2`,
    [billId, vendorId]
  );

  if (!dataR.rows.length) {
    return res.status(404).json({ success: false, message: 'Bill not found' });
  }

  const row = dataR.rows[0];
  const items = Array.isArray(row.line_items)
    ? row.line_items
    : typeof row.line_items === 'string'
      ? JSON.parse(row.line_items || '[]')
      : [];

  res.json({
    success: true,
    data: {
      ...row,
      line_items: items,
      period: `${row.from_date} – ${row.to_date}`,
    },
  });
}

async function listVendorDebitNotes(req, res) {
  try {
    const vendorId = req.vendor.vendor_id;
    const dataR = await pool.query(
      `SELECT dn.debit_note_id, dn.debit_note_number, dn.po_id, dn.reason, dn.description,
              dn.amount, dn.status, dn.created_at, dn.adjusted_in_bill_id,
              p.purchase_order_number AS po_number, mb.bill_number AS applied_bill_number
       FROM vendor_debit_notes dn
       LEFT JOIN vendor_purchase_orders p ON p.po_id = dn.po_id
       LEFT JOIN vendor_monthly_bills mb ON mb.bill_id = dn.adjusted_in_bill_id
       WHERE dn.vendor_id = $1
       ORDER BY dn.created_at DESC`,
      [vendorId]
    );

    res.json({ success: true, data: dataR.rows });
  } catch (err) {
    console.error('listVendorDebitNotes:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to load debit notes' });
  }
}

const listReturnsValidators = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
];

async function listVendorReturns(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const vendorId = req.vendor.vendor_id;

  const rdcRows = await pool.query(
    `SELECT
       st.return_dc_number AS rdc_number,
       MIN(st.updated_at) AS return_date,
       COUNT(DISTINCT sti.id)::int AS laptop_count,
       COALESCE(MAX(st.complaint_type), MAX(sti.issue_category_label), 'Return to vendor') AS reason,
       COALESCE(MAX(st.status), 'open') AS status,
       jsonb_agg(DISTINCT COALESCE(vsn.inventory_asset_code, sti.unique_serial_number, sti.serial_number))
         FILTER (WHERE COALESCE(vsn.inventory_asset_code, sti.unique_serial_number, sti.serial_number) IS NOT NULL) AS ttspl_ids
     FROM support_tickets st
     JOIN support_ticket_items sti ON sti.ticket_id = st.id
     JOIN vendor_serial_numbers vsn ON vsn.deleted_at IS NULL
       AND (
         LOWER(COALESCE(vsn.inventory_asset_code, '')) = LOWER(COALESCE(sti.unique_serial_number, ''))
         OR LOWER(COALESCE(vsn.serial_number, '')) = LOWER(COALESCE(sti.serial_number, ''))
       )
     JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id AND vpo.vendor_id = $1 AND vpo.deleted_at IS NULL
     WHERE st.return_dc_number IS NOT NULL
     GROUP BY st.return_dc_number
     ORDER BY MIN(st.updated_at) DESC NULLS LAST`,
    [vendorId]
  );

  const replacedRows = await pool.query(
    `SELECT
       COALESCE(payload->>'rdc_number', payload->>'return_dc_number', 'RP-' || replaced_id::text) AS rdc_number,
       created_at AS return_date,
       COALESCE((payload->>'quantity')::int, 1) AS laptop_count,
       COALESCE(payload->>'reason', payload->>'remarks', status) AS reason,
       status,
       COALESCE(payload->'ttspl_ids', payload->'serial_ids', '[]'::jsonb) AS ttspl_ids
     FROM vendor_replaced_products
     WHERE vendor_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [vendorId]
  );

  const merged = [
    ...rdcRows.rows.map((row) => ({
      rdc_number: row.rdc_number,
      return_date: row.return_date,
      laptop_count: row.laptop_count,
      reason: row.reason,
      status: row.status,
      ttspl_ids: Array.isArray(row.ttspl_ids) ? row.ttspl_ids : []
    })),
    ...replacedRows.rows.map((row) => ({
      rdc_number: row.rdc_number,
      return_date: row.return_date,
      laptop_count: row.laptop_count,
      reason: row.reason,
      status: row.status,
      ttspl_ids: Array.isArray(row.ttspl_ids) ? row.ttspl_ids : []
    }))
  ].sort((a, b) => new Date(b.return_date || 0) - new Date(a.return_date || 0));

  res.json({
    success: true,
    data: merged,
    total: merged.length
  });
}

module.exports = {
  loginValidators,
  login,
  logout,
  me,
  listPoValidators,
  listPurchaseOrders,
  poIdParam,
  getPurchaseOrder,
  downloadPurchaseOrderPdf,
  listSerialValidators,
  listSerialNumbers,
  dashboardStats,
  acceptPurchaseOrder,
  rejectPoValidators,
  rejectPurchaseOrder,
  createVendorInvoiceUpload,
  uploadPurchaseOrderInvoice,
  listBillsValidators,
  listVendorBills,
  billIdParam,
  getBillDetail,
  listVendorDebitNotes,
  listReturnsValidators,
  listVendorReturns,
  formatPoType
};
