const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sendCustomerPortalWelcome } = require('../services/emailQueueService');

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

function billingAddressFromRow(row, details) {
  const street = typeof row.billing_address === 'string' && row.billing_address
    ? row.billing_address
    : (details.billing_address?.address || details.billing_address || '');
  return {
    name: row.name || row.company_name || '',
    phone: row.phone || '',
    country: 'India',
    state: row.billing_state || '',
    city: row.billing_city || '',
    zip_code: row.billing_pincode || '',
    gst_number: row.gst_no || details.gst_number || '',
    address: street || '',
  };
}

function formatCustomerRow(row) {
  const details = parseDetails(row.details);
  const uploadDocs = Array.isArray(details.upload_docs) ? details.upload_docs : [];
  const billingObj = billingAddressFromRow(row, details);
  return {
    id: row.customer_id,
    customer_id: row.customer_id,
    customer_name: row.name,
    name: row.name,
    company_name: row.company_name || row.name,
    email: row.email,
    customer_number: row.phone,
    phone: row.phone,
    contact_person_name: details.contact_person_name || row.name || '',
    contact_person_number: details.contact_person_number || row.phone || '',
    gst_number: row.gst_no || details.gst_number || '',
    gst_no: row.gst_no || details.gst_number || '',
    pan_card_number: row.pan_number || details.pan_card_number || '',
    pan_number: row.pan_number || details.pan_card_number || '',
    business_type: details.business_type || row.company_type || '',
    company_type: row.company_type || details.business_type || '',
    company_size: row.company_size || null,
    industry: row.industry || null,
    profile: details.profile || null,
    upload_docs: uploadDocs,
    total_security_amount: Number(row.total_security_amount || 0),
    billing_address: billingObj,
    billingAddress: billingObj.address,
    billing_city: row.billing_city || null,
    billing_state: row.billing_state || null,
    billing_pincode: row.billing_pincode || null,
    shipping_same: row.shipping_same ?? true,
    shipping_address: row.shipping_address || null,
    shipping_city: row.shipping_city || null,
    shipping_state: row.shipping_state || null,
    shipping_pincode: row.shipping_pincode || null,
    whatsapp_number: row.whatsapp_number || null,
    designation: row.designation || null,
    source_lead_id: row.source_lead_id || null,
    source_lead_stage: row.source_lead_stage || null,
    onboarded_by: row.onboarded_by || null,
    onboarded_at: row.onboarded_at || null,
    portal_enabled: row.portal_enabled ?? false,
    portal_last_login: row.portal_last_login || null,
    notes: row.notes || null,
    kyc_verified: row.kyc_verified ?? false,
    kyc_verified_by: row.kyc_verified_by || null,
    kyc_verified_at: row.kyc_verified_at || null,
    shipping_addresses: details.shipping_address || details.shipping_addresses || [],
    status: row.status ?? 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    details,
  };
}

async function ensureCustomerManagementSchema() {
  for (const file of ['045_customer_management_module.sql', '064_customer_addresses.sql', '068_phase6_support_customer_portal.sql']) {
    const migrationPath = path.join(__dirname, '../migrations', file);
    if (!fs.existsSync(migrationPath)) continue;
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(sql);
  }
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
    const customerId = parseInt(req.params.customerId, 10);
    const result = await pool.query(
      `SELECT c.*,
        COALESCE((
          SELECT SUM(security_amount) FROM sales_quotations sq WHERE sq.customer_id = c.customer_id
        ), 0) AS total_security_amount
       FROM customers c WHERE c.customer_id = $1`,
      [customerId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const addrRes = await pool.query(
      `SELECT customer_address_id, customer_id, concern_person, mobile_no, address, pincode,
              is_head_office, address_type, created_at, updated_at
       FROM customer_addresses
       WHERE customer_id = $1
       ORDER BY is_head_office DESC, customer_address_id ASC`,
      [customerId]
    );
    const customer = formatCustomerRow(result.rows[0]);
    customer.saved_addresses = addrRes.rows;
    res.json({ success: true, customer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCustomerAddresses = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Invalid customer id' });
    }
    const { rows } = await pool.query(
      `SELECT customer_address_id, customer_id, concern_person, mobile_no, address, pincode,
              is_head_office, address_type, created_at, updated_at
       FROM customer_addresses
       WHERE customer_id = $1
       ORDER BY is_head_office DESC, customer_address_id ASC`,
      [customerId]
    );
    res.json({ success: true, addresses: rows });
  } catch (error) {
    if (error.message && error.message.includes('customer_addresses')) {
      return res.json({ success: true, addresses: [] });
    }
    console.error('getCustomerAddresses:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addCustomerAddress = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const body = req.body || {};
    const check = await pool.query('SELECT 1 FROM customers WHERE customer_id = $1', [customerId]);
    if (!check.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    if (!body.address) {
      return res.status(400).json({ success: false, message: 'Address is required' });
    }
    const result = await pool.query(
      `INSERT INTO customer_addresses
        (customer_id, concern_person, mobile_no, address, pincode, is_head_office, address_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        customerId,
        body.concern_person || null,
        body.mobile_no || null,
        body.address,
        body.pincode || null,
        !!body.is_head_office,
        body.address_type || 'Shipping',
      ]
    );
    res.status(201).json({ success: true, address: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteCustomerAddress = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const addressId = parseInt(req.params.addressId, 10);
    const result = await pool.query(
      `DELETE FROM customer_addresses
       WHERE customer_address_id = $1 AND customer_id = $2
       RETURNING customer_address_id`,
      [addressId, customerId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    res.json({ success: true, message: 'Address deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.setDefaultCustomerAddress = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const addressId = parseInt(req.params.addressId, 10);
    const check = await pool.query(
      'SELECT 1 FROM customer_addresses WHERE customer_address_id = $1 AND customer_id = $2',
      [addressId, customerId]
    );
    if (!check.rows.length) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    await pool.query(
      'UPDATE customer_addresses SET is_head_office = FALSE WHERE customer_id = $1',
      [customerId]
    );
    await pool.query(
      'UPDATE customer_addresses SET is_head_office = TRUE, updated_at = NOW() WHERE customer_address_id = $1',
      [addressId]
    );
    const { rows } = await pool.query(
      `SELECT customer_address_id, customer_id, concern_person, mobile_no, address, pincode,
              is_head_office, address_type
       FROM customer_addresses WHERE customer_id = $1
       ORDER BY is_head_office DESC, customer_address_id ASC`,
      [customerId]
    );
    res.json({ success: true, addresses: rows });
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

exports.updateCustomer = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const existing = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [customerId]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const row = existing.rows[0];
    const body = req.body || {};
    const details = parseDetails(row.details);

    const name = body.customer_name || body.name || row.name;
    const companyName = body.company_name || row.company_name;
    const email = body.email ?? row.email;
    const phone = body.customer_number || body.phone || row.phone;
    const gstNo = body.gst_number ?? row.gst_no;
    const panNumber = body.pan_number || body.pan_card_number || row.pan_number;

    await pool.query(
      `UPDATE customers SET
        name = $1, company_name = $2, email = $3, phone = $4, gst_no = $5,
        pan_number = $6, company_type = $7, company_size = $8, industry = $9,
        billing_address = $10, billing_city = $11, billing_state = $12, billing_pincode = $13,
        shipping_same = $14, shipping_address = $15, shipping_city = $16, shipping_state = $17, shipping_pincode = $18,
        whatsapp_number = $19, designation = $20, portal_enabled = COALESCE($21, portal_enabled),
        notes = COALESCE($22, notes), updated_at = NOW()
       WHERE customer_id = $23`,
      [
        name, companyName, email, phone, gstNo, panNumber,
        body.company_type ?? row.company_type,
        body.company_size ?? row.company_size,
        body.industry ?? row.industry,
        body.billing_address ?? row.billing_address,
        body.billing_city ?? row.billing_city,
        body.billing_state ?? row.billing_state,
        body.billing_pincode ?? row.billing_pincode,
        body.shipping_same ?? row.shipping_same,
        body.shipping_address ?? row.shipping_address,
        body.shipping_city ?? row.shipping_city,
        body.shipping_state ?? row.shipping_state,
        body.shipping_pincode ?? row.shipping_pincode,
        body.whatsapp_number ?? row.whatsapp_number,
        body.designation ?? row.designation,
        body.portal_enabled !== undefined ? !!body.portal_enabled : null,
        body.notes ?? null,
        customerId,
      ]
    );

    if (body.contact_person_name || body.contact_person_number) {
      details.contact_person_name = body.contact_person_name || details.contact_person_name;
      details.contact_person_number = body.contact_person_number || details.contact_person_number;
      await pool.query('UPDATE customers SET details = $1 WHERE customer_id = $2', [
        JSON.stringify(details),
        customerId,
      ]);
    }

    const updated = await pool.query(
      `SELECT c.*, COALESCE((SELECT SUM(security_amount) FROM sales_quotations sq WHERE sq.customer_id = c.customer_id), 0) AS total_security_amount
       FROM customers c WHERE c.customer_id = $1`,
      [customerId]
    );
    res.json({ success: true, customer: formatCustomerRow(updated.rows[0]) });
  } catch (error) {
    console.error('updateCustomer:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifyCustomerKyc = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const result = await pool.query(
      `UPDATE customers SET kyc_verified = TRUE, kyc_status = 'verified',
              kyc_verified_by = $1, kyc_verified_at = NOW(), updated_at = NOW()
       WHERE customer_id = $2 RETURNING *`,
      [req.user.user_id, customerId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    res.json({ success: true, customer: formatCustomerRow(result.rows[0]) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// "Assets with Customer" — derived from the authoritative inventory
// (vendor_serial_numbers), replacing the deprecated customer_inventory table.
exports.getCustomerLaptops = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const { rows } = await pool.query(
      `SELECT vsn.serial_id,
              COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
              vsn.serial_number,
              vsn.extra->>'brand' AS brand,
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name') AS model_name,
              vsn.extra->>'processor' AS processor,
              vsn.extra->>'generation' AS generation,
              vsn.extra->>'ram' AS ram,
              vsn.extra->>'storage' AS storage,
              vsn.inventory_status AS status,
              vsn.current_entity AS entity_code,
              vsn.current_dc_number AS dc_number,
              vsn.delivered_at AS dispatch_date,
              vsn.rent_start_date,
              vsn.rent_monthly_rate
         FROM vendor_serial_numbers vsn
        WHERE vsn.current_customer_id = $1
          AND vsn.deleted_at IS NULL
          AND vsn.inventory_status IN ('rented','on_demo','sold')
        ORDER BY vsn.delivered_at DESC NULLS LAST`,
      [customerId]
    );
    res.json({ success: true, laptops: rows });
  } catch (error) {
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

exports.enableCustomerPortal = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    const { enabled, reset_password, send_login_email } = req.body || {};

    const existing = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [customerId]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const row = existing.rows[0];

    if (enabled === false) {
      await pool.query(
        `UPDATE customers SET portal_enabled = false, updated_at = NOW() WHERE customer_id = $1`,
        [customerId]
      );
      await pool.query(`DELETE FROM customer_portal_sessions WHERE customer_id = $1`, [customerId]);
      return res.json({ success: true, enabled: false });
    }

    if (send_login_email && enabled !== true && reset_password !== true) {
      if (!row.portal_enabled) {
        return res.status(400).json({ success: false, message: 'Portal is not enabled for this customer' });
      }
      if (!row.email) {
        return res.status(400).json({ success: false, message: 'Customer has no email address' });
      }
      await sendCustomerPortalWelcome({
        customerEmail: row.email,
        customerName: row.company_name || row.name,
        portalUrl: process.env.CUSTOMER_PORTAL_URL || 'http://localhost:3002',
        tempPassword: null,
      });
      return res.json({ success: true, enabled: true, email_sent: true });
    }

    let newPassword = null;
    const needsPassword = reset_password === true || (enabled === true && !row.portal_password_hash);

    if (needsPassword) {
      newPassword = generatePassword();
      const hash = await bcrypt.hash(newPassword, 10);
      await pool.query(
        `UPDATE customers SET portal_password_hash = $1, portal_enabled = COALESCE($2, portal_enabled, true), updated_at = NOW() WHERE customer_id = $3`,
        [hash, enabled === true ? true : null, customerId]
      );
    } else if (enabled === true) {
      await pool.query(
        `UPDATE customers SET portal_enabled = true, updated_at = NOW() WHERE customer_id = $1`,
        [customerId]
      );
    } else {
      return res.status(400).json({ success: false, message: 'Specify enabled, reset_password, or send_login_email' });
    }

    if (send_login_email && row.email) {
      await sendCustomerPortalWelcome({
        customerEmail: row.email,
        customerName: row.company_name || row.name,
        portalUrl: process.env.CUSTOMER_PORTAL_URL || 'http://localhost:3002',
        tempPassword: newPassword,
      });
    }

    res.json({
      success: true,
      enabled: enabled !== false,
      new_password: newPassword || undefined,
    });
  } catch (error) {
    console.error('enableCustomerPortal:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
