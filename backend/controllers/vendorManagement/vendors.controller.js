const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { body, param, query, validationResult } = require('express-validator');
const pool = require('../../config/db');
const { logVendorAudit } = require('../../services/vendorAuditLogService');

/** PO bulk receive + TTSPL: `purchaseOrders.controller` (`receivePoLineBulk`). Spare PO bulk: `sparePartsOrders.controller` (`receiveSpareLineBulk`). */

const UPLOAD_SUB = 'vendor-management';

function ensureUploadDir() {
  const dir = path.join(__dirname, '..', '..', 'uploads', UPLOAD_SUB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function publicUrlForSavedFile(filename) {
  if (!filename) return null;
  return `/uploads/${UPLOAD_SUB}/${filename}`;
}

function saveUploadedFile(file) {
  if (!file) return null;
  ensureUploadDir();
  const ext = path.extname(file.originalname) || '.bin';
  const base = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
  const dest = path.join(ensureUploadDir(), base);
  fs.writeFileSync(dest, file.buffer);
  return publicUrlForSavedFile(base);
}

function buildMulter() {
  const multer = require('multer');
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
}

const listValidators = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('search').optional().isString().trim()
];

async function listVendors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page = req.query.page || 1;
  const limit = req.query.limit || 25;
  const offset = (page - 1) * limit;
  const rawSearch = (req.query.search || '').trim();

  let where = `v.deleted_at IS NULL`;
  const params = [];
  let pIdx = 1;
  /* Laravel view_vendor(): split query by spaces — each token may match name / email / phone / business */
  const tokens = rawSearch.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    where += ` AND (
      v.first_name ILIKE $${pIdx} OR COALESCE(v.last_name,'') ILIKE $${pIdx}
      OR v.business_name ILIKE $${pIdx} OR v.phone ILIKE $${pIdx} OR v.email ILIKE $${pIdx}
    )`;
    params.push(`%${tok}%`);
    pIdx += 1;
  }

  const countSql = `SELECT COUNT(*)::int AS c FROM vendors v WHERE ${where}`;
  const countR = await pool.query(countSql, params);
  const total = countR.rows[0].c;

  const dataSql = `
    SELECT v.*, s.shop_id, s.image_url AS shop_logo_url, s.banner_url AS shop_banner_url
    FROM vendors v
    LEFT JOIN vendor_shops s ON s.vendor_id = v.vendor_id AND s.deleted_at IS NULL
    WHERE ${where}
    ORDER BY v.vendor_id DESC
    LIMIT $${pIdx} OFFSET $${pIdx + 1}
  `;
  params.push(limit, offset);
  const data = await pool.query(dataSql, params);

  res.json({
    success: true,
    data: data.rows.map(normalizeVendorRow),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
  });
}

function extendedVendorValidators() {
  return [
    body('po_payment_terms')
      .optional({ checkFalsy: true })
      .isIn(['postpaid_monthly', 'net30', 'net15', 'advance']),
    body('credit_days').optional({ checkFalsy: true }).isInt({ min: 0, max: 365 }),
    body('pan_number').optional({ checkFalsy: true }).isString().isLength({ max: 20 }),
    body('msme_number').optional({ checkFalsy: true }).isString().isLength({ max: 50 }),
    body('contact_person_name').optional({ checkFalsy: true }).isString().isLength({ max: 255 }),
    body('contact_person_phone').optional({ checkFalsy: true }).isString().isLength({ max: 32 }),
    body('alternate_phone').optional({ checkFalsy: true }).isString().isLength({ max: 32 }),
    body('city').optional({ checkFalsy: true }).isString().isLength({ max: 100 }),
    body('pincode').optional({ checkFalsy: true }).isString().isLength({ max: 10 }),
    body('notes').optional({ checkFalsy: true }).isString().isLength({ max: 5000 })
  ];
}

function pickExtendedVendorFields(body) {
  return {
    po_payment_terms: body.po_payment_terms || 'postpaid_monthly',
    credit_days: body.credit_days != null && body.credit_days !== '' ? Number(body.credit_days) : 1,
    pan_number: body.pan_number || null,
    msme_number: body.msme_number || null,
    contact_person_name: body.contact_person_name || null,
    contact_person_phone: body.contact_person_phone || null,
    alternate_phone: body.alternate_phone || null,
    city: body.city || null,
    pincode: body.pincode || null,
    notes: body.notes || null
  };
}

function normalizeVendorRow(row) {
  if (!row) return row;
  // eslint-disable-next-line no-unused-vars
  const { password_hash, vendor_portal_password_hash, remember_pass_plain, ...rest } = row;
  return {
    ...rest,
    id: row.vendor_id,
    vendor_id: row.vendor_id,
    f_name: row.first_name,
    l_name: row.last_name,
    number: row.phone,
    gst_number: row.gst_number,
    /* Laravel seller.remember_pass — shown in admin hover card; omit hash */
    remember_pass: remember_pass_plain ?? null
  };
}

const getValidators = [param('id').isInt().toInt()];

async function getVendor(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  const { id } = req.params;

  const r = await pool.query(
    `SELECT v.*, s.shop_id, s.name AS shop_name, s.image_url AS shop_logo_url, s.banner_url AS shop_banner_url
     FROM vendors v
     LEFT JOIN vendor_shops s ON s.vendor_id = v.vendor_id AND s.deleted_at IS NULL
     WHERE v.vendor_id = $1 AND v.deleted_at IS NULL`,
    [id]
  );
  if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Vendor not found' });
  res.json({ success: true, data: normalizeVendorRow(r.rows[0]) });
}

const lookupValidators = [query('vendor_id').notEmpty().isInt().toInt()];

async function lookupVendor(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  const id = req.query.vendor_id;
  const r = await pool.query(`SELECT * FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [id]);
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Vendor not found' });
  res.json({ success: true, data: normalizeVendorRow(r.rows[0]) });
}

function createValidators() {
  return [
    body('status').trim().notEmpty().isIn(['pending', 'approved', 'suspended']),
    body('f_name').trim().notEmpty().isLength({ min: 1, max: 255 }),
    body('business_name').trim().notEmpty().isLength({ min: 1, max: 255 }),
    body('email').trim().notEmpty().isEmail(),
    body('password').notEmpty().isLength({ min: 8, max: 256 }),
    body('number')
      .trim()
      .notEmpty()
      .matches(/^\d{10}$/)
      .withMessage('Phone must be exactly 10 digits'),
    body('address').trim().notEmpty(),
    body('business_type').trim().notEmpty(),
    body('registration_date')
      .trim()
      .notEmpty()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Invalid registration date'),
    body('bank_name').trim().notEmpty().isLength({ min: 1, max: 255 }),
    body('account_number')
      .trim()
      .notEmpty()
      .matches(/^\d+$/)
      .withMessage('Account number must be numeric'),
    body('bank_ifsc_code').trim().notEmpty(),
    body('account_holder_name').trim().notEmpty(),
    body('state').trim().notEmpty(),
    body('from_submit').trim().notEmpty().isIn(['admin', 'user']),
    body('l_name').optional({ checkFalsy: true }).isString().isLength({ max: 255 }),
    body('gst_number').optional({ checkFalsy: true }).isString().isLength({ max: 64 }),
    body('brand_code').optional({ checkFalsy: true }).isString().isLength({ max: 64 }),
    body('business_registration_number').optional({ checkFalsy: true }).isString().isLength({ max: 128 }),
    body('tax_identification_number').optional({ checkFalsy: true }).isString().isLength({ max: 128 }),
    ...extendedVendorValidators()
  ];
}

async function createVendor(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const exists = await pool.query(
      `SELECT 1 FROM vendors WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [req.body.email]
    );
    if (exists.rows.length) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const pwd = req.body.password;
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(pwd, salt);
    const remember_pass_plain = String(pwd);

    const image_url = saveUploadedFile(req.files?.image?.[0]);
    const licenses_url = saveUploadedFile(req.files?.licenses_and_permits?.[0]);
    const logo_url = saveUploadedFile(req.files?.logo?.[0]);
    const ext = pickExtendedVendorFields(req.body);

    await pool.query('BEGIN');

    const ins = await pool.query(
      `INSERT INTO vendors (
        status, first_name, last_name, business_name, email, phone, password_hash, vendor_portal_password_hash, address,
        business_type, registration_date, state, city, pincode,
        gst_number, pan_number, msme_number, brand_code, business_registration_number, tax_identification_number,
        contact_person_name, contact_person_phone, alternate_phone,
        bank_name, account_number, bank_ifsc_code, account_holder_name,
        po_payment_terms, credit_days, notes,
        image_url, logo_url, licenses_url, remember_pass_plain, vendor_portal_enabled
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,TRUE
      ) RETURNING *`,
      [
        req.body.status,
        req.body.f_name,
        req.body.l_name || null,
        req.body.business_name,
        req.body.email,
        req.body.number,
        password_hash,
        password_hash,
        req.body.address,
        req.body.business_type,
        req.body.registration_date,
        req.body.state,
        ext.city,
        ext.pincode,
        req.body.gst_number || null,
        ext.pan_number,
        ext.msme_number,
        req.body.brand_code || null,
        req.body.business_registration_number || null,
        req.body.tax_identification_number || null,
        ext.contact_person_name,
        ext.contact_person_phone,
        ext.alternate_phone,
        req.body.bank_name,
        req.body.account_number,
        req.body.bank_ifsc_code,
        req.body.account_holder_name,
        ext.po_payment_terms,
        ext.credit_days,
        ext.notes,
        image_url,
        logo_url,
        licenses_url,
        remember_pass_plain
      ]
    );

    const v = ins.rows[0];
    const shopLogo = saveUploadedFile(req.files?.logo?.[0]);
    const shopBanner = saveUploadedFile(req.files?.banner?.[0]);

    await pool.query(
      `INSERT INTO vendor_shops (vendor_id, name, address, contact, image_url, banner_url)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [v.vendor_id, req.body.business_name, req.body.address, req.body.number, shopLogo, shopBanner]
    );

    await pool.query(
      `INSERT INTO vendor_wallets (vendor_id) VALUES ($1) ON CONFLICT (vendor_id) DO NOTHING`,
      [v.vendor_id]
    );

    await pool.query('COMMIT');

    await logVendorAudit({
      actorUserId: req.user?.user_id,
      vendorId: v.vendor_id,
      entityType: 'vendor',
      entityId: v.vendor_id,
      action: 'create',
      payload: { email: v.email }
    });

    res.status(201).json({ success: true, message: 'Vendor added successfully', data: normalizeVendorRow(v) });
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ success: false, message: e.message || 'Create failed' });
  }
}

function updateValidatorsFixed() {
  return [
    param('id').isInt().toInt(),
    body('password').optional({ checkFalsy: true }).isLength({ min: 8, max: 256 }),
    body('status').trim().notEmpty().isIn(['pending', 'approved', 'suspended']),
    body('f_name').trim().notEmpty().isLength({ min: 1, max: 255 }),
    body('business_name').trim().notEmpty().isLength({ min: 1, max: 255 }),
    body('email').trim().notEmpty().isEmail(),
    body('number')
      .trim()
      .notEmpty()
      .matches(/^\d{10}$/)
      .withMessage('Phone must be exactly 10 digits'),
    body('address').trim().notEmpty(),
    body('business_type').trim().notEmpty(),
    body('registration_date')
      .trim()
      .notEmpty()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Invalid registration date'),
    body('bank_name').trim().notEmpty().isLength({ min: 1, max: 255 }),
    body('account_number')
      .trim()
      .notEmpty()
      .matches(/^\d+$/)
      .withMessage('Account number must be numeric'),
    body('bank_ifsc_code').trim().notEmpty(),
    body('account_holder_name').trim().notEmpty(),
    body('state').trim().notEmpty(),
    body('from_submit').trim().notEmpty().isIn(['admin', 'user']),
    body('l_name').optional({ checkFalsy: true }).isString().isLength({ max: 255 }),
    body('gst_number').optional({ checkFalsy: true }).isString().isLength({ max: 64 }),
    body('brand_code').optional({ checkFalsy: true }).isString().isLength({ max: 64 }),
    body('business_registration_number').optional({ checkFalsy: true }).isString().isLength({ max: 128 }),
    body('tax_identification_number').optional({ checkFalsy: true }).isString().isLength({ max: 128 }),
    ...extendedVendorValidators()
  ];
}

async function updateVendor(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  const vendor_id = Number(req.params.id);

  const emailCheck = await pool.query(
    `SELECT 1 FROM vendors WHERE LOWER(email) = LOWER($1) AND vendor_id <> $2 AND deleted_at IS NULL`,
    [req.body.email, vendor_id]
  );
  if (emailCheck.rows.length) {
    return res.status(400).json({ success: false, message: 'Email already in use' });
  }

  const cur = await pool.query(`SELECT * FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [vendor_id]);
  if (!cur.rows.length) return res.status(404).json({ success: false, message: 'Vendor not found' });

  const prev = cur.rows[0];

  let password_hash = prev.password_hash;
  let vendor_portal_password_hash = prev.vendor_portal_password_hash || prev.password_hash;
  let remember_pass_plain = prev.remember_pass_plain;
  if (req.body.password && String(req.body.password).length >= 8) {
    const hashed = await bcrypt.hash(req.body.password, await bcrypt.genSalt(10));
    password_hash = hashed;
    vendor_portal_password_hash = hashed;
    remember_pass_plain = String(req.body.password);
  }

  const image_url = saveUploadedFile(req.files?.image?.[0]) || prev.image_url;
  const licenses_url = saveUploadedFile(req.files?.licenses_and_permits?.[0]) || prev.licenses_url;
  const logo_url = saveUploadedFile(req.files?.logo?.[0]) || prev.logo_url;
  const ext = pickExtendedVendorFields(req.body);

  const upd = await pool.query(
    `UPDATE vendors SET
      status = $1,
      first_name = $2,
      last_name = $3,
      business_name = $4,
      email = $5,
      phone = $6,
      password_hash = $7,
      vendor_portal_password_hash = $8,
      address = $9,
      business_type = $10,
      registration_date = $11,
      state = $12,
      city = $13,
      pincode = $14,
      gst_number = $15,
      pan_number = $16,
      msme_number = $17,
      brand_code = $18,
      business_registration_number = $19,
      tax_identification_number = $20,
      contact_person_name = $21,
      contact_person_phone = $22,
      alternate_phone = $23,
      bank_name = $24,
      account_number = $25,
      bank_ifsc_code = $26,
      account_holder_name = $27,
      po_payment_terms = $28,
      credit_days = $29,
      notes = $30,
      image_url = $31,
      logo_url = $32,
      licenses_url = $33,
      remember_pass_plain = $34,
      updated_at = NOW()
     WHERE vendor_id = $35 AND deleted_at IS NULL
     RETURNING *`,
    [
      req.body.status,
      req.body.f_name,
      req.body.l_name || null,
      req.body.business_name,
      req.body.email,
      req.body.number,
      password_hash,
      vendor_portal_password_hash,
      req.body.address,
      req.body.business_type,
      req.body.registration_date,
      req.body.state,
      ext.city,
      ext.pincode,
      req.body.gst_number || null,
      ext.pan_number,
      ext.msme_number,
      req.body.brand_code || null,
      req.body.business_registration_number || null,
      req.body.tax_identification_number || null,
      ext.contact_person_name,
      ext.contact_person_phone,
      ext.alternate_phone,
      req.body.bank_name,
      req.body.account_number,
      req.body.bank_ifsc_code,
      req.body.account_holder_name,
      ext.po_payment_terms,
      ext.credit_days,
      ext.notes,
      image_url,
      logo_url,
      licenses_url,
      remember_pass_plain,
      vendor_id
    ]
  );

  const shopLogo = saveUploadedFile(req.files?.logo?.[0]);
  const shopBanner = saveUploadedFile(req.files?.banner?.[0]);

  const shopUpd = await pool.query(
    `UPDATE vendor_shops SET
      name = $1,
      address = $2,
      contact = $3,
      image_url = COALESCE($4, image_url),
      banner_url = COALESCE($5, banner_url),
      updated_at = NOW()
     WHERE vendor_id = $6 AND deleted_at IS NULL`,
    [
      req.body.business_name,
      req.body.address,
      req.body.number,
      shopLogo,
      shopBanner,
      vendor_id
    ]
  );

  if (shopUpd.rowCount === 0) {
    await pool.query(
      `INSERT INTO vendor_shops (vendor_id, name, address, contact, image_url, banner_url)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [vendor_id, req.body.business_name, req.body.address, req.body.number, shopLogo, shopBanner]
    );
  }

  await pool.query(`INSERT INTO vendor_wallets (vendor_id) VALUES ($1) ON CONFLICT (vendor_id) DO NOTHING`, [
    vendor_id
  ]);

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: vendor_id,
    entityType: 'vendor',
    entityId: vendor_id,
    action: 'update',
    payload: { email: req.body.email }
  });

  res.json({
    success: true,
    message: 'Vendor updated successfully',
    data: normalizeVendorRow(upd.rows[0])
  });
}

async function deleteVendor(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  const vendor_id = Number(req.params.id);

  const vr = await pool.query(`SELECT vendor_id FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [vendor_id]);
  if (!vr.rows.length) {
    return res.status(404).json({ success: false, error: 'Vendor not found.', message: 'Vendor not found.' });
  }

  const shop = await pool.query(
    `SELECT shop_id FROM vendor_shops WHERE vendor_id = $1 AND deleted_at IS NULL`,
    [vendor_id]
  );
  if (!shop.rows.length) {
    return res
      .status(400)
      .json({ success: false, error: "Vendor's shop details not found.", message: "Vendor's shop details not found." });
  }

  await pool.query('BEGIN');
  try {
    await pool.query(`UPDATE vendor_shops SET deleted_at = NOW() WHERE vendor_id = $1`, [vendor_id]);
    await pool.query(`UPDATE vendors SET deleted_at = NOW() WHERE vendor_id = $1`, [vendor_id]);
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: vendor_id,
    entityType: 'vendor',
    entityId: vendor_id,
    action: 'soft_delete',
    payload: {}
  });

  res.json({ success: true, message: 'Vendor Details deleted successfully.' });
}

const portalAccessValidators = [
  param('id').isInt().toInt(),
  body('portal_enabled').optional().isBoolean(),
  body('password').optional({ checkFalsy: true }).isLength({ min: 8, max: 256 })
];

async function updatePortalAccess(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const vendor_id = Number(req.params.id);
  const cur = await pool.query(
    `SELECT vendor_id, vendor_portal_enabled, vendor_portal_last_login FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`,
    [vendor_id]
  );
  if (!cur.rows.length) return res.status(404).json({ success: false, message: 'Vendor not found' });

  const sets = [];
  const params = [];
  let idx = 1;

  if (typeof req.body.portal_enabled === 'boolean') {
    sets.push(`vendor_portal_enabled = $${idx}`);
    params.push(req.body.portal_enabled);
    idx += 1;
  }

  if (req.body.password && String(req.body.password).length >= 8) {
    const hashed = await bcrypt.hash(String(req.body.password), await bcrypt.genSalt(10));
    sets.push(`vendor_portal_password_hash = $${idx}`);
    params.push(hashed);
    idx += 1;
    sets.push(`password_hash = $${idx}`);
    params.push(hashed);
    idx += 1;
    sets.push(`remember_pass_plain = $${idx}`);
    params.push(String(req.body.password));
    idx += 1;
  }

  if (!sets.length) {
    return res.status(400).json({ success: false, message: 'No portal changes provided' });
  }

  params.push(vendor_id);
  const r = await pool.query(
    `UPDATE vendors SET ${sets.join(', ')}, updated_at = NOW()
     WHERE vendor_id = $${idx} AND deleted_at IS NULL
     RETURNING vendor_id, vendor_portal_enabled, vendor_portal_last_login, email`,
    params
  );

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: vendor_id,
    entityType: 'vendor',
    entityId: vendor_id,
    action: 'portal_access_update',
    payload: { portal_enabled: req.body.portal_enabled }
  });

  res.json({
    success: true,
    message: 'Vendor portal access updated',
    data: r.rows[0]
  });
}

async function loginAsVendor(req, res) {
  const privileged = req.user.role === 'admin' || req.user.is_superadmin === true;
  if (!privileged) {
    return res.status(403).json({
      success: false,
      message: 'Only administrators can use login-as-vendor (Laravel superadmin parity).'
    });
  }

  await body('vendor_id').isInt().toInt().run(req);
  await body('vendor_email').isEmail().run(req);
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const r = await pool.query(
    `SELECT vendor_id, email, status, first_name AS f_name, last_name AS l_name
     FROM vendors WHERE vendor_id = $1 AND email = $2 AND deleted_at IS NULL`,
    [req.body.vendor_id, req.body.vendor_email]
  );

  if (!r.rows.length) return res.status(400).json({ success: false, message: 'Invalid vendor ID or email.' });

  const vendor = r.rows[0];
  if (vendor.status === 'pending') {
    return res.status(400).json({ success: false, message: 'Vendor account is not approved yet.' });
  }
  if (vendor.status === 'suspended') {
    return res.status(400).json({ success: false, message: 'Vendor account is suspended!' });
  }
  if (vendor.status !== 'approved') {
    return res.status(400).json({ success: false, message: 'Vendor account is not active!' });
  }

  const vendorToken = jwt.sign(
    {
      vendor_impersonation: true,
      vendor_id: vendor.vendor_id,
      email: vendor.email,
      impersonated_by_user_id: req.user?.user_id
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    success: true,
    message: 'Login Successful',
    vendorToken,
    vendor: {
      vendor_id: vendor.vendor_id,
      email: vendor.email,
      status: vendor.status,
      name: `${vendor.f_name || ''} ${vendor.l_name || ''}`.trim()
    }
  });
}

module.exports = {
  buildMulter,
  listValidators,
  listVendors,
  getValidators,
  getVendor,
  lookupValidators,
  lookupVendor,
  createValidators,
  createVendor,
  updateValidatorsFixed,
  updateVendor,
  deleteVendor,
  loginAsVendor,
  portalAccessValidators,
  updatePortalAccess
};
