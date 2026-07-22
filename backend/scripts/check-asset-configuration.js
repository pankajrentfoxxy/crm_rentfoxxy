/**
 * Compare CRM asset configuration counts (Settings → Asset Configuration).
 * Optionally compare against ERP MySQL attributes when ERP_MYSQL_* is set.
 *
 * Usage: node scripts/check-asset-configuration.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { loadFromSqlDump } = require('./lib/erpSqlDumpSource');

const DEFAULT_SQL_DUMP = path.join(__dirname, '../../erp_rentfoxxy_db.sql');

const TABLES = [
  ['brands', 'asset_config_brands'],
  ['models', 'asset_config_models'],
  ['processors', 'asset_config_processors'],
  ['generations', 'asset_config_generations'],
  ['ram', 'asset_config_ram'],
  ['storage', 'asset_config_storage'],
  ['gpu', 'asset_config_gpu'],
  ['screen_sizes', 'asset_config_screen_sizes'],
];

async function crmCounts() {
  const out = {};
  for (const [label, table] of TABLES) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE deleted_at IS NULL`
    );
    out[label] = r.rows[0].n;
  }
  return out;
}

async function erpCountsFromSql() {
  const sqlPath = process.argv.includes('--from-sql')
    ? process.argv[process.argv.indexOf('--from-sql') + 1]
    : (fs.existsSync(DEFAULT_SQL_DUMP) ? DEFAULT_SQL_DUMP : null);
  if (!sqlPath || !fs.existsSync(sqlPath)) return null;
  const source = loadFromSqlDump(sqlPath);
  const attrMap = {};
  for (const row of source.attributes) {
    const key = String(row.name || '').trim().toLowerCase();
    attrMap[key] = parseJsonArray(row.attributes).length;
  }
  return {
    brands: source.brands.length,
    model: attrMap.model || 0,
    generation: attrMap.generation || 0,
    processor: attrMap.processor || 0,
    ram: attrMap.ram || 0,
    storage: attrMap.storage || 0,
    gpu: attrMap.gpu || 0,
    screen_size: attrMap['screen size'] || 0,
    brand_model_pairs: source.brandModels.length,
    proc_gen_pairs: source.procGens.length,
  };
}

function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  let s = String(raw || '').trim()
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"');
  try { return JSON.parse(s); } catch { return []; }
}
async function erpCountsMysql() {
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch {
    return null;
  }
  const host = process.env.ERP_MYSQL_HOST;
  if (!host) return null;

  const conn = await mysql.createConnection({
    host,
    port: parseInt(process.env.ERP_MYSQL_PORT || '3306', 10),
    user: process.env.ERP_MYSQL_USER,
    password: process.env.ERP_MYSQL_PASSWORD || '',
    database: process.env.ERP_MYSQL_DATABASE,
  });

  try {
    const [attrs] = await conn.query(`SELECT name, attributes FROM attributes WHERE status = 1`);
    const [brands] = await conn.query(`SELECT COUNT(*) AS n FROM brands WHERE status = 1`);
    const map = {};
    for (const row of attrs) {
      const key = String(row.name || '').trim().toLowerCase();
      let vals = row.attributes;
      if (typeof vals === 'string') {
        try { vals = JSON.parse(vals.replace(/^\s*"\s*|\s*"\s*$/g, '')); } catch { vals = []; }
      }
      map[key] = Array.isArray(vals) ? vals.length : 0;
    }
    return {
      brands: brands[0]?.n || 0,
      model: map.model || 0,
      generation: map.generation || 0,
      processor: map.processor || 0,
      ram: map.ram || 0,
      storage: map.storage || 0,
      gpu: map.gpu || 0,
      screen_size: map['screen size'] || 0,
    };
  } finally {
    await conn.end();
  }
}

async function erpCounts() {
  return erpCountsFromSql() || erpCountsMysql();
}

async function main() {
  const crm = await crmCounts();
  console.log('CRM asset configuration (active rows):');
  console.table(crm);

  const erp = await erpCounts();
  if (erp) {
    console.log('\nERP attribute-management (list sizes — models/generations also need parent mapping in CRM):');
    console.table(erp);
  } else {
    console.log('\nERP counts skipped (place erp_rentfoxxy_db.sql in project root or set ERP_MYSQL_*).');
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e.message);
    pool.end().catch(() => {});
    process.exit(1);
  });
