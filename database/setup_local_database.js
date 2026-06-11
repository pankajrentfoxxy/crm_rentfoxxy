/**
 * Create local PostgreSQL CRM database for DBeaver + local API testing.
 *
 * 1. Creates database rentfoxxy_crm_local (use --recreate to drop first)
 * 2. Applies backend/master_setup.sql + backend/migrations/*.sql
 * 3. Applies database/phase1_schema_patch.sql (vendor portal / PO workflow)
 * 4. Seeds admin user
 *
 * schema.sql at repo root is the full production DDL reference (updated with Phase 1).
 * This script builds a working local DB without Supabase-only objects from that dump.
 *
 * Usage:
 *   node database/setup_local_database.js
 *   node database/setup_local_database.js --recreate
 */
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '../backend/node_modules/pg'));
const bcrypt = require(path.join(__dirname, '../backend/node_modules/bcryptjs'));

function loadEnvFile() {
  const envPath = path.join(__dirname, '../backend/.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    const val = t.slice(i + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile();

function parseDatabaseUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, '') || 'railway'
    };
  } catch {
    return null;
  }
}

const fromUrl = parseDatabaseUrl(process.env.DATABASE_URL);
const DB_HOST = fromUrl?.host || process.env.DB_HOST || '127.0.0.1';
const DB_PORT = fromUrl?.port || Number(process.env.DB_PORT || 5432);
const DB_USER = fromUrl?.user || process.env.DB_USER || 'rentfoxxyb2b';
const DB_PASSWORD = fromUrl?.password || process.env.DB_PASSWORD || '';
const TARGET_DB =
  fromUrl?.database ||
  process.env.DB_NAME ||
  process.env.LOCAL_DB_NAME ||
  'rentfoxxy_crm_local';

const RAILWAY_MODE = process.argv.includes('--railway');

function pgSsl() {
  const hostLower = String(DB_HOST || '').toLowerCase();
  const local = new Set(['postgres', 'localhost', '127.0.0.1']);
  const useSsl =
    RAILWAY_MODE ||
    (!local.has(hostLower) && process.env.DB_SSL !== 'false' && process.env.DB_SSL !== '0');
  return useSsl ? { rejectUnauthorized: false } : false;
}

function pgClientConfig(database) {
  return {
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database,
    ssl: pgSsl()
  };
}

const BACKEND = path.join(__dirname, '../backend');
const MIGRATIONS = path.join(BACKEND, 'migrations');

async function ensureDatabase(admin, recreate) {
  if (recreate) {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TARGET_DB]
    ).catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${TARGET_DB}"`);
    console.log(`Dropped database "${TARGET_DB}" (if existed)`);
  }
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TARGET_DB]);
  if (!exists.rows.length) {
    await admin.query(`CREATE DATABASE "${TARGET_DB}"`);
    console.log(`Created database "${TARGET_DB}"`);
  } else {
    console.log(`Using existing database "${TARGET_DB}"`);
  }
}

async function runSqlFile(client, filePath, label) {
  const sql = fs.readFileSync(filePath, 'utf8');
  try {
    await client.query(sql);
    console.log('OK:', label);
    return true;
  } catch (err) {
    console.warn('WARN:', label, '-', err.message.split('\n')[0]);
    return false;
  }
}

async function bootstrapSchema(client) {
  await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await runSqlFile(client, path.join(BACKEND, 'master_setup.sql'), 'master_setup.sql');

  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();

  let ok = 0;
  let warn = 0;
  for (const file of files) {
    const okOne = await runSqlFile(client, path.join(MIGRATIONS, file), file);
    if (okOne) {
      ok += 1;
      await client.query(
        'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [file]
      ).catch(() => {});
    } else {
      warn += 1;
    }
  }
  console.log(`Migrations: ${ok} ok, ${warn} warnings`);
}

async function seedAdmin(client) {
  const hash = await bcrypt.hash('admin123', 10);
  try {
    await client.query(
      `INSERT INTO users (name, email, password_hash, role, active, status, user_type)
       VALUES ('Admin User', 'admin@rentfoxxy.com', $1, 'admin', true, 'active', 'internal')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', active = true`,
      [hash]
    );
  } catch {
    await client.query(
      `INSERT INTO users (name, email, password_hash, role, active)
       SELECT 'Admin User', 'admin@rentfoxxy.com', $1, 'admin', true
       WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@rentfoxxy.com')`,
      [hash]
    );
  }
  console.log('Admin: admin@rentfoxxy.com / admin123');
}

async function printSummary(client) {
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log(`\nPublic tables (${tables.rows.length}):`);
  const vendor = tables.rows.filter((r) => r.table_name.startsWith('vendor'));
  vendor.forEach((r) => console.log('  -', r.table_name));
  if (vendor.length < tables.rows.length) {
    console.log(`  ... and ${tables.rows.length - vendor.length} other CRM tables`);
  }
}

async function main() {
  const recreate = process.argv.includes('--recreate') && !RAILWAY_MODE;

  if (RAILWAY_MODE) {
    console.log('Railway mode: using existing database (no CREATE/DROP).');
    console.log(`Target: ${DB_HOST}:${DB_PORT}/${TARGET_DB}`);
  } else {
    const admin = new Client(pgClientConfig('postgres'));
    await admin.connect();
    await ensureDatabase(admin, recreate);
    await admin.end();
  }

  const client = new Client(pgClientConfig(TARGET_DB));
  await client.connect();

  console.log('\nBootstrapping CRM schema…');
  await bootstrapSchema(client);

  console.log('\nApplying Phase 1 vendor patch…');
  await runSqlFile(client, path.join(__dirname, 'phase1_schema_patch.sql'), 'phase1_schema_patch.sql');

  await seedAdmin(client);
  await printSummary(client);
  await client.end();

  console.log('\n========== DBeaver ==========');
  console.log('Host:     ', DB_HOST);
  console.log('Port:     ', DB_PORT);
  console.log('Database: ', TARGET_DB);
  console.log('User:     ', DB_USER);
  console.log('Password: ', DB_PASSWORD ? '(from backend/.env)' : '(set DB_PASSWORD)');
  console.log('\nSet in backend/.env:  DB_NAME=' + TARGET_DB);
  console.log('Reference DDL:        schema.sql (+ phase1 appended at end)');
  console.log('Guide:                database/DBeaver_CONNECTION.md');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
