const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

function parseDetails(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
}

function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function formatCustomerRow(row) {
  const details = parseDetails(row.details);
  const uploadDocs = Array.isArray(details.upload_docs) ? details.upload_docs : [];
  return {
    id: row.customer_id,
    customer_id: row.customer_id,
    customer_name: row.name,
    email: row.email,
    customer_number: row.phone,
    contact_person_name: details.contact_person_name || '',
    contact_person_number: details.contact_person_number || '',
    gst_number: row.gst_no || details.gst_number || '',
    pan_card_number: details.pan_card_number || '',
    business_type: details.business_type || '',
    profile: details.profile || null,
    upload_docs: uploadDocs,
    total_security_amount: Number(row.total_security_amount || 0),
    billing_address: details.billing_address || null,
    shipping_addresses: details.shipping_address || details.shipping_addresses || [],
    status: row.status ?? 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    details,
  };
}

async function ensureCustomerManagementSchema() {
  const migrationPath = path.join(__dirname, '../migrations/045_customer_management_module.sql');
  if (!fs.existsSync(migrationPath)) return;
  const sql = fs.readFileSync(migrationPath, 'utf8');
  await pool.query(sql);
}

exports.ensureCustomerManagementSchema = ensureCustomerManagementSchema;

exports.getAddCustomerMeta = async (req, res) => {
  res.json({ success: true, generated_password: generatePassword() });
};

exports.listCustomers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const search = (req.query.search || '').trim();
    const params = [];
    const conditions = ['c.status = 1'];

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      conditions.push(`(
        c.name ILIKE $${idx} OR c.email ILIKE $${idx} OR c.phone ILIKE $${idx}
        OR c.gst_no ILIKE $${idx} OR c.company_name ILIKE $${idx}
        OR c.details->>'contact_person_name' ILIKE $${idx}
        OR c.details->>'pan_card_number' ILIKE $${idx}
      )`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM customers c ${where}`,
      params
    );

    const offset = (page - 1) * limit;
    const listParams = [...params, limit, offset];
    const listResult = await pool.query(
      `SELECT c.*,
        COALESCE((
          SELECT SUM(security_amount) FROM sales_quotations sq WHERE sq.customer_id = c.customer_id
        ), 0) AS total_security_amount
       FROM customers c
       ${where}
       ORDER BY c.updated_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    res.json({
      success: true,
      customers: listResult.rows.map(formatCustomerRow),
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
        totalPages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
      },
    });
  } catch (error) {
    console.error('listCustomers:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCustomer = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*,
        COALESCE((
          SELECT SUM(security_amount) FROM sales_quotations sq WHERE sq.customer_id = c.customer_id
        ), 0) AS total_security_amount
       FROM customers c WHERE c.customer_id = $1`,
      [req.params.customerId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    res.json({ success: true, customer: formatCustomerRow(result.rows[0]) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.storeCustomer = async (req, res) => {
  try {
    const body = req.body;
    const required = [
      'customer_name', 'customer_number', 'email', 'contact_person_name',
      'contact_person_number', 'billing_state', 'billing_city', 'billing_pin_code',
      'billing_address_1', 'billing_address_2', 'shipping_state', 'shipping_city',
      'shipping_pin_code', 'shipping_address_1', 'shipping_address_2', 'business_type', 'password',
    ];
    for (const field of required) {
      if (!body[field]) {
        return res.status(400).json({ success: false, message: `${field} is required` });
      }
    }

    const emailCheck = await pool.query(`SELECT customer_id FROM customers WHERE email = $1 LIMIT 1`, [body.email]);
    if (emailCheck.rows.length) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }
    if (body.gst_number) {
      const gstCheck = await pool.query(`SELECT customer_id FROM customers WHERE gst_no = $1 LIMIT 1`, [body.gst_number]);
      if (gstCheck.rows.length) {
        return res.status(400).json({ success: false, message: 'GST number already exists' });
      }
    }
    if (body.pan_card_number) {
      const panCheck = await pool.query(
        `SELECT customer_id FROM customers WHERE details->>'pan_card_number' = $1 LIMIT 1`,
        [body.pan_card_number]
      );
      if (panCheck.rows.length) {
        return res.status(400).json({ success: false, message: 'PAN number already exists' });
      }
    }

    const billingAddress = {
      name: body.customer_name,
      phone: body.customer_number,
      country: 'India',
      state: body.billing_state,
      city: body.billing_city,
      zip_code: body.billing_pin_code,
      address: `${body.billing_address_1}, ${body.billing_address_2}`,
    };

    const shippingAddresses = [{
      name: body.contact_person_name,
      phone: body.contact_person_number,
      country: 'India',
      state: body.shipping_state,
      city: body.shipping_city,
      zip_code: body.shipping_pin_code,
      address: `${body.shipping_address_1}, ${body.shipping_address_2}`,
    }];

    const uploadDocs = [];
    if (req.files?.upload_docs) {
      const files = Array.isArray(req.files.upload_docs) ? req.files.upload_docs : [req.files.upload_docs];
      for (const file of files) {
        const destDir = path.join('uploads', 'customers', 'docs');
        fs.mkdirSync(destDir, { recursive: true });
        const filename = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const dest = path.join(destDir, filename);
        fs.renameSync(file.path, dest);
        uploadDocs.push(dest.replace(/\\/g, '/'));
      }
    }

    let profilePath = null;
    if (req.files?.profile?.[0]) {
      const file = req.files.profile[0];
      const destDir = path.join('uploads', 'customers', 'profiles');
      fs.mkdirSync(destDir, { recursive: true });
      const filename = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const dest = path.join(destDir, filename);
      fs.renameSync(file.path, dest);
      profilePath = dest.replace(/\\/g, '/');
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const details = {
      contact_person_name: body.contact_person_name,
      contact_person_number: body.contact_person_number,
      business_type: body.business_type,
      pan_card_number: body.pan_card_number || null,
      billing_address: billingAddress,
      shipping_address: shippingAddresses,
      upload_docs: uploadDocs,
      profile: profilePath,
      password_hash: passwordHash,
    };

    const result = await pool.query(
      `INSERT INTO customers (name, company_name, email, phone, gst_no, address, type, details, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, NOW(), NOW())
       RETURNING *`,
      [
        body.customer_name,
        body.customer_name,
        body.email,
        body.customer_number,
        body.gst_number || null,
        billingAddress.address,
        body.business_type === 'supplier' ? 'Supplier' : 'Regular',
        JSON.stringify(details),
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Customer added successfully',
      customer: formatCustomerRow({ ...result.rows[0], total_security_amount: 0 }),
    });
  } catch (error) {
    console.error('storeCustomer:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM customers WHERE customer_id = $1`, [req.params.customerId]);
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const details = parseDetails(result.rows[0].details);
    const files = [...(details.upload_docs || [])];
    if (details.profile) files.push(details.profile);
    for (const file of files) {
      try {
        if (file && fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
    await pool.query(`DELETE FROM customers WHERE customer_id = $1`, [req.params.customerId]);
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
