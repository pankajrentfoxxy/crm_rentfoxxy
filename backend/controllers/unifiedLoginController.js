/**
 * Unified login: email + password only.
 * Credentials live in auth_credentials; response includes portal type.
 */
'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/db');
const { ensureCredentialForEmail } = require('../services/authCredentialsService');
const { getCustomerPortalUrl } = require('../utils/publicUrls');

function portalUrls() {
  return {
    crm: process.env.FRONTEND_URL?.split(',')[0]?.trim() || 'http://localhost:3000',
    vendor: process.env.VENDOR_PORTAL_URL || 'http://localhost:3001',
    customer: getCustomerPortalUrl(),
  };
}

async function getUserTeamIds(userId, primaryTeamId) {
  try {
    const r = await pool.query(
      `SELECT team_id FROM user_teams WHERE user_id = $1
       UNION SELECT $2::int WHERE $2 IS NOT NULL`,
      [userId, primaryTeamId]
    );
    return r.rows.map((x) => x.team_id).filter((id) => id != null);
  } catch {
    return primaryTeamId ? [primaryTeamId] : [];
  }
}

async function completeCrmLogin(userId, req) {
  const result = await pool.query(
    `SELECT u.*, t.team_name
       FROM users u
       LEFT JOIN teams t ON u.team_id = t.team_id
      WHERE u.user_id = $1 AND u.active = true`,
    [userId]
  );
  if (!result.rows.length) {
    return { fail: true, status: 403, message: 'Account is inactive' };
  }

  const user = result.rows[0];
  if (user.status === 'pending_approval') {
    return { fail: true, status: 403, message: 'Your account is pending approval from admin' };
  }
  if (user.status === 'rejected') {
    return { fail: true, status: 403, message: user.rejection_reason || 'Your registration was rejected' };
  }
  if (user.status === 'blocked') {
    return { fail: true, status: 403, message: 'Your account has been blocked' };
  }

  const teamIds = await getUserTeamIds(user.user_id, user.team_id);
  try {
    await pool.query(
      'UPDATE users SET last_login = NOW(), last_login_ip = $1 WHERE user_id = $2',
      [req.ip || req.headers['x-forwarded-for'] || null, user.user_id]
    );
  } catch {
    /* non-fatal */
  }

  const token = jwt.sign(
    {
      user_id: user.user_id,
      email: user.email,
      role: user.role,
      status: user.status || 'active',
      user_type: user.user_type || 'internal',
      team_id: user.team_id,
      team_ids: teamIds,
      permissions: user.permissions || [],
    },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  delete user.password_hash;
  const urls = portalUrls();
  return {
    portal: 'crm',
    redirect_url: urls.crm,
    token,
    user,
    message: 'Login successful',
  };
}

async function completeVendorLogin(vendorId) {
  const r = await pool.query(
    `SELECT vendor_id, email, status, business_name, first_name, vendor_portal_enabled
       FROM vendors
      WHERE vendor_id = $1 AND deleted_at IS NULL`,
    [vendorId]
  );
  if (!r.rows.length) {
    return { fail: true, status: 403, message: 'Vendor account not found' };
  }

  const vendor = r.rows[0];
  if (vendor.status !== 'approved') {
    return { fail: true, status: 403, message: 'Your vendor account is not approved yet' };
  }
  if (vendor.vendor_portal_enabled === false) {
    return { fail: true, status: 403, message: 'Vendor portal access is disabled. Contact Rentfoxxy.' };
  }

  const token = jwt.sign(
    { type: 'vendor_portal', vendor_id: vendor.vendor_id, email: vendor.email },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO vendor_portal_sessions (vendor_id, token, expires_at) VALUES ($1, $2, $3)`,
    [vendor.vendor_id, token, expiresAt]
  );
  await pool.query(`UPDATE vendors SET vendor_portal_last_login = NOW() WHERE vendor_id = $1`, [vendor.vendor_id]);

  const urls = portalUrls();
  return {
    portal: 'vendor',
    redirect_url: urls.vendor,
    token,
    vendor: {
      vendor_id: vendor.vendor_id,
      email: vendor.email,
      business_name: vendor.business_name,
      first_name: vendor.first_name,
    },
    message: 'Login successful',
  };
}

async function completeCustomerLogin(customerId) {
  const result = await pool.query(
    `SELECT customer_id, name, company_name, email, portal_enabled
       FROM customers WHERE customer_id = $1 LIMIT 1`,
    [customerId]
  );
  if (!result.rows.length) {
    return { fail: true, status: 403, message: 'Customer account not found' };
  }

  const row = result.rows[0];
  if (!row.portal_enabled) {
    return { fail: true, status: 403, message: 'Portal access disabled' };
  }

  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(`DELETE FROM customer_portal_sessions WHERE customer_id = $1`, [row.customer_id]);
  await pool.query(
    `INSERT INTO customer_portal_sessions (customer_id, token, expires_at) VALUES ($1, $2, $3)`,
    [row.customer_id, token, expiresAt]
  );
  await pool.query(`UPDATE customers SET portal_last_login = NOW() WHERE customer_id = $1`, [row.customer_id]);

  const urls = portalUrls();
  return {
    portal: 'customer',
    redirect_url: urls.customer,
    token,
    customer: {
      customer_id: row.customer_id,
      name: row.name,
      company_name: row.company_name,
      email: row.email,
    },
    message: 'Login successful',
  };
}

/**
 * Resolve login from auth_credentials using email + password only.
 * @returns {Promise<{ok:true, data}|{ok:false, status, message, portal?}>}
 */
async function resolveLogin(req) {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!email || !password) {
    return { ok: false, status: 400, message: 'Email and password required' };
  }

  const cred = await ensureCredentialForEmail(email);

  if (!cred) {
    return { ok: false, status: 401, message: 'Invalid credentials' };
  }
  if (!cred.enabled) {
    return { ok: false, status: 403, message: 'Portal access disabled', portal: cred.portal };
  }

  const ok = await bcrypt.compare(password, cred.password_hash);
  if (!ok) {
    return { ok: false, status: 401, message: 'Invalid credentials' };
  }

  let result;
  if (cred.portal === 'crm') {
    result = await completeCrmLogin(cred.entity_id, req);
  } else if (cred.portal === 'vendor') {
    result = await completeVendorLogin(cred.entity_id);
  } else if (cred.portal === 'customer') {
    result = await completeCustomerLogin(cred.entity_id);
  } else {
    return { ok: false, status: 401, message: 'Invalid credentials' };
  }

  if (result.fail) {
    return {
      ok: false,
      status: result.status || 401,
      message: result.message,
      portal: cred.portal,
    };
  }
  return { ok: true, data: result };
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Response includes portal: "crm" | "vendor" | "customer"
 */
exports.unifiedLogin = async (req, res) => {
  try {
    const resolved = await resolveLogin(req);
    if (!resolved.ok) {
      return res.status(resolved.status).json({
        success: false,
        message: resolved.message,
        portal: resolved.portal || undefined,
      });
    }
    return res.json({ success: true, ...resolved.data });
  } catch (error) {
    console.error('unifiedLogin:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error during login' });
  }
};

exports.resolveLogin = resolveLogin;
