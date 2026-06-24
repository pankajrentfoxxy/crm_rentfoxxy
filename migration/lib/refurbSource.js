/**
 * PostgreSQL source for laptop_refurbishment / revemp_backend backup.
 * Restore laptop_refurbishment_backup.sql into a separate database, then connect via REFURB_* env.
 */
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function parseDatabaseUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const cleaned = url.trim().replace(/^["']|["']$/g, '');
  try {
    const parsed = new URL(cleaned.replace(/^postgresql:/, 'http:'));
    const database = parsed.pathname.replace(/^\//, '').split('?')[0];
    if (!database) return null;
    return {
      host: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port || 5432),
      user: decodeURIComponent(parsed.username || 'postgres'),
      password: decodeURIComponent(parsed.password || ''),
      database,
    };
  } catch {
    return null;
  }
}

function getRefurbConfig() {
  const fromUrl = parseDatabaseUrl(process.env.REFURB_DATABASE_URL);
  return (
    fromUrl || {
      host: process.env.REFURB_PG_HOST || '127.0.0.1',
      port: Number(process.env.REFURB_PG_PORT || 5432),
      user: process.env.REFURB_PG_USER || 'postgres',
      password: process.env.REFURB_PG_PASSWORD || '',
      database: process.env.REFURB_PG_DATABASE || 'laptop_refurbishment',
    }
  );
}

let refurbPool = null;

function getRefurbPool() {
  if (!refurbPool) refurbPool = new Pool(getRefurbConfig());
  return refurbPool;
}

/** MySQL-compatible query wrapper: returns [rows] */
async function query(sql, params = []) {
  const pool = getRefurbPool();
  const r = await pool.query(sql, params);
  return [r.rows];
}

async function closeRefurbPool() {
  if (refurbPool) {
    await refurbPool.end();
    refurbPool = null;
  }
}

async function createRefurbSource() {
  const cfg = getRefurbConfig();
  const pool = getRefurbPool();
  const { rows } = await pool.query('SELECT current_database() AS db');
  return {
    config: cfg,
    database: rows[0]?.db,
    query,
    close: closeRefurbPool,
  };
}

module.exports = {
  getRefurbConfig,
  getRefurbPool,
  createRefurbSource,
  closeRefurbPool,
};
