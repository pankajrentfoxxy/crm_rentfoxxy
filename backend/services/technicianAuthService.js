const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { formatTechnician } = require('./deliveryTechnicianService');

function buildTechnicianToken(technician, extra = {}) {
  return jwt.sign(
    {
      auth_type: 'technician',
      technician_id: technician.technician_id,
      user_id: technician.user_id || null,
      email: technician.email,
      first_name: technician.first_name,
      last_name: technician.last_name,
      ...extra,
    },
    process.env.JWT_SECRET,
    { expiresIn: extra.technician_impersonation ? '8h' : '30d' }
  );
}

async function loginTechnician(email, password) {
  const r = await pool.query(
    `SELECT * FROM delivery_technicians WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  if (!r.rows.length) {
    return { ok: false, status: 401, message: 'Invalid credentials' };
  }

  const row = r.rows[0];
  if (!row.is_active) {
    return { ok: false, status: 403, message: 'This technician account is inactive or suspended.' };
  }
  if (!row.password_hash) {
    return { ok: false, status: 403, message: 'Password not set for this account. Contact admin.' };
  }

  const match = await bcrypt.compare(password, row.password_hash);
  if (!match) {
    return { ok: false, status: 401, message: 'Invalid credentials' };
  }

  const technician = formatTechnician(row);
  const token = buildTechnicianToken(technician);
  return { ok: true, token, technician };
}

async function loginAsTechnician({ technicianId, technicianEmail, impersonatedByUserId }) {
  const r = await pool.query(
    `SELECT * FROM delivery_technicians
     WHERE technician_id = $1 AND LOWER(email) = LOWER($2)`,
    [technicianId, technicianEmail]
  );
  if (!r.rows.length) {
    return { ok: false, status: 400, message: 'Invalid technician ID or email.' };
  }

  const row = r.rows[0];
  if (!row.is_active) {
    return { ok: false, status: 400, message: 'This technician account is inactive or suspended.' };
  }

  const technician = formatTechnician(row);
  const token = buildTechnicianToken(technician, {
    technician_impersonation: true,
    impersonated_by_user_id: impersonatedByUserId || null,
  });

  return { ok: true, token, technician };
}

async function getTechnicianProfile(technicianId) {
  const r = await pool.query(
    `SELECT * FROM delivery_technicians WHERE technician_id = $1`,
    [technicianId]
  );
  if (!r.rows.length) return null;
  return formatTechnician(r.rows[0]);
}

async function getTechnicianDashboard(technicianId, userId) {
  if (!userId && !technicianId) {
    return { pending_count: 0, upcoming_count: 0, deliveries: [] };
  }

  // Same rules as My Deliveries (GET /my-deliveries): a challan is assigned by
  // technician_id (current flow) or user_id (older rows). It used to match only
  // user_id and only status 'pending', which no current challan ever has, so
  // the portal always said "no deliveries".
  const linesR = await pool.query(
    `SELECT DISTINCT ON (dc_number)
       dc_number, customer_name, email, status, ship_by, dispatch_mode, courier_name, awb_number,
       dispatched_at, reached_at, created_at, rejected_at, return_to_warehouse_at
     FROM delivery_challan_lines
     WHERE (delivery_person_id = $1 OR delivery_person_id = $2)
       AND COALESCE(movement_type, 'outbound') = 'outbound'
       AND (
         status IN ('dispatch_ready', 'in_transit', 'shipped', 'reached')
         OR (status = 'rejected' AND return_to_warehouse_at IS NULL)
       )
     ORDER BY dc_number, id DESC
     LIMIT 100`,
    [technicianId || -1, userId || -1]
  );

  const active = linesR.rows.filter((r) => ['in_transit', 'shipped', 'reached', 'rejected'].includes(r.status));
  const upcoming = linesR.rows.filter((r) => r.status === 'dispatch_ready');
  return {
    pending_count: active.length,
    upcoming_count: upcoming.length,
    // Out for delivery first, then refused ones to bring back, then upcoming.
    deliveries: [...active, ...upcoming],
  };
}

module.exports = {
  buildTechnicianToken,
  loginTechnician,
  loginAsTechnician,
  getTechnicianProfile,
  getTechnicianDashboard,
};
