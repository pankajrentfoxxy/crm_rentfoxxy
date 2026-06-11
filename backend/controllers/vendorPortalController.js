const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
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
  const [pos, serials] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS c FROM vendor_purchase_orders
       WHERE vendor_id = $1 AND deleted_at IS NULL
         AND status IN ('approved', 'sent', 'processing', 'completed')`,
      [vendorId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c
       FROM vendor_serial_numbers s
       JOIN vendor_purchase_orders p ON p.po_id = s.po_id
       WHERE p.vendor_id = $1 AND s.deleted_at IS NULL AND p.deleted_at IS NULL`,
      [vendorId]
    )
  ]);

  res.json({
    success: true,
    data: {
      active_pos: pos.rows[0].c,
      laptops_with_rentfoxxy: serials.rows[0].c,
      pending_bills: 0,
      overdue_amount: 0
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
    `UPDATE vendor_purchase_orders SET status = 'approved', updated_at = NOW() WHERE po_id = $1`,
    [req.params.poId]
  );
  res.json({ success: true, message: 'Purchase order accepted' });
}

const rejectPoValidators = [
  ...poIdParam,
  body('reason').trim().notEmpty().isLength({ max: 500 })
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
  formatPoType
};
