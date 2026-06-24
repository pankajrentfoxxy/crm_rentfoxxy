/**
 * Clean and standardize CRM asset configuration values.
 * Merges duplicates after normalization (soft-deletes extras).
 *
 * Usage (from backend/):
 *   node scripts/normalize-asset-configuration.js
 *   node scripts/normalize-asset-configuration.js --dry-run
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const {
  normalizeBrand,
  normalizeModel,
  normalizeGeneration,
  normalizeRam,
  normalizeStorage,
  normalizeProcessor,
  normalizeGpu,
  normalizeScreenSize,
  compareKey,
} = require('../utils/assetConfigNormalize');

const DRY_RUN = process.argv.includes('--dry-run');

const stats = {
  updated: 0,
  merged: 0,
  vpdUpdated: 0,
};

/** old canonical key → new display value (for vendor_product_details sync) */
const renameMap = {
  model: new Map(),
  generation: new Map(),
  ram: new Map(),
  storage: new Map(),
  processor: new Map(),
  gpu: new Map(),
  screen_size: new Map(),
  brand: new Map(),
};

const VPD_FIELD = {
  brands: 'brand',
  processors: 'processor',
  ram: 'ram',
  storage: 'storage',
  gpus: 'gpu',
  'screen-sizes': 'screen_size',
};

function trackRename(field, oldName, newName) {
  const o = trim(oldName);
  const n = trim(newName);
  if (!o || !n || o.toLowerCase() === n.toLowerCase()) return;
  if (!renameMap[field]?.has(o.toLowerCase())) {
    renameMap[field].set(o.toLowerCase(), n);
  }
}

function trim(s) {
  return String(s || '').trim();
}

async function mergeSimple(client, table, entityKey, normalizeFn) {
  const { rows } = await client.query(
    `SELECT id, name FROM ${table} WHERE deleted_at IS NULL ORDER BY id`
  );
  const groups = new Map();

  for (const row of rows) {
    const normalized = normalizeFn(row.name);
    const key = compareKey(entityKey, normalized);
    if (!groups.has(key)) {
      groups.set(key, { keeperId: row.id, normalized, dupeIds: [], oldNames: [row.name] });
    } else {
      const g = groups.get(key);
      g.dupeIds.push(row.id);
      g.oldNames.push(row.name);
    }
  }

  for (const g of groups.values()) {
    const vpdField = VPD_FIELD[entityKey];
    for (const old of g.oldNames) {
      if (vpdField) trackRename(vpdField, old, g.normalized);
    }

    if (!DRY_RUN) {
      for (const dupeId of g.dupeIds) {
        await client.query(
          `UPDATE ${table} SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [dupeId]
        );
        stats.merged += 1;
      }
      await client.query(
        `UPDATE ${table} SET name = $2, updated_at = NOW() WHERE id = $1`,
        [g.keeperId, g.normalized]
      );
      stats.updated += 1;
    } else {
      if (g.oldNames.some((n) => n !== g.normalized) || g.dupeIds.length) {
        console.log(`  [${table}] → "${g.normalized}" (keep #${g.keeperId}, merge ${g.dupeIds.length})`);
        stats.updated += 1;
        stats.merged += g.dupeIds.length;
      }
    }
  }
}

async function mergeBrands(client) {
  const { rows } = await client.query(
    `SELECT id, name FROM asset_config_brands WHERE deleted_at IS NULL ORDER BY id`
  );
  const groups = new Map();
  for (const row of rows) {
    const normalized = normalizeBrand(row.name);
    const key = compareKey('brands', normalized);
    if (!groups.has(key)) {
      groups.set(key, { keeperId: row.id, normalized, dupeIds: [], oldNames: [row.name] });
    } else {
      groups.get(key).dupeIds.push(row.id);
      groups.get(key).oldNames.push(row.name);
    }
  }

  for (const g of groups.values()) {
    for (const old of g.oldNames) trackRename('brand', old, g.normalized);

    if (!DRY_RUN) {
      for (const dupeId of g.dupeIds) {
        const { rows: models } = await client.query(
          `SELECT id, name FROM asset_config_models WHERE brand_id = $1 AND deleted_at IS NULL`,
          [dupeId]
        );
        for (const m of models) {
          const newName = normalizeModel(m.name, g.normalized);
          const existing = await client.query(
            `SELECT id FROM asset_config_models
              WHERE brand_id = $1 AND deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER($2) LIMIT 1`,
            [g.keeperId, newName]
          );
          if (existing.rows.length) {
            await client.query(
              `UPDATE asset_config_models SET deleted_at = NOW() WHERE id = $1`, [m.id]
            );
            stats.merged += 1;
          } else {
            trackRename('model', m.name, newName);
            await client.query(
              `UPDATE asset_config_models SET brand_id = $1, name = $2, updated_at = NOW() WHERE id = $3`,
              [g.keeperId, newName, m.id]
            );
          }
        }
        await client.query(
          `UPDATE asset_config_brands SET deleted_at = NOW() WHERE id = $1`, [dupeId]
        );
        stats.merged += 1;
      }
      await client.query(
        `UPDATE asset_config_brands SET name = $2, updated_at = NOW() WHERE id = $1`,
        [g.keeperId, g.normalized]
      );
      stats.updated += 1;
    } else if (g.dupeIds.length || g.oldNames.some((n) => n !== g.normalized)) {
      console.log(`  [brands] "${g.normalized}" (keep #${g.keeperId}, merge brands ${g.dupeIds.length})`);
      stats.updated += 1;
      stats.merged += g.dupeIds.length;
    }
  }
}

async function mergeProcessors(client) {
  const { rows } = await client.query(
    `SELECT id, name FROM asset_config_processors WHERE deleted_at IS NULL ORDER BY id`
  );
  const groups = new Map();
  for (const row of rows) {
    const normalized = normalizeProcessor(row.name);
    const key = compareKey('processors', normalized);
    if (!groups.has(key)) {
      groups.set(key, { keeperId: row.id, normalized, dupeIds: [], oldNames: [row.name] });
    } else {
      groups.get(key).dupeIds.push(row.id);
      groups.get(key).oldNames.push(row.name);
    }
  }

  for (const g of groups.values()) {
    for (const old of g.oldNames) trackRename('processor', old, g.normalized);

    if (!DRY_RUN) {
      for (const dupeId of g.dupeIds) {
        const { rows: gens } = await client.query(
          `SELECT id, name FROM asset_config_generations WHERE processor_id = $1 AND deleted_at IS NULL`,
          [dupeId]
        );
        for (const gen of gens) {
          const newName = normalizeGeneration(gen.name);
          const existing = await client.query(
            `SELECT id FROM asset_config_generations
              WHERE processor_id = $1 AND deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER($2) LIMIT 1`,
            [g.keeperId, newName]
          );
          if (existing.rows.length) {
            await client.query(
              `UPDATE asset_config_generations SET deleted_at = NOW() WHERE id = $1`, [gen.id]
            );
            stats.merged += 1;
          } else {
            trackRename('generation', gen.name, newName);
            await client.query(
              `UPDATE asset_config_generations SET processor_id = $1, name = $2, updated_at = NOW() WHERE id = $3`,
              [g.keeperId, newName, gen.id]
            );
          }
        }
        await client.query(
          `UPDATE asset_config_processors SET deleted_at = NOW() WHERE id = $1`, [dupeId]
        );
        stats.merged += 1;
      }
      await client.query(
        `UPDATE asset_config_processors SET name = $2, updated_at = NOW() WHERE id = $1`,
        [g.keeperId, g.normalized]
      );
      stats.updated += 1;
    } else if (g.dupeIds.length || g.oldNames.some((n) => n !== g.normalized)) {
      console.log(`  [processors] "${g.normalized}" (keep #${g.keeperId}, merge ${g.dupeIds.length})`);
      stats.updated += 1;
      stats.merged += g.dupeIds.length;
    }
  }
}

async function mergeModels(client) {
  const { rows } = await client.query(`
    SELECT m.id, m.name, m.brand_id, b.name AS brand_name
      FROM asset_config_models m
      JOIN asset_config_brands b ON b.id = m.brand_id
     WHERE m.deleted_at IS NULL
     ORDER BY m.id
  `);

  const groups = new Map();
  for (const row of rows) {
    const normalized = normalizeModel(row.name, row.brand_name);
    const key = `${row.brand_id}|${normalized.toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        keeperId: row.id,
        normalized,
        dupeIds: [],
        oldNames: [row.name],
        brandName: row.brand_name,
      });
    } else {
      const g = groups.get(key);
      g.dupeIds.push(row.id);
      g.oldNames.push(row.name);
    }
  }

  for (const g of groups.values()) {
    for (const old of g.oldNames) {
      trackRename('model', old, g.normalized);
    }

    if (!DRY_RUN) {
      for (const dupeId of g.dupeIds) {
        await client.query(
          `UPDATE asset_config_models SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [dupeId]
        );
        stats.merged += 1;
      }
      await client.query(
        `UPDATE asset_config_models SET name = $2, updated_at = NOW() WHERE id = $1`,
        [g.keeperId, g.normalized]
      );
      stats.updated += 1;
    } else if (g.oldNames.some((n) => n !== g.normalized) || g.dupeIds.length) {
      console.log(`  [models] ${g.brandName}: "${g.normalized}" (keep #${g.keeperId}, merge ${g.dupeIds.length})`);
      stats.updated += 1;
      stats.merged += g.dupeIds.length;
    }
  }
}

async function mergeGenerations(client) {
  const { rows } = await client.query(`
    SELECT g.id, g.name, g.processor_id, p.name AS processor_name
      FROM asset_config_generations g
      JOIN asset_config_processors p ON p.id = g.processor_id
     WHERE g.deleted_at IS NULL
     ORDER BY g.id
  `);

  const groups = new Map();
  for (const row of rows) {
    const normalized = normalizeGeneration(row.name);
    const key = `${row.processor_id}|${normalized.toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        keeperId: row.id,
        normalized,
        dupeIds: [],
        oldNames: [row.name],
        processorName: row.processor_name,
      });
    } else {
      const g = groups.get(key);
      g.dupeIds.push(row.id);
      g.oldNames.push(row.name);
    }
  }

  for (const g of groups.values()) {
    for (const old of g.oldNames) {
      trackRename('generation', old, g.normalized);
    }

    if (!DRY_RUN) {
      for (const dupeId of g.dupeIds) {
        await client.query(
          `UPDATE asset_config_generations SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [dupeId]
        );
        stats.merged += 1;
      }
      await client.query(
        `UPDATE asset_config_generations SET name = $2, updated_at = NOW() WHERE id = $1`,
        [g.keeperId, g.normalized]
      );
      stats.updated += 1;
    } else if (g.oldNames.some((n) => n !== g.normalized) || g.dupeIds.length) {
      console.log(`  [generations] ${g.processorName}: "${g.normalized}" (keep #${g.keeperId}, merge ${g.dupeIds.length})`);
      stats.updated += 1;
      stats.merged += g.dupeIds.length;
    }
  }
}

async function syncVendorProductDetails(client) {
  for (const [field, map] of Object.entries(renameMap)) {
    for (const [oldKey, newVal] of map.entries()) {
      if (DRY_RUN) continue;
      const r = await client.query(
        `UPDATE vendor_product_details
            SET ${field} = $1, updated_at = NOW()
          WHERE LOWER(TRIM(${field})) = $2
            AND TRIM(COALESCE(${field}, '')) <> $1`,
        [newVal, oldKey]
      );
      stats.vpdUpdated += r.rowCount || 0;
    }
  }
}

async function main() {
  console.log('Normalize CRM asset configuration');
  if (DRY_RUN) console.log('DRY RUN — no writes\n');

  const client = await pool.connect();
  try {
    if (!DRY_RUN) await client.query('BEGIN');

    await mergeBrands(client);
    await mergeProcessors(client);
    await mergeSimple(client, 'asset_config_ram', 'ram', normalizeRam);
    await mergeSimple(client, 'asset_config_storage', 'storage', normalizeStorage);
    await mergeSimple(client, 'asset_config_gpu', 'gpus', normalizeGpu);
    await mergeSimple(client, 'asset_config_screen_sizes', 'screen-sizes', normalizeScreenSize);
    await mergeModels(client);
    await mergeGenerations(client);
    await syncVendorProductDetails(client);

    if (!DRY_RUN) await client.query('COMMIT');

    console.log('\nDone:', stats);
    console.log('Verify: Settings → Asset Configuration');
  } catch (e) {
    if (!DRY_RUN) await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error('FAILED:', e.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
