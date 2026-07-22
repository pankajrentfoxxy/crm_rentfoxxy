const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { parseIndianMobile } = require('../utils/phoneValidation');

const UPLOAD_SUBDIR = 'delivery-man';
const uploadRoot = path.join(__dirname, '..', '..', 'uploads', UPLOAD_SUBDIR);

function ensureUploadDir() {
  if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });
}

function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function parseIdentityImages(raw) {
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

function formatTechnician(row) {
  if (!row) return null;
  const identityImages = parseIdentityImages(row.identity_image);
  return {
    technician_id: row.technician_id,
    id: row.technician_id,
    user_id: row.user_id,
    first_name: row.first_name,
    last_name: row.last_name,
    f_name: row.first_name,
    l_name: row.last_name,
    country_code: row.country_code || '91',
    phone: row.phone,
    email: row.email,
    address: row.address,
    identity_type: row.identity_type,
    identity_number: row.identity_number,
    identity_image: identityImages,
    image: row.image,
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function removeFile(filename) {
  if (!filename) return;
  const full = path.join(uploadRoot, filename);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

function removeIdentityImages(images) {
  for (const img of parseIdentityImages(images)) removeFile(img);
}

async function listTechnicians({ search = '', page = 1, limit = 25 } = {}) {
  const params = [];
  const conditions = [];

  if (search.trim()) {
    const terms = search.trim().split(/\s+/).filter(Boolean);
    for (const term of terms) {
      params.push(`%${term}%`);
      const i = params.length;
      conditions.push(`(
        first_name ILIKE $${i}
        OR last_name ILIKE $${i}
        OR phone ILIKE $${i}
        OR email ILIKE $${i}
        OR identity_number ILIKE $${i}
      )`);
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countR = await pool.query(
    `SELECT COUNT(*)::int AS total FROM delivery_technicians ${where}`,
    params
  );
  const total = countR.rows[0]?.total || 0;
  const offset = (page - 1) * limit;

  const rowsR = await pool.query(
    `SELECT * FROM delivery_technicians ${where}
     ORDER BY technician_id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    data: rowsR.rows.map(formatTechnician),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function getTechnicianById(id) {
  const r = await pool.query(
    `SELECT * FROM delivery_technicians WHERE technician_id = $1`,
    [id]
  );
  return formatTechnician(r.rows[0]);
}

async function assertUniquePhoneEmail({ email, phone, countryCode, excludeId }) {
  if (email) {
    const er = await pool.query(
      `SELECT technician_id FROM delivery_technicians
       WHERE LOWER(email) = LOWER($1) AND ($2::int IS NULL OR technician_id <> $2)`,
      [email, excludeId || null]
    );
    if (er.rows.length) {
      return { ok: false, message: 'Email is already taken' };
    }
  }
  if (phone) {
    const pr = await pool.query(
      `SELECT technician_id FROM delivery_technicians
       WHERE phone = $1 AND country_code = $2 AND ($3::int IS NULL OR technician_id <> $3)`,
      [phone, countryCode || '91', excludeId || null]
    );
    if (pr.rows.length) {
      return { ok: false, message: 'This phone number is already taken' };
    }
  }
  return { ok: true };
}

async function createTechnician(body, files = {}) {
  ensureUploadDir();
  const firstName = (body.first_name || body.f_name || '').trim();
  const lastName = (body.last_name || body.l_name || '').trim();
  const email = (body.email || '').trim();
  const phoneParsed = parseIndianMobile(body.phone, { required: true, label: 'Phone' });
  if (!phoneParsed.ok) return { ok: false, message: phoneParsed.error };
  const phone = phoneParsed.value;
  const countryCode = (body.country_code || '91').trim();

  if (!firstName) return { ok: false, message: 'First name is required' };
  if (!lastName) return { ok: false, message: 'Last name is required' };
  if (!email) return { ok: false, message: 'Email is required' };

  const unique = await assertUniquePhoneEmail({ email, phone, countryCode });
  if (!unique.ok) return unique;

  const password = body.password || generatePassword();
  if (String(password).length < 8) {
    return { ok: false, message: 'Password must be at least 8 characters' };
  }

  let profileImage = null;
  if (files.image?.[0]) {
    profileImage = files.image[0].filename;
  } else {
    return { ok: false, message: 'Profile image is required' };
  }

  const identityFiles = (files.identity_image || []).map((f) => f.filename);

  const passwordHash = await bcrypt.hash(password, 10);
  const r = await pool.query(
    `INSERT INTO delivery_technicians (
       first_name, last_name, phone, email, country_code, address,
       identity_type, identity_number, identity_image, image, password_hash, is_active
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
     RETURNING *`,
    [
      firstName,
      lastName,
      phone,
      email,
      countryCode,
      body.address || null,
      body.identity_type || null,
      body.identity_number || null,
      JSON.stringify(identityFiles),
      profileImage,
      passwordHash,
      body.is_active !== false && body.is_active !== 'false',
    ]
  );

  return { ok: true, data: formatTechnician(r.rows[0]), plainPassword: password };
}

async function updateTechnician(id, body, files = {}) {
  ensureUploadDir();
  const existingR = await pool.query(
    `SELECT * FROM delivery_technicians WHERE technician_id = $1`,
    [id]
  );
  if (!existingR.rows.length) return { ok: false, message: 'Technician not found', status: 404 };
  const existing = existingR.rows[0];

  const firstName = (body.first_name || body.f_name || existing.first_name || '').trim();
  const lastName = (body.last_name || body.l_name || existing.last_name || '').trim();
  const email = (body.email || existing.email || '').trim();
  let phone = existing.phone;
  if (body.phone !== undefined) {
    const phoneParsed = parseIndianMobile(body.phone, { required: true, label: 'Phone' });
    if (!phoneParsed.ok) return { ok: false, message: phoneParsed.error };
    phone = phoneParsed.value;
  }
  const countryCode = (body.country_code || existing.country_code || '91').trim();

  if (!firstName) return { ok: false, message: 'First name is required' };
  if (!lastName) return { ok: false, message: 'Last name is required' };

  const unique = await assertUniquePhoneEmail({ email, phone, countryCode, excludeId: id });
  if (!unique.ok) return unique;

  let profileImage = existing.image;
  if (files.image?.[0]) {
    removeFile(existing.image);
    profileImage = files.image[0].filename;
  }

  let identityImages = parseIdentityImages(existing.identity_image);
  if (files.identity_image?.length) {
    removeIdentityImages(existing.identity_image);
    identityImages = files.identity_image.map((f) => f.filename);
  }

  let passwordHash = existing.password_hash;
  if (body.password && String(body.password).length >= 6) {
    passwordHash = await bcrypt.hash(body.password, 10);
  }

  const isActive =
    body.is_active === undefined
      ? existing.is_active
      : body.is_active !== false && body.is_active !== 'false' && body.is_active !== 0 && body.is_active !== '0';

  const r = await pool.query(
    `UPDATE delivery_technicians SET
       first_name = $1,
       last_name = $2,
       phone = $3,
       email = $4,
       country_code = $5,
       address = $6,
       identity_type = $7,
       identity_number = $8,
       identity_image = $9::jsonb,
       image = $10,
       password_hash = $11,
       is_active = $12,
       updated_at = NOW()
     WHERE technician_id = $13
     RETURNING *`,
    [
      firstName,
      lastName,
      phone,
      email,
      countryCode,
      body.address !== undefined ? body.address : existing.address,
      body.identity_type !== undefined ? body.identity_type : existing.identity_type,
      body.identity_number !== undefined ? body.identity_number : existing.identity_number,
      JSON.stringify(identityImages),
      profileImage,
      passwordHash,
      isActive,
      id,
    ]
  );

  return { ok: true, data: formatTechnician(r.rows[0]) };
}

async function changeTechnicianPassword(id, newPassword) {
  const password = String(newPassword || '');
  if (password.length < 8) {
    return { ok: false, message: 'Password must be at least 8 characters' };
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const r = await pool.query(
    `UPDATE delivery_technicians SET password_hash = $1, updated_at = NOW()
     WHERE technician_id = $2 RETURNING *`,
    [passwordHash, id]
  );
  if (!r.rows.length) return { ok: false, message: 'Technician not found', status: 404 };
  return { ok: true, data: formatTechnician(r.rows[0]) };
}

async function updateTechnicianStatus(id, status) {
  const isActive = status === 1 || status === '1' || status === true;
  const r = await pool.query(
    `UPDATE delivery_technicians SET is_active = $1, updated_at = NOW()
     WHERE technician_id = $2 RETURNING *`,
    [isActive, id]
  );
  if (!r.rows.length) return { ok: false, message: 'Technician not found', status: 404 };
  return { ok: true, data: formatTechnician(r.rows[0]) };
}

async function deleteTechnician(id) {
  const r = await pool.query(
    `SELECT * FROM delivery_technicians WHERE technician_id = $1`,
    [id]
  );
  if (!r.rows.length) return { ok: false, message: 'Technician not found', status: 404 };
  const row = r.rows[0];
  removeFile(row.image);
  removeIdentityImages(row.identity_image);
  await pool.query(`DELETE FROM delivery_technicians WHERE technician_id = $1`, [id]);
  return { ok: true };
}

const DELIVERY_TECH_LINK_ROLES = new Set(['support_tech', 'support_lead', 'dispatch', 'dispatch_qc']);

function splitUserName(full) {
  const t = String(full || '').trim();
  if (!t) return { first: 'Field', last: 'Technician' };
  const i = t.indexOf(' ');
  if (i < 0) return { first: t, last: 'Technician' };
  return { first: t.slice(0, i), last: t.slice(i + 1).trim() || 'Technician' };
}

/** Ensure a CRM support/dispatch user has a linked delivery_technicians row (for DC dropdown + My Deliveries). */
async function ensureLinkedDeliveryTechnician(userId) {
  if (!userId) return null;
  const uRes = await pool.query(
    `SELECT user_id, name, email, mobile_no, role, active, status
       FROM users WHERE user_id = $1`,
    [userId]
  );
  const u = uRes.rows[0];
  if (!u || !u.active || String(u.status || 'active') !== 'active') return null;
  if (!DELIVERY_TECH_LINK_ROLES.has(u.role)) return null;

  const linked = await pool.query(
    `SELECT technician_id, user_id FROM delivery_technicians
      WHERE user_id = $1 OR LOWER(email) = LOWER($2)
      ORDER BY CASE WHEN user_id = $1 THEN 0 ELSE 1 END
      LIMIT 1`,
    [userId, u.email]
  );
  if (linked.rows[0]) {
    if (!linked.rows[0].user_id) {
      await pool.query(
        `UPDATE delivery_technicians SET user_id = $1, updated_at = NOW() WHERE technician_id = $2`,
        [userId, linked.rows[0].technician_id]
      );
    }
    return linked.rows[0].technician_id;
  }

  const { first, last } = splitUserName(u.name);
  const phone = String(u.mobile_no || '').trim() || `9${String(userId).padStart(9, '0').slice(-9)}`;
  const ins = await pool.query(
    `INSERT INTO delivery_technicians (user_id, first_name, last_name, phone, email, country_code, is_active)
     VALUES ($1, $2, $3, $4, $5, '91', TRUE)
     RETURNING technician_id`,
    [userId, first, last, phone, u.email]
  );
  return ins.rows[0]?.technician_id || null;
}

module.exports = {
  UPLOAD_SUBDIR,
  generatePassword,
  formatTechnician,
  listTechnicians,
  getTechnicianById,
  createTechnician,
  updateTechnician,
  changeTechnicianPassword,
  updateTechnicianStatus,
  deleteTechnician,
  ensureLinkedDeliveryTechnician,
};
