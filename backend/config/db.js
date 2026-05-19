const { Pool } = require('pg');
require('dotenv').config();

// SSL: disabled for localhost / Docker postgres. For remote hostnames, SSL defaults ON
// unless DB_SSL=false (typical VPS Postgres without TLS). Managed DBs often need ssl on.
const hostLower = String(process.env.DB_HOST || '').toLowerCase();
const sslDisabledHosts = new Set(['postgres', 'localhost', '127.0.0.1']);
const useSsl = !sslDisabledHosts.has(hostLower) &&
  process.env.DB_SSL !== 'false' &&
  process.env.DB_SSL !== '0';
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  // Pooler-specific settings
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
});

module.exports = pool;