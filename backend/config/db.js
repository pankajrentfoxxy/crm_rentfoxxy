const { Pool } = require('pg');
require('dotenv').config();

function resolveDbHost(raw) {
  const host = String(raw || '').trim();
  // Windows + Docker: "localhost" often resolves to ::1 while Postgres is bound on IPv4 only.
  if (host.toLowerCase() === 'localhost') return '127.0.0.1';
  return host;
}

const dbHost = resolveDbHost(process.env.DB_HOST);
const dbTarget = `${dbHost} ${process.env.DATABASE_URL || ''}`;
if (/rlwy\.net|railway\.(internal|app)/i.test(dbTarget) && process.env.ALLOW_REMOTE_DB !== 'true') {
  throw new Error(
    'Refusing Railway DB. Local Docker only (127.0.0.1:5433 / rentfoxxy_prod_copy). Set ALLOW_REMOTE_DB=true only if you really mean it.'
  );
}

// SSL: disabled for localhost / Docker postgres. For remote hostnames, SSL defaults ON
// unless DB_SSL=false (typical VPS Postgres without TLS). Managed DBs often need ssl on.
const hostLower = dbHost.toLowerCase();
const sslDisabledHosts = new Set(['postgres', '127.0.0.1']);
const useSsl = !sslDisabledHosts.has(hostLower) &&
  process.env.DB_SSL !== 'false' &&
  process.env.DB_SSL !== '0';
const pool = new Pool({
  host: dbHost,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
});

module.exports = pool;