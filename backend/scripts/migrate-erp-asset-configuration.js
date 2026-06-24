/**
 * Migrate ERP admin/attribute-management → CRM Settings → Asset Configuration.
 *
 * ERP source:
 *   - attributes table (Model, Generation, Processor, RAM, Storage, GPU, Screen size)
 *   - brands table
 *   - sales_orders (brand + model_name, processor + generation pairs)
 *
 * CRM target:
 *   asset_config_brands, asset_config_models, asset_config_processors,
 *   asset_config_generations, asset_config_ram, asset_config_storage,
 *   asset_config_gpu, asset_config_screen_sizes
 *
 * Usage (from backend/):
 *   node scripts/migrate-erp-asset-configuration.js
 *   node scripts/migrate-erp-asset-configuration.js --from-sql ../erp_rentfoxxy_db.sql
 *   node scripts/migrate-erp-asset-configuration.js --dry-run
 *
 * Source priority: --from-json → --from-sql → ../erp_rentfoxxy_db.sql → ERP MySQL (.env)
 *
 * CRM Postgres uses DB_* from .env (same as the app).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { loadFromSqlDump } = require('./lib/erpSqlDumpSource');
const {
  normalizeBrand,
  normalizeModel,
  normalizeGeneration,
  normalizeRam,
  normalizeStorage,
  normalizeProcessor,
  normalizeGpu,
  normalizeScreenSize,
} = require('../utils/assetConfigNormalize');

const DRY_RUN = process.argv.includes('--dry-run');
const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};
const FROM_JSON = argValue('--from-json');
const FROM_SQL = argValue('--from-sql');
const DEFAULT_SQL_DUMP = path.join(__dirname, '../../erp_rentfoxxy_db.sql');

const OTHER_BRAND = 'Other';
const OTHER_PROCESSOR = 'Other';

/** ERP attribute row name → CRM handler */
const SIMPLE_ATTR_KEYS = {
  processor: 'asset_config_processors',
  ram: 'asset_config_ram',
  storage: 'asset_config_storage',
  gpu: 'asset_config_gpu',
  'screen size': 'asset_config_screen_sizes',
};

function norm(s) {
  return String(s || '').trim();
}

function normKey(s) {
  return norm(s).toLowerCase();
}

function decodeJsonField(s) {
  return String(s)
    .trim()
    .replace(/^\s*"\s*|\s*"\s*$/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw.map(norm).filter(Boolean);
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(decodeJsonField(raw));
    return Array.isArray(parsed) ? parsed.map(norm).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const SIMPLE_STAT_KEYS = {
  processor: 'processors',
  ram: 'ram',
  storage: 'storage',
  gpu: 'gpu',
  'screen size': 'screen_sizes',
};

/** Mirror ERP AttributeManagementController@getData */
function buildAttributeMap(attributeRows) {
  const map = {};
  for (const row of attributeRows) {
    const key = normKey(row.name);
    map[key] = parseJsonArray(row.attributes);
  }
  return map;
}

async function createErpConnection() {
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch {
    throw new Error('mysql2 is required for ERP MySQL. Run: npm install mysql2');
  }

  const host = process.env.ERP_MYSQL_HOST;
  const user = process.env.ERP_MYSQL_USER;
  const password = process.env.ERP_MYSQL_PASSWORD;
  const database = process.env.ERP_MYSQL_DATABASE;
  if (!host || !user || !database) {
    throw new Error('Set ERP_MYSQL_HOST, ERP_MYSQL_USER, ERP_MYSQL_PASSWORD, ERP_MYSQL_DATABASE in .env');
  }

  return mysql.createConnection({
    host,
    port: parseInt(process.env.ERP_MYSQL_PORT || '3306', 10),
    user,
    password: password || '',
    database,
    connectTimeout: 15000,
  });
}

async function fetchFromErpMysql() {
  const conn = await createErpConnection();
  try {
    const [attributes] = await conn.query(
      `SELECT name, attributes FROM attributes WHERE status = 1`
    );
    const [brands] = await conn.query(
      `SELECT name FROM brands WHERE status = 1`
    );
    const [brandModels] = await conn.query(`
      SELECT DISTINCT TRIM(brand) AS brand, TRIM(model_name) AS model
        FROM sales_orders
       WHERE TRIM(COALESCE(brand, '')) <> ''
         AND TRIM(COALESCE(model_name, '')) <> ''
    `);
    const [procGens] = await conn.query(`
      SELECT DISTINCT TRIM(processor) AS processor, TRIM(generation) AS generation
        FROM sales_orders
       WHERE TRIM(COALESCE(processor, '')) <> ''
         AND TRIM(COALESCE(generation, '')) <> ''
    `);
    return {
      attributes,
      brands: brands.map((r) => norm(r.name)).filter(Boolean),
      brandModels: brandModels
        .map((r) => ({ brand: norm(r.brand), model: norm(r.model) }))
        .filter((r) => r.brand && r.model),
      procGens: procGens
        .map((r) => ({ processor: norm(r.processor), generation: norm(r.generation) }))
        .filter((r) => r.processor && r.generation),
    };
  } finally {
    await conn.end();
  }
}

function loadFromJson(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return {
    attributes: raw.attributes || [],
    brands: (raw.brands || []).map(norm).filter(Boolean),
    brandModels: (raw.brandModels || []).map((r) => ({
      brand: norm(r.brand),
      model: norm(r.model),
    })).filter((r) => r.brand && r.model),
    procGens: (raw.procGens || []).map((r) => ({
      processor: norm(r.processor),
      generation: norm(r.generation),
    })).filter((r) => r.processor && r.generation),
  };
}

async function ensureBrand(client, name) {
  const n = normalizeBrand(name);
  if (!n) return null;
  const existing = await client.query(
    `SELECT id FROM asset_config_brands
      WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER($1) LIMIT 1`,
    [n]
  );
  if (existing.rows.length) return existing.rows[0].id;
  if (DRY_RUN) return -1;
  const ins = await client.query(
    `INSERT INTO asset_config_brands (name) VALUES ($1) RETURNING id`,
    [n]
  );
  return ins.rows[0].id;
}

async function ensureModel(client, brandName, modelName) {
  const brand = normalizeBrand(brandName);
  const model = normalizeModel(modelName, brand);
  if (!brand || !model) return { inserted: false, skipped: true };
  const brandId = await ensureBrand(client, brand);
  if (brandId == null) return { inserted: false, skipped: true };
  if (DRY_RUN) return { inserted: true, skipped: false };

  const existing = await client.query(
    `SELECT id FROM asset_config_models
      WHERE deleted_at IS NULL AND brand_id = $1 AND LOWER(TRIM(name)) = LOWER($2) LIMIT 1`,
    [brandId, model]
  );
  if (existing.rows.length) return { inserted: false, skipped: false };
  await client.query(
    `INSERT INTO asset_config_models (brand_id, name) VALUES ($1, $2)`,
    [brandId, model]
  );
  return { inserted: true, skipped: false };
}

async function ensureProcessor(client, name) {
  const n = normalizeProcessor(name);
  if (!n) return null;
  const existing = await client.query(
    `SELECT id FROM asset_config_processors
      WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER($1) LIMIT 1`,
    [n]
  );
  if (existing.rows.length) return existing.rows[0].id;
  if (DRY_RUN) return -1;
  const ins = await client.query(
    `INSERT INTO asset_config_processors (name) VALUES ($1) RETURNING id`,
    [n]
  );
  return ins.rows[0].id;
}

async function ensureGeneration(client, processorName, genName) {
  const proc = normalizeProcessor(processorName);
  const gen = normalizeGeneration(genName);
  if (!proc || !gen) return { inserted: false, skipped: true };
  const procId = await ensureProcessor(client, proc);
  if (procId == null) return { inserted: false, skipped: true };
  if (DRY_RUN) return { inserted: true, skipped: false };

  const existing = await client.query(
    `SELECT id FROM asset_config_generations
      WHERE deleted_at IS NULL AND processor_id = $1 AND LOWER(TRIM(name)) = LOWER($2) LIMIT 1`,
    [procId, gen]
  );
  if (existing.rows.length) return { inserted: false, skipped: false };
  await client.query(
    `INSERT INTO asset_config_generations (processor_id, name) VALUES ($1, $2)`,
    [procId, gen]
  );
  return { inserted: true, skipped: false };
}

async function ensureSimple(client, table, name) {
  let n = norm(name);
  if (table === 'asset_config_ram') n = normalizeRam(n);
  else if (table === 'asset_config_storage') n = normalizeStorage(n);
  else if (table === 'asset_config_gpu') n = normalizeGpu(n);
  else if (table === 'asset_config_screen_sizes') n = normalizeScreenSize(n);
  else if (table === 'asset_config_processors') n = normalizeProcessor(n);
  if (!n) return { inserted: false, skipped: true };
  const existing = await client.query(
    `SELECT id FROM ${table}
      WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER($1) LIMIT 1`,
    [n]
  );
  if (existing.rows.length) return { inserted: false, skipped: false };
  if (DRY_RUN) return { inserted: true, skipped: false };
  await client.query(`INSERT INTO ${table} (name) VALUES ($1)`, [n]);
  return { inserted: true, skipped: false };
}

async function loadCrmBrandModelPairs(client) {
  const direct = await client.query(`
    SELECT DISTINCT TRIM(brand) AS brand, TRIM(model) AS model
      FROM vendor_product_details
     WHERE COALESCE(TRIM(brand), '') <> '' AND COALESCE(TRIM(model), '') <> ''
  `).catch(() => ({ rows: [] }));

  return direct.rows.map((row) => ({ brand: norm(row.brand), model: norm(row.model) }));
}

async function migrate(source) {
  const attrMap = buildAttributeMap(source.attributes);
  const stats = {
    brands: { inserted: 0, total: 0 },
    models: { inserted: 0, mapped: 0, orphan: 0 },
    processors: { inserted: 0, total: 0 },
    generations: { inserted: 0, mapped: 0, orphan: 0 },
    ram: { inserted: 0, total: 0 },
    storage: { inserted: 0, total: 0 },
    gpu: { inserted: 0, total: 0 },
    screen_sizes: { inserted: 0, total: 0 },
  };

  const client = await pool.connect();
  try {
    if (!DRY_RUN) await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 1) Brands from ERP brands table
    const brandNames = new Set(source.brands);
    for (const b of brandNames) {
      stats.brands.total += 1;
      const before = await client.query(
        `SELECT id FROM asset_config_brands WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER($1)`,
        [b]
      );
      await ensureBrand(client, b);
      if (!before.rows.length && !DRY_RUN) stats.brands.inserted += 1;
      else if (!before.rows.length && DRY_RUN) stats.brands.inserted += 1;
    }
    await ensureBrand(client, OTHER_BRAND);

    // 2) Simple attribute lists
    for (const [key, table] of Object.entries(SIMPLE_ATTR_KEYS)) {
      const values = attrMap[key] || [];
      const statKey = SIMPLE_STAT_KEYS[key] || key;
      stats[statKey].total = values.length;
      for (const v of values) {
        const r = await ensureSimple(client, table, v);
        if (r.inserted) stats[statKey].inserted += 1;
      }
    }

    // 3) Brand → Model from sales_orders + vendor_product_details
    const modelPairs = new Map();
    for (const row of [...source.brandModels, ...(await loadCrmBrandModelPairs(client))]) {
      modelPairs.set(`${normKey(row.brand)}|${normKey(row.model)}`, row);
    }

    for (const pair of modelPairs.values()) {
      stats.models.mapped += 1;
      const r = await ensureModel(client, pair.brand, pair.model);
      if (r.inserted) stats.models.inserted += 1;
    }

    // Orphan models from ERP Model attribute (no brand) → Other
    const erpModels = attrMap.model || [];
    for (const model of erpModels) {
      const hasPair = [...modelPairs.values()].some((p) => normKey(p.model) === normKey(model));
      if (hasPair) continue;
      stats.models.orphan += 1;
      const r = await ensureModel(client, OTHER_BRAND, model);
      if (r.inserted) stats.models.inserted += 1;
    }

    // 4) Processor → Generation from sales_orders
    const genPairs = new Map();
    for (const row of source.procGens) {
      genPairs.set(`${normKey(row.processor)}|${normKey(row.generation)}`, row);
    }
    for (const pair of genPairs.values()) {
      stats.generations.mapped += 1;
      const r = await ensureGeneration(client, pair.processor, pair.generation);
      if (r.inserted) stats.generations.inserted += 1;
    }

    // Orphan generations from ERP → Other processor
    await ensureProcessor(client, OTHER_PROCESSOR);
    const erpGens = attrMap.generation || [];
    stats.generations.total = erpGens.length;
    for (const gen of erpGens) {
      const hasPair = [...genPairs.values()].some((p) => normKey(p.generation) === normKey(gen));
      if (hasPair) continue;
      stats.generations.orphan += 1;
      const r = await ensureGeneration(client, OTHER_PROCESSOR, gen);
      if (r.inserted) stats.generations.inserted += 1;
    }

    stats.processors.total = (attrMap.processor || []).length;
    for (const p of attrMap.processor || []) {
      const before = await client.query(
        `SELECT id FROM asset_config_processors WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER($1)`,
        [p]
      );
      await ensureProcessor(client, p);
      if (!before.rows.length) stats.processors.inserted += 1;
    }

    if (!DRY_RUN) {
      await client.query(
        `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        ['migrate-erp-asset-configuration.js']
      );
      await client.query('COMMIT');
    }

    return stats;
  } catch (e) {
    if (!DRY_RUN) await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  console.log('ERP attribute-management → CRM asset configuration');
  if (DRY_RUN) console.log('DRY RUN — no CRM writes');

  let source;
  if (FROM_JSON) {
    console.log('Loading from JSON:', FROM_JSON);
    source = loadFromJson(FROM_JSON);
  } else {
    const sqlPath = FROM_SQL
      ? path.isAbsolute(FROM_SQL) ? FROM_SQL : path.join(process.cwd(), FROM_SQL)
      : (fs.existsSync(DEFAULT_SQL_DUMP) ? DEFAULT_SQL_DUMP : null);

    if (sqlPath) {
      console.log('Loading from SQL dump:', sqlPath);
      source = loadFromSqlDump(sqlPath);
    } else {
      console.log('Fetching from ERP MySQL…');
      source = await fetchFromErpMysql();
    }
  }

  const attrMap = buildAttributeMap(source.attributes);
  console.log('ERP attribute counts:', {
    model: (attrMap.model || []).length,
    generation: (attrMap.generation || []).length,
    processor: (attrMap.processor || []).length,
    ram: (attrMap.ram || []).length,
    storage: (attrMap.storage || []).length,
    gpu: (attrMap.gpu || []).length,
    'screen size': (attrMap['screen size'] || []).length,
    brands: source.brands.length,
    brandModelPairs: source.brandModels.length,
    procGenPairs: source.procGens.length,
  });

  const stats = await migrate(source);
  console.log('\nMigration complete:', JSON.stringify(stats, null, 2));
  console.log('\nVerify in CRM: Settings → Asset Configuration');
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('FAILED:', e.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
