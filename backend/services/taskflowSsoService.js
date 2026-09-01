const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const pool = require('../config/db');

const ISSUER = process.env.TASKFLOW_SSO_ISSUER || 'rentfoxxy-crm';
const AUDIENCE = process.env.TASKFLOW_SSO_AUDIENCE || 'taskflow';
const SSO_EXPIRES = process.env.TASKFLOW_SSO_EXPIRES || '3m';
const COUNT_EXPIRES = process.env.TASKFLOW_COUNT_EXPIRES || '60s';

function ssoSecret() {
  const secret = String(process.env.TASKFLOW_SSO_SECRET || '').trim();
  if (!secret) {
    const err = new Error('TASKFLOW_SSO_SECRET is not configured');
    err.status = 503;
    throw err;
  }
  return secret;
}

function taskflowPublicUrl() {
  return String(process.env.TASKFLOW_PUBLIC_URL || process.env.TASKFLOW_URL || 'https://task.rentfoxxy.com')
    .trim()
    .replace(/\/+$/, '');
}

function taskflowApiUrl() {
  const fromEnv = String(process.env.TASKFLOW_API_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  return `${taskflowPublicUrl()}/api`;
}

async function loadCrmUser(reqUser) {
  const userId = Number(reqUser?.user_id);
  if (!Number.isFinite(userId) || userId <= 0) {
    const err = new Error('CRM user is not valid for TaskFlow SSO');
    err.status = 401;
    throw err;
  }
  const result = await pool.query(
    `SELECT user_id, name, email, role, status
     FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row?.email) {
    const err = new Error('CRM user email is missing');
    err.status = 400;
    throw err;
  }
  if (row.status && row.status !== 'active') {
    const err = new Error('CRM account is not active');
    err.status = 403;
    throw err;
  }
  return row;
}

function signCrmTaskflowToken(user, purpose, expiresIn) {
  return jwt.sign(
    {
      email: String(user.email).toLowerCase().trim(),
      user_id: String(user.user_id),
      name: user.name || '',
      purpose,
    },
    ssoSecret(),
    {
      expiresIn,
      issuer: ISSUER,
      audience: AUDIENCE,
      jwtid: crypto.randomUUID(),
    }
  );
}

async function buildSsoRedirectUrl(reqUser) {
  const user = await loadCrmUser(reqUser);
  const token = signCrmTaskflowToken(user, 'crm_sso', SSO_EXPIRES);
  return `${taskflowPublicUrl()}/api/auth/sso?token=${encodeURIComponent(token)}`;
}

async function fetchPendingCount(reqUser) {
  const user = await loadCrmUser(reqUser);
  const token = signCrmTaskflowToken(user, 'crm_pending_count', COUNT_EXPIRES);
  try {
    const { data } = await axios.get(`${taskflowApiUrl()}/auth/crm/pending-count`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      timeout: 8000,
      validateStatus: (s) => s >= 200 && s < 500,
    });
    if (!data || data.success === false) {
      return { count: 0, mapped: false };
    }
    return {
      count: Number(data.count || 0),
      mapped: data.mapped !== false,
    };
  } catch (err) {
    console.warn('TaskFlow pending count failed:', err.message);
    return { count: 0, mapped: false };
  }
}

module.exports = {
  buildSsoRedirectUrl,
  fetchPendingCount,
  taskflowPublicUrl,
};
