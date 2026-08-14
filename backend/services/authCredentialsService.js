'use strict';

const pool = require('../config/db');

/**
 * Upsert a row in auth_credentials (single email → one portal).
 */
async function upsertCredential({ email, passwordHash, portal, entityId, enabled = true }, client = pool) {
  const trimmed = String(email || '').trim();
  if (!trimmed || !passwordHash || !portal || entityId == null) return null;

  const r = await client.query(
    `INSERT INTO auth_credentials (email, password_hash, portal, entity_id, enabled, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (email_lower) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       portal = EXCLUDED.portal,
       entity_id = EXCLUDED.entity_id,
       enabled = EXCLUDED.enabled,
       email = EXCLUDED.email,
       updated_at = NOW()
     RETURNING *`,
    [trimmed, passwordHash, portal, entityId, enabled !== false]
  );
  return r.rows[0] || null;
}

async function setEnabledByEntity(portal, entityId, enabled, client = pool) {
  await client.query(
    `UPDATE auth_credentials
        SET enabled = $3, updated_at = NOW()
      WHERE portal = $1 AND entity_id = $2`,
    [portal, entityId, !!enabled]
  );
}

async function findByEmail(email, client = pool) {
  const r = await client.query(
    `SELECT * FROM auth_credentials
      WHERE email_lower = LOWER(TRIM($1))
      LIMIT 1`,
    [email]
  );
  return r.rows[0] || null;
}

async function lookupEntityCredential(email, client = pool) {
  const crm = await client.query(
    `SELECT user_id AS entity_id, email, password_hash, active AS enabled
       FROM users
      WHERE LOWER(email) = LOWER(TRIM($1)) AND password_hash IS NOT NULL
      LIMIT 1`,
    [email]
  );
  if (crm.rows[0]) {
    return {
      email: crm.rows[0].email,
      password_hash: crm.rows[0].password_hash,
      portal: 'crm',
      entity_id: crm.rows[0].entity_id,
      enabled: crm.rows[0].enabled !== false,
    };
  }

  const vendor = await client.query(
    `SELECT vendor_id AS entity_id, email,
            COALESCE(vendor_portal_password_hash, password_hash) AS password_hash,
            (deleted_at IS NULL AND COALESCE(vendor_portal_enabled, true)) AS enabled
       FROM vendors
      WHERE LOWER(email) = LOWER(TRIM($1))
        AND deleted_at IS NULL
        AND COALESCE(vendor_portal_password_hash, password_hash) IS NOT NULL
      LIMIT 1`,
    [email]
  );
  if (vendor.rows[0]) {
    return {
      email: vendor.rows[0].email,
      password_hash: vendor.rows[0].password_hash,
      portal: 'vendor',
      entity_id: vendor.rows[0].entity_id,
      enabled: vendor.rows[0].enabled !== false,
    };
  }

  const customer = await client.query(
    `SELECT customer_id AS entity_id, email, portal_password_hash AS password_hash,
            COALESCE(portal_enabled, false) AS enabled
       FROM customers
      WHERE LOWER(email) = LOWER(TRIM($1))
        AND portal_password_hash IS NOT NULL
      LIMIT 1`,
    [email]
  );
  if (customer.rows[0]) {
    return {
      email: customer.rows[0].email,
      password_hash: customer.rows[0].password_hash,
      portal: 'customer',
      entity_id: customer.rows[0].entity_id,
      enabled: customer.rows[0].enabled === true,
    };
  }

  return null;
}

/**
 * Resolve credential for email from auth_credentials, self-healing from entity tables.
 * Priority when email collides: crm > vendor > customer.
 */
async function ensureCredentialForEmail(email, client = pool) {
  try {
    const existing = await findByEmail(email, client);
    if (existing) return existing;
  } catch (err) {
    // Table not migrated yet — fall back to entity tables only
    if (err.code === '42P01') {
      return lookupEntityCredential(email, client);
    }
    throw err;
  }

  const fromEntity = await lookupEntityCredential(email, client);
  if (!fromEntity) return null;

  try {
    return await upsertCredential({
      email: fromEntity.email,
      passwordHash: fromEntity.password_hash,
      portal: fromEntity.portal,
      entityId: fromEntity.entity_id,
      enabled: fromEntity.enabled,
    }, client);
  } catch (err) {
    if (err.code === '42P01') return fromEntity;
    throw err;
  }
}

module.exports = {
  upsertCredential,
  setEnabledByEntity,
  findByEmail,
  ensureCredentialForEmail,
};
