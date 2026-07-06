const pool = require('../config/db');
const {
  normalizeEntityName,
  compareKey,
  collapseSpaces,
} = require('../utils/assetConfigNormalize');
const { normalizeSpecFilterOptions } = require('../utils/specFilterNormalize');
const { cacheWrap, CACHE_TTL } = require('../utils/cacheService');

/** Entity registry — table metadata for generic CRUD. */
const ENTITIES = {
  brands: {
    table: 'asset_config_brands',
    label: 'Brand',
    parentKey: null,
    parentTable: null,
    joinSelect: '',
    joinClause: '',
    listSelect: 't.*',
    orderBy: 't.name ASC',
  },
  'spare-brands': {
    table: 'asset_config_spare_brands',
    label: 'Spare Part Brand',
    parentKey: null,
    parentTable: null,
    joinSelect: '',
    joinClause: '',
    listSelect: 't.*',
    orderBy: 't.name ASC',
  },
  models: {
    table: 'asset_config_models',
    label: 'Model',
    parentKey: null,
    parentTable: null,
    joinSelect: '',
    joinClause: '',
    listSelect: 't.*',
    orderBy: 't.name ASC',
  },
  processors: {
    table: 'asset_config_processors',
    label: 'Processor',
    parentKey: null,
    parentTable: null,
    joinSelect: '',
    joinClause: '',
    listSelect: 't.*',
    orderBy: 't.name ASC',
  },
  generations: {
    table: 'asset_config_generations',
    label: 'Generation',
    parentKey: null,
    parentTable: null,
    joinSelect: '',
    joinClause: '',
    listSelect: 't.*',
    orderBy: 't.name ASC',
  },
  ram: {
    table: 'asset_config_ram',
    label: 'RAM',
    parentKey: null,
    parentTable: null,
    joinSelect: '',
    joinClause: '',
    listSelect: 't.*',
    orderBy: 't.name ASC',
  },
  storage: {
    table: 'asset_config_storage',
    label: 'Storage',
    parentKey: null,
    parentTable: null,
    joinSelect: '',
    joinClause: '',
    listSelect: 't.*',
    orderBy: 't.name ASC',
  },
  gpus: {
    table: 'asset_config_gpu',
    label: 'GPU',
    parentKey: null,
    parentTable: null,
    joinSelect: '',
    joinClause: '',
    listSelect: 't.*',
    orderBy: 't.name ASC',
  },
  'screen-sizes': {
    table: 'asset_config_screen_sizes',
    label: 'Screen Size',
    parentKey: null,
    parentTable: null,
    joinSelect: '',
    joinClause: '',
    listSelect: 't.*',
    orderBy: 't.name ASC',
  },
};

function getEntity(key) {
  const cfg = ENTITIES[key];
  if (!cfg) {
    const err = new Error(`Unknown configuration type: ${key}`);
    err.status = 404;
    throw err;
  }
  return cfg;
}

function normalizeName(name) {
  return collapseSpaces(name);
}

async function resolveNormalizedName(entityKey, name, parentId = null) {
  let context = {};
  if (entityKey === 'models' && parentId) {
    const b = await pool.query(
      `SELECT name FROM asset_config_brands WHERE id = $1 AND deleted_at IS NULL`,
      [parentId]
    );
    context.brandName = b.rows[0]?.name || '';
  }
  return normalizeEntityName(entityKey, name, context);
}

async function assertParentActive(parentTable, parentId) {
  if (!parentId) return;
  const r = await pool.query(
    `SELECT id FROM ${parentTable} WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
    [parentId]
  );
  if (!r.rows.length) {
    const err = new Error('Parent record not found or inactive');
    err.status = 400;
    throw err;
  }
}

async function assertUnique(entityKey, cfg, { name, parentId, excludeId }) {
  const normalized = await resolveNormalizedName(entityKey, name, parentId);
  let context = {};
  if (entityKey === 'models' && parentId) {
    const b = await pool.query(
      `SELECT name FROM asset_config_brands WHERE id = $1 AND deleted_at IS NULL`,
      [parentId]
    );
    context.brandName = b.rows[0]?.name || '';
  }

  const params = [];
  let sql = `SELECT id, name FROM ${cfg.table} t WHERE deleted_at IS NULL`;
  if (cfg.parentKey && parentId) {
    params.push(parentId);
    sql += ` AND t.${cfg.parentKey} = $${params.length}`;
  }
  if (excludeId) {
    params.push(excludeId);
    sql += ` AND t.id <> $${params.length}`;
  }

  const existing = await pool.query(sql, params);
  const newKey = compareKey(entityKey, normalized, context);
  if (existing.rows.some((row) => compareKey(entityKey, row.name, context) === newKey)) {
    const scope = cfg.parentKey ? ` for this ${cfg.parentKey.replace('_id', '')}` : '';
    const err = new Error(`${cfg.label} name must be unique${scope}`);
    err.status = 409;
    throw err;
  }
}

async function listEntity(entityKey, {
  page = 1, limit = 20, search = '', status = '', parentId = null, includeInactive = true,
} = {}) {
  const cfg = getEntity(entityKey);
  const params = [];
  const conditions = ['t.deleted_at IS NULL'];

  if (!includeInactive && !status) {
    conditions.push(`t.status = 'active'`);
  } else if (status) {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`t.name ILIKE $${params.length}`);
  }

  if (cfg.parentKey && parentId) {
    params.push(parseInt(parentId, 10));
    conditions.push(`t.${cfg.parentKey} = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${cfg.table} t ${cfg.joinClause} ${where}`,
    params
  );
  const offset = (Math.max(1, page) - 1) * limit;
  const listParams = [...params, limit, offset];
  const rowsRes = await pool.query(
    `SELECT ${cfg.listSelect}
       FROM ${cfg.table} t
       ${cfg.joinClause}
       ${where}
       ORDER BY ${cfg.orderBy}
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return {
    items: rowsRes.rows,
    pagination: {
      page: Math.max(1, page),
      limit,
      total: countRes.rows[0]?.total || 0,
      totalPages: Math.ceil((countRes.rows[0]?.total || 0) / limit) || 1,
    },
  };
}

async function getEntityById(entityKey, id) {
  const cfg = getEntity(entityKey);
  const r = await pool.query(
    `SELECT ${cfg.listSelect} FROM ${cfg.table} t ${cfg.joinClause}
      WHERE t.id = $1 AND t.deleted_at IS NULL`,
    [id]
  );
  return r.rows[0] || null;
}

async function createEntity(entityKey, body, userId) {
  const cfg = getEntity(entityKey);
  const parentId = cfg.parentKey ? parseInt(body[cfg.parentKey], 10) : null;
  if (cfg.parentKey && !parentId) {
    const err = new Error(`${cfg.parentKey.replace('_id', '')} is required`);
    err.status = 400;
    throw err;
  }
  const name = await resolveNormalizedName(entityKey, body.name, parentId);
  if (!name) {
    const err = new Error('Name is required');
    err.status = 400;
    throw err;
  }

  if (parentId) await assertParentActive(cfg.parentTable, parentId);
  await assertUnique(entityKey, cfg, { name, parentId });

  const status = body.status === 'inactive' ? 'inactive' : 'active';
  const cols = ['name', 'status', 'created_by', 'updated_by'];
  const vals = [name, status, userId, userId];
  if (cfg.parentKey) {
    cols.unshift(cfg.parentKey);
    vals.unshift(parentId);
  }

  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const r = await pool.query(
    `INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    vals
  );
  return r.rows[0];
}

async function updateEntity(entityKey, id, body, userId) {
  const cfg = getEntity(entityKey);
  const existing = await getEntityById(entityKey, id);
  if (!existing) {
    const err = new Error(`${cfg.label} not found`);
    err.status = 404;
    throw err;
  }

  const parentId = cfg.parentKey
    ? parseInt(body[cfg.parentKey] ?? existing[cfg.parentKey], 10)
    : null;
  if (cfg.parentKey && !parentId) {
    const err = new Error(`${cfg.parentKey.replace('_id', '')} is required`);
    err.status = 400;
    throw err;
  }

  const name = body.name != null
    ? await resolveNormalizedName(entityKey, body.name, parentId)
    : existing.name;
  if (!name) {
    const err = new Error('Name is required');
    err.status = 400;
    throw err;
  }

  if (parentId) await assertParentActive(cfg.parentTable, parentId);
  await assertUnique(entityKey, cfg, { name, parentId, excludeId: id });

  const status = body.status === 'inactive' ? 'inactive' : (body.status === 'active' ? 'active' : existing.status);

  if (cfg.parentKey) {
    const r = await pool.query(
      `UPDATE ${cfg.table} SET name = $2, ${cfg.parentKey} = $3, status = $4,
              updated_by = $5, updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [id, name, parentId, status, userId]
    );
    return r.rows[0];
  }

  const r = await pool.query(
    `UPDATE ${cfg.table} SET name = $2, status = $3, updated_by = $4, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, name, status, userId]
  );
  return r.rows[0];
}

async function softDeleteEntity(entityKey, id, userId) {
  const cfg = getEntity(entityKey);
  const r = await pool.query(
    `UPDATE ${cfg.table} SET deleted_at = NOW(), updated_by = $2, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id, userId]
  );
  if (!r.rows.length) {
    const err = new Error(`${cfg.label} not found`);
    err.status = 404;
    throw err;
  }
  return { id };
}

async function setEntityStatus(entityKey, id, status, userId) {
  if (!['active', 'inactive'].includes(status)) {
    const err = new Error('Status must be active or inactive');
    err.status = 400;
    throw err;
  }
  const cfg = getEntity(entityKey);
  const r = await pool.query(
    `UPDATE ${cfg.table} SET status = $2, updated_by = $3, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, status, userId]
  );
  if (!r.rows.length) {
    const err = new Error(`${cfg.label} not found`);
    err.status = 404;
    throw err;
  }
  return r.rows[0];
}

async function loadLaptopSpecMappingMaps() {
  try {
    const [modelRows, bp, bg] = await Promise.all([
      pool.query(
        `SELECT bm.brand_id, b.name AS brand_name, m.name AS model_name, bm.status
           FROM asset_config_brand_models bm
           JOIN asset_config_brands b ON b.id = bm.brand_id AND b.deleted_at IS NULL
           JOIN asset_config_models m ON m.id = bm.model_id AND m.deleted_at IS NULL
          WHERE bm.deleted_at IS NULL`
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT bp.brand_id, b.name AS brand_name, p.name AS processor_name, bp.status
           FROM asset_config_brand_processors bp
           JOIN asset_config_brands b ON b.id = bp.brand_id AND b.deleted_at IS NULL
           JOIN asset_config_processors p ON p.id = bp.processor_id AND p.deleted_at IS NULL
          WHERE bp.deleted_at IS NULL`
      ),
      pool.query(
        `SELECT bg.brand_id, b.name AS brand_name, g.name AS generation_name, bg.status
           FROM asset_config_brand_generations bg
           JOIN asset_config_brands b ON b.id = bg.brand_id AND b.deleted_at IS NULL
           JOIN asset_config_generations g ON g.id = bg.generation_id AND g.deleted_at IS NULL
          WHERE bg.deleted_at IS NULL`
      ).catch(() => ({ rows: [] })),
    ]);

    const modelsByBrand = {};
    const processorsByBrand = {};
    const generationsByBrand = {};

    for (const row of modelRows.rows) {
      if (row.status !== 'active') continue;
      if (!modelsByBrand[row.brand_name]) modelsByBrand[row.brand_name] = [];
      if (!modelsByBrand[row.brand_name].includes(row.model_name)) {
        modelsByBrand[row.brand_name].push(row.model_name);
      }
    }
    for (const row of bp.rows) {
      if (row.status !== 'active') continue;
      if (!processorsByBrand[row.brand_name]) processorsByBrand[row.brand_name] = [];
      if (!processorsByBrand[row.brand_name].includes(row.processor_name)) {
        processorsByBrand[row.brand_name].push(row.processor_name);
      }
    }
    for (const row of bg.rows) {
      if (row.status !== 'active') continue;
      if (!generationsByBrand[row.brand_name]) generationsByBrand[row.brand_name] = [];
      if (!generationsByBrand[row.brand_name].includes(row.generation_name)) {
        generationsByBrand[row.brand_name].push(row.generation_name);
      }
    }

    const hasFlatMapping = modelRows.rows.length > 0 || bp.rows.length > 0 || bg.rows.length > 0;
    if (!hasFlatMapping) return null;

    return { modelsByBrand, processorsByBrand, generationsByBrand, hasFlatMapping: true };
  } catch (e) {
    if (e.message && (e.message.includes('asset_config_brand_processors')
      || e.message.includes('asset_config_brand_models')
      || e.message.includes('asset_config_brand_generations'))) {
      return null;
    }
    throw e;
  }
}

/** Active dropdown catalog for Asset Details forms. */
async function getAssetDropdownCatalog() {
  const [brands, models, processors, generations, rams, storages, gpus, screenSizes] = await Promise.all([
    pool.query(`SELECT id, name FROM asset_config_brands WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(
      `SELECT m.id, m.name, m.brand_id, b.name AS brand_name
         FROM asset_config_models m
         LEFT JOIN asset_config_brands b ON b.id = m.brand_id AND b.deleted_at IS NULL AND b.status = 'active'
        WHERE m.deleted_at IS NULL AND m.status = 'active'
        ORDER BY m.name`
    ),
    pool.query(`SELECT id, name FROM asset_config_processors WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(
      `SELECT g.id, g.name, g.processor_id, p.name AS processor_name
         FROM asset_config_generations g
         LEFT JOIN asset_config_processors p ON p.id = g.processor_id AND p.deleted_at IS NULL AND p.status = 'active'
        WHERE g.deleted_at IS NULL AND g.status = 'active'
        ORDER BY g.name`
    ),
    pool.query(`SELECT name FROM asset_config_ram WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(`SELECT name FROM asset_config_storage WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(`SELECT name FROM asset_config_gpu WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(`SELECT name FROM asset_config_screen_sizes WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
  ]);

  const laptopSpecMaps = await loadLaptopSpecMappingMaps();
  const modelsByBrand = laptopSpecMaps?.modelsByBrand || {};
  if (!Object.keys(modelsByBrand).length) {
    for (const row of models.rows) {
      const brand = row.brand_name;
      if (!brand) continue;
      if (!modelsByBrand[brand]) modelsByBrand[brand] = [];
      modelsByBrand[brand].push(row.name);
    }
  }

  const generationsByProcessor = {};
  for (const row of generations.rows) {
    const proc = row.processor_name;
    if (!proc) continue;
    if (!generationsByProcessor[proc]) generationsByProcessor[proc] = [];
    generationsByProcessor[proc].push(row.name);
  }

  const processorsByBrand = laptopSpecMaps?.processorsByBrand || null;
  const generationsByBrand = laptopSpecMaps?.generationsByBrand || null;

  const catalogRows = [];
  if (laptopSpecMaps?.hasFlatMapping) {
    for (const b of brands.rows) {
      const brandModels = modelsByBrand[b.name] || [];
      const brandProcessors = processorsByBrand?.[b.name] || [];
      const brandGenerations = generationsByBrand?.[b.name] || [];
      const modelList = brandModels.length ? brandModels : [''];
      const processorList = brandProcessors.length ? brandProcessors : [''];
      const generationList = brandGenerations.length ? brandGenerations : [''];
      for (const modelName of modelList) {
        for (const processorName of processorList) {
          for (const generationName of generationList) {
            catalogRows.push({
              brand: b.name,
              model: modelName || null,
              processor: processorName || null,
              generation: generationName || null,
            });
          }
        }
      }
    }
  } else {
    for (const b of brands.rows) {
      const brandModels = models.rows.filter((m) => m.brand_id === b.id);
      for (const m of brandModels.length ? brandModels : [{ name: '' }]) {
        for (const p of processors.rows) {
          const procGens = generations.rows.filter((g) => g.processor_id === p.id);
          for (const g of procGens.length ? procGens : [{ name: '' }]) {
            catalogRows.push({
              brand: b.name,
              model: m.name || null,
              processor: p.name,
              generation: g.name || null,
            });
          }
        }
      }
    }
  }

  return {
    from_asset_config: true,
    brands: brands.rows.map((r) => r.name),
    models: modelsByBrand,
    models_by_brand: modelsByBrand,
    models_flat: [...new Set(Object.values(modelsByBrand).flat())],
    processors: processors.rows.map((r) => r.name),
    processors_by_brand: processorsByBrand || {},
    generations: generationsByProcessor,
    generations_by_processor: generationsByProcessor,
    generations_by_brand: generationsByBrand || {},
    generations_by_brand_processor: {},
    generations_flat: generationsByBrand
      ? [...new Set(Object.values(generationsByBrand).flat())]
      : [...new Set(Object.values(generationsByProcessor).flat())],
    has_laptop_spec_mapping: Boolean(laptopSpecMaps?.hasFlatMapping),
    rams: rams.rows.map((r) => r.name),
    storages: storages.rows.map((r) => r.name),
    gpus: gpus.rows.map((r) => r.name),
    screen_sizes: screenSizes.rows.map((r) => r.name),
    catalog_rows: catalogRows,
    brand_options: brands.rows,
    processor_options: processors.rows,
  };
}

function emptyAssetCatalog() {
  return {
    from_asset_config: false,
    has_laptop_spec_mapping: false,
    brands: [],
    models: {},
    models_by_brand: {},
    models_flat: [],
    processors: [],
    processors_by_brand: {},
    generations: {},
    generations_by_processor: {},
    generations_by_brand_processor: {},
    generations_flat: [],
    rams: [],
    storages: [],
    gpus: [],
    screen_sizes: [],
    catalog_rows: [],
  };
}

/** Normalize catalog for sales, vendor PO, and asset forms — DB-first, optional legacy rows. */
async function getAssetCatalogForApi({ includeLegacyRows = true } = {}) {
  let catalog;
  try {
    catalog = await getAssetDropdownCatalog();
    if (!catalog.brands?.length) catalog = emptyAssetCatalog();
  } catch (e) {
    console.warn('[assetCatalog] config tables unavailable:', e.message);
    catalog = emptyAssetCatalog();
  }

  if (includeLegacyRows) {
    try {
      const legacy = await pool.query(
        `SELECT DISTINCT brand, model, processor, generation, ram, storage FROM (
           SELECT brand, model, processor, generation, ram, storage
             FROM vendor_product_details
            WHERE COALESCE(model, '') <> ''
           UNION
           SELECT brand, model, processor, generation, ram, storage
             FROM laptop_catalog WHERE active = true
         ) c`
      );
      const seen = new Set(catalog.catalog_rows.map((r) =>
        [r.brand, r.model, r.processor, r.generation, r.ram, r.storage].join('|')
      ));
      for (const row of legacy.rows) {
        const key = [row.brand, row.model, row.processor, row.generation, row.ram, row.storage].join('|');
        if (!seen.has(key)) {
          catalog.catalog_rows.push(row);
          seen.add(key);
        }
      }
    } catch (e) {
      console.warn('[assetCatalog] legacy rows skipped:', e.message);
    }
  }

  return catalog;
}

async function listParentOptions(entityKey) {
  if (entityKey === 'models') {
    const r = await pool.query(
      `SELECT id, name FROM asset_config_brands WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`
    );
    return r.rows;
  }
  if (entityKey === 'generations') {
    const r = await pool.query(
      `SELECT id, name FROM asset_config_processors WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`
    );
    return r.rows;
  }
  return [];
}

/* ─────────────────────────── Parent ↔ Child mapping ───────────────────────────
 * A "mapping" view groups a child entity (models / generations) under its parent
 * (brands / processors) so an admin can manage the whole relationship at once
 * instead of editing one child row at a time. Drives the cascading dropdowns. */

function assertChildEntity(cfg) {
  if (!cfg.parentKey) {
    const err = new Error(`${cfg.label} has no parent to map`);
    err.status = 400;
    throw err;
  }
}

/** Returns every parent with its mapped children: [{ id, name, status, children:[…] }]. */
async function getMappingTree(childEntityKey) {
  const cfg = getEntity(childEntityKey);
  assertChildEntity(cfg);

  const [parents, children] = await Promise.all([
    pool.query(
      `SELECT id, name, status FROM ${cfg.parentTable} WHERE deleted_at IS NULL ORDER BY name ASC`
    ),
    pool.query(
      `SELECT id, name, status, ${cfg.parentKey} AS parent_id
         FROM ${cfg.table} WHERE deleted_at IS NULL ORDER BY name ASC`
    ),
  ]);

  const byParent = new Map();
  for (const c of children.rows) {
    if (!byParent.has(c.parent_id)) byParent.set(c.parent_id, []);
    byParent.get(c.parent_id).push({ id: c.id, name: c.name, status: c.status });
  }

  return parents.rows.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    children: byParent.get(p.id) || [],
  }));
}

/** Create many children under one parent, skipping names that already exist there. */
async function bulkCreateChildren(childEntityKey, parentId, names, userId) {
  const cfg = getEntity(childEntityKey);
  assertChildEntity(cfg);
  const pid = parseInt(parentId, 10);
  if (!pid) {
    const err = new Error(`${cfg.parentKey.replace('_id', '')} is required`);
    err.status = 400;
    throw err;
  }
  await assertParentActive(cfg.parentTable, pid);

  let brandName = '';
  if (childEntityKey === 'models') {
    const b = await pool.query(
      `SELECT name FROM asset_config_brands WHERE id = $1 AND deleted_at IS NULL`, [pid]
    );
    brandName = b.rows[0]?.name || '';
  }

  const clean = [];
  const seen = new Set();
  for (const raw of (Array.isArray(names) ? names : [])) {
    const n = childEntityKey === 'models'
      ? normalizeEntityName('models', raw, { brandName })
      : normalizeEntityName(childEntityKey, raw);
    if (!n) continue;
    const key = compareKey(childEntityKey, n, { brandName });
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(n);
  }

  const created = [];
  const skipped = [];
  for (const name of clean) {
    try {
      await assertUnique(childEntityKey, cfg, { name, parentId: pid });
    } catch (e) {
      if (e.status === 409) { skipped.push(name); continue; }
      throw e;
    }
    const r = await pool.query(
      `INSERT INTO ${cfg.table} (${cfg.parentKey}, name, status, created_by, updated_by)
       VALUES ($1, $2, 'active', $3, $3) RETURNING id, name, status`,
      [pid, name, userId]
    );
    created.push(r.rows[0]);
  }
  return { created, skipped };
}

/** Move a set of children to a different parent (skips names that would collide). */
async function reassignChildren(childEntityKey, ids, parentId, userId) {
  const cfg = getEntity(childEntityKey);
  assertChildEntity(cfg);
  const pid = parseInt(parentId, 10);
  if (!pid) {
    const err = new Error(`${cfg.parentKey.replace('_id', '')} is required`);
    err.status = 400;
    throw err;
  }
  await assertParentActive(cfg.parentTable, pid);

  const idList = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter(Boolean);
  let moved = 0;
  const conflicts = [];
  for (const id of idList) {
    const cur = await pool.query(
      `SELECT name FROM ${cfg.table} WHERE id = $1 AND deleted_at IS NULL`, [id]
    );
    if (!cur.rows.length) continue;
    const name = cur.rows[0].name;
    const dup = await pool.query(
      `SELECT id FROM ${cfg.table}
        WHERE deleted_at IS NULL AND ${cfg.parentKey} = $1
          AND LOWER(TRIM(name)) = LOWER(TRIM($2)) AND id <> $3 LIMIT 1`,
      [pid, name, id]
    );
    if (dup.rows.length) { conflicts.push(name); continue; }
    await pool.query(
      `UPDATE ${cfg.table} SET ${cfg.parentKey} = $1, updated_by = $2, updated_at = NOW()
        WHERE id = $3 AND deleted_at IS NULL`,
      [pid, userId, id]
    );
    moved += 1;
  }
  return { moved, conflicts };
}

/** Soft-delete many children at once. */
async function bulkDeleteChildren(childEntityKey, ids, userId) {
  const cfg = getEntity(childEntityKey);
  assertChildEntity(cfg);
  const idList = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter(Boolean);
  if (!idList.length) return { deleted: 0 };
  const r = await pool.query(
    `UPDATE ${cfg.table} SET deleted_at = NOW(), updated_by = $1, updated_at = NOW()
      WHERE id = ANY($2::int[]) AND deleted_at IS NULL`,
    [userId, idList]
  );
  return { deleted: r.rowCount };
}

/** Activate / deactivate many children at once. */
async function bulkSetChildStatus(childEntityKey, ids, status, userId) {
  const cfg = getEntity(childEntityKey);
  assertChildEntity(cfg);
  const s = status === 'inactive' ? 'inactive' : 'active';
  const idList = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter(Boolean);
  if (!idList.length) return { updated: 0 };
  const r = await pool.query(
    `UPDATE ${cfg.table} SET status = $1, updated_by = $2, updated_at = NOW()
      WHERE id = ANY($3::int[]) AND deleted_at IS NULL`,
    [s, userId, idList]
  );
  return { updated: r.rowCount };
}

async function getLaptopSpecMappingTree() {
  const [brands, modelRows, processorRows, generationRows] = await Promise.all([
    pool.query(`SELECT id, name, status FROM asset_config_brands WHERE deleted_at IS NULL ORDER BY name ASC`),
    pool.query(
      `SELECT bm.id, bm.brand_id, bm.model_id, bm.status, m.name AS item_name
         FROM asset_config_brand_models bm
         JOIN asset_config_models m ON m.id = bm.model_id AND m.deleted_at IS NULL
        WHERE bm.deleted_at IS NULL
        ORDER BY m.name ASC`
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT bp.id, bp.brand_id, bp.processor_id, bp.status, p.name AS item_name
         FROM asset_config_brand_processors bp
         JOIN asset_config_processors p ON p.id = bp.processor_id AND p.deleted_at IS NULL
        WHERE bp.deleted_at IS NULL
        ORDER BY p.name ASC`
    ),
    pool.query(
      `SELECT bg.id, bg.brand_id, bg.generation_id, bg.status, g.name AS item_name
         FROM asset_config_brand_generations bg
         JOIN asset_config_generations g ON g.id = bg.generation_id AND g.deleted_at IS NULL
        WHERE bg.deleted_at IS NULL
        ORDER BY g.name ASC`
    ).catch(() => ({ rows: [] })),
  ]);

  const modelsByBrand = new Map();
  for (const row of modelRows.rows) {
    if (!modelsByBrand.has(row.brand_id)) modelsByBrand.set(row.brand_id, []);
    modelsByBrand.get(row.brand_id).push({
      id: row.id,
      model_id: row.model_id,
      name: row.item_name,
      status: row.status,
    });
  }

  const processorsByBrand = new Map();
  for (const row of processorRows.rows) {
    if (!processorsByBrand.has(row.brand_id)) processorsByBrand.set(row.brand_id, []);
    processorsByBrand.get(row.brand_id).push({
      id: row.id,
      processor_id: row.processor_id,
      name: row.item_name,
      status: row.status,
    });
  }

  const generationsByBrand = new Map();
  for (const row of generationRows.rows) {
    if (!generationsByBrand.has(row.brand_id)) generationsByBrand.set(row.brand_id, []);
    generationsByBrand.get(row.brand_id).push({
      id: row.id,
      generation_id: row.generation_id,
      name: row.item_name,
      status: row.status,
    });
  }

  return brands.rows.map((brand) => ({
    id: brand.id,
    name: brand.name,
    status: brand.status,
    models: modelsByBrand.get(brand.id) || [],
    processors: processorsByBrand.get(brand.id) || [],
    generations: generationsByBrand.get(brand.id) || [],
  }));
}

async function assertBrandProcessorRow(brandId, processorId) {
  const brand = parseInt(brandId, 10);
  const processor = parseInt(processorId, 10);
  if (!brand || !processor) {
    const err = new Error('Brand and processor are required');
    err.status = 400;
    throw err;
  }
  await assertParentActive('asset_config_brands', brand);
  await assertParentActive('asset_config_processors', processor);
  return { brand, processor };
}

async function bulkAddProcessorsToBrand(brandId, processorIds, userId) {
  const brand = parseInt(brandId, 10);
  if (!brand) {
    const err = new Error('Brand is required');
    err.status = 400;
    throw err;
  }
  await assertParentActive('asset_config_brands', brand);

  const ids = [...new Set((Array.isArray(processorIds) ? processorIds : [])
    .map((n) => parseInt(n, 10)).filter(Boolean))];
  const created = [];
  const skipped = [];
  for (const processorId of ids) {
    try {
      await assertParentActive('asset_config_processors', processorId);
    } catch {
      skipped.push(processorId);
      continue;
    }
    const existing = await pool.query(
      `SELECT id FROM asset_config_brand_processors
        WHERE brand_id = $1 AND processor_id = $2 AND deleted_at IS NULL`,
      [brand, processorId]
    );
    if (existing.rows.length) {
      skipped.push(processorId);
      continue;
    }
    const r = await pool.query(
      `INSERT INTO asset_config_brand_processors (brand_id, processor_id, status, created_by, updated_by)
       VALUES ($1, $2, 'active', $3, $3)
       RETURNING id, processor_id, status`,
      [brand, processorId, userId]
    );
    const proc = await pool.query(`SELECT name FROM asset_config_processors WHERE id = $1`, [processorId]);
    created.push({ ...r.rows[0], name: proc.rows[0]?.name || '', generations: [] });
  }
  return { created, skipped };
}

async function bulkAddModelsToBrand(brandId, modelIds, userId) {
  const brand = parseInt(brandId, 10);
  if (!brand) {
    const err = new Error('Brand is required');
    err.status = 400;
    throw err;
  }
  await assertParentActive('asset_config_brands', brand);

  const ids = [...new Set((Array.isArray(modelIds) ? modelIds : [])
    .map((n) => parseInt(n, 10)).filter(Boolean))];
  const created = [];
  const skipped = [];
  for (const modelId of ids) {
    try {
      await assertParentActive('asset_config_models', modelId);
    } catch {
      skipped.push(modelId);
      continue;
    }
    const existing = await pool.query(
      `SELECT id FROM asset_config_brand_models
        WHERE brand_id = $1 AND model_id = $2 AND deleted_at IS NULL`,
      [brand, modelId]
    );
    if (existing.rows.length) {
      skipped.push(modelId);
      continue;
    }
    const r = await pool.query(
      `INSERT INTO asset_config_brand_models (brand_id, model_id, status, created_by, updated_by)
       VALUES ($1, $2, 'active', $3, $3)
       RETURNING id, model_id, status`,
      [brand, modelId, userId]
    );
    const model = await pool.query(`SELECT name FROM asset_config_models WHERE id = $1`, [modelId]);
    created.push({ ...r.rows[0], name: model.rows[0]?.name || '' });
  }
  return { created, skipped };
}

async function bulkAddGenerationsToBrand(brandId, generationIds, userId) {
  const brand = parseInt(brandId, 10);
  if (!brand) {
    const err = new Error('Brand is required');
    err.status = 400;
    throw err;
  }
  await assertParentActive('asset_config_brands', brand);

  const ids = [...new Set((Array.isArray(generationIds) ? generationIds : [])
    .map((n) => parseInt(n, 10)).filter(Boolean))];
  const created = [];
  const skipped = [];
  for (const generationId of ids) {
    try {
      await assertParentActive('asset_config_generations', generationId);
    } catch {
      skipped.push(generationId);
      continue;
    }
    const existing = await pool.query(
      `SELECT id FROM asset_config_brand_generations
        WHERE brand_id = $1 AND generation_id = $2 AND deleted_at IS NULL`,
      [brand, generationId]
    );
    if (existing.rows.length) {
      skipped.push(generationId);
      continue;
    }
    const r = await pool.query(
      `INSERT INTO asset_config_brand_generations (brand_id, generation_id, status, created_by, updated_by)
       VALUES ($1, $2, 'active', $3, $3)
       RETURNING id, generation_id, status`,
      [brand, generationId, userId]
    );
    const gen = await pool.query(`SELECT name FROM asset_config_generations WHERE id = $1`, [generationId]);
    created.push({ ...r.rows[0], name: gen.rows[0]?.name || '' });
  }
  return { created, skipped };
}

async function bulkAddGenerationsToBrandProcessor(brandId, processorId, generationIds, userId) {
  return bulkAddGenerationsToBrand(brandId, generationIds, userId);
}

async function bulkDeleteBrandModels(ids, userId) {
  const idList = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter(Boolean);
  if (!idList.length) return { deleted: 0 };
  const r = await pool.query(
    `UPDATE asset_config_brand_models
        SET deleted_at = NOW(), updated_by = $1, updated_at = NOW()
      WHERE id = ANY($2::int[]) AND deleted_at IS NULL`,
    [userId, idList]
  );
  return { deleted: r.rowCount };
}

async function bulkDeleteBrandGenerations(ids, userId) {
  const idList = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter(Boolean);
  if (!idList.length) return { deleted: 0 };
  const r = await pool.query(
    `UPDATE asset_config_brand_generations
        SET deleted_at = NOW(), updated_by = $1, updated_at = NOW()
      WHERE id = ANY($2::int[]) AND deleted_at IS NULL`,
    [userId, idList]
  );
  return { deleted: r.rowCount };
}

async function bulkSetBrandModelStatus(ids, status, userId) {
  const idList = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter(Boolean);
  if (!idList.length) return { updated: 0 };
  const s = status === 'inactive' ? 'inactive' : 'active';
  const r = await pool.query(
    `UPDATE asset_config_brand_models SET status = $1, updated_by = $2, updated_at = NOW()
      WHERE id = ANY($3::int[]) AND deleted_at IS NULL`,
    [s, userId, idList]
  );
  return { updated: r.rowCount };
}

async function bulkSetBrandGenerationStatus(ids, status, userId) {
  const idList = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter(Boolean);
  if (!idList.length) return { updated: 0 };
  const s = status === 'inactive' ? 'inactive' : 'active';
  const r = await pool.query(
    `UPDATE asset_config_brand_generations SET status = $1, updated_by = $2, updated_at = NOW()
      WHERE id = ANY($3::int[]) AND deleted_at IS NULL`,
    [s, userId, idList]
  );
  return { updated: r.rowCount };
}

async function brandHasFlatMappings(brandId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM asset_config_brand_models WHERE brand_id = $1 AND deleted_at IS NULL
     UNION ALL
     SELECT 1 FROM asset_config_brand_processors WHERE brand_id = $1 AND deleted_at IS NULL
     UNION ALL
     SELECT 1 FROM asset_config_brand_generations WHERE brand_id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [brandId]
  );
  return rows.length > 0;
}

async function bulkDeleteBrandProcessors(ids, userId) {
  const idList = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter(Boolean);
  if (!idList.length) return { deleted: 0 };
  const r = await pool.query(
    `UPDATE asset_config_brand_processors
        SET deleted_at = NOW(), updated_by = $1, updated_at = NOW()
      WHERE id = ANY($2::int[]) AND deleted_at IS NULL`,
    [userId, idList]
  );
  return { deleted: r.rowCount };
}

async function bulkDeleteBrandProcessorGenerations(ids, userId) {
  return bulkDeleteBrandGenerations(ids, userId);
}

async function bulkSetBrandProcessorStatus(ids, status, userId) {
  const s = status === 'inactive' ? 'inactive' : 'active';
  const idList = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter(Boolean);
  if (!idList.length) return { updated: 0 };
  const r = await pool.query(
    `UPDATE asset_config_brand_processors SET status = $1, updated_by = $2, updated_at = NOW()
      WHERE id = ANY($3::int[]) AND deleted_at IS NULL`,
    [s, userId, idList]
  );
  return { updated: r.rowCount };
}

async function bulkSetBrandProcessorGenerationStatus(ids, status, userId) {
  return bulkSetBrandGenerationStatus(ids, status, userId);
}

async function getActiveBrandByName(brandName) {
  const { rows } = await pool.query(
    `SELECT id, name FROM asset_config_brands
      WHERE deleted_at IS NULL AND status = 'active' AND LOWER(TRIM(name)) = LOWER(TRIM($1))
      LIMIT 1`,
    [brandName]
  );
  return rows[0] || null;
}

async function listCascadeBrands() {
  const { rows } = await pool.query(
    `SELECT id, name FROM asset_config_brands
      WHERE deleted_at IS NULL AND status = 'active'
      ORDER BY name ASC`
  );
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

async function listCascadeSpecMasters() {
  const [rams, storages, gpus, screenSizes] = await Promise.all([
    pool.query(`SELECT name FROM asset_config_ram WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(`SELECT name FROM asset_config_storage WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(`SELECT name FROM asset_config_gpu WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(`SELECT name FROM asset_config_screen_sizes WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
  ]);
  return {
    rams: rams.rows.map((r) => r.name),
    storages: storages.rows.map((r) => r.name),
    gpus: gpus.rows.map((r) => r.name),
    screen_sizes: screenSizes.rows.map((r) => r.name),
  };
}

/** Flat active names for independent inventory spec filters (no brand cascade). */
function mergeUniqueSorted(...lists) {
  const set = new Set();
  for (const list of lists) {
    for (const item of list || []) {
      const v = String(item || '').trim();
      if (v) set.add(v);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function distinctSpecValues(sql) {
  const { rows } = await pool.query(sql).catch(() => ({ rows: [] }));
  return rows.map((r) => r.v).filter(Boolean);
}

async function listObservedInventorySpecValues() {
  const base = `
    SELECT DISTINCT val AS v FROM (
      SELECT TRIM(%COL%) AS val FROM inventory WHERE %COL% IS NOT NULL AND TRIM(%COL%) <> ''
      UNION
      SELECT TRIM(extra->>'%FIELD%') FROM vendor_serial_numbers
        WHERE extra->>'%FIELD%' IS NOT NULL AND TRIM(extra->>'%FIELD%') <> '' AND deleted_at IS NULL
      UNION
      SELECT TRIM(%COL%) FROM vendor_product_details
        WHERE %COL% IS NOT NULL AND TRIM(%COL%) <> ''
    ) t ORDER BY v ASC`;
  const q = (col, field = col) => base.replace(/%COL%/g, col).replace(/%FIELD%/g, field);

  const [generations, processors, rams, storages, gpus, screen_sizes, brands, models] = await Promise.all([
    distinctSpecValues(q('generation')),
    distinctSpecValues(q('processor')),
    distinctSpecValues(q('ram')),
    distinctSpecValues(q('storage')),
    distinctSpecValues(q('gpu')),
    distinctSpecValues(q('screen_size')),
    distinctSpecValues(q('brand')),
    distinctSpecValues(q('model')),
  ]);
  return { generations, processors, rams, storages, gpus, screen_sizes, brands, models };
}

function listObservedInventorySpecValuesCached() {
  return cacheWrap(
    'inventory:observed-spec-values',
    CACHE_TTL.OBSERVED_SPECS,
    listObservedInventorySpecValues
  );
}

function activeLaptopMappedNames(items = []) {
  return (items || [])
    .filter((row) => row.status === 'active')
    .map((row) => row.name)
    .filter(Boolean);
}

function findLaptopBrandInTree(tree, brandName) {
  const key = compareKey('brands', brandName);
  return (tree || []).find(
    (b) => b.status === 'active' && compareKey('brands', b.name) === key
  );
}

async function getLaptopMappingTreeCached() {
  return cacheWrap(
    'asset-config:laptop-spec-tree:v1',
    CACHE_TTL.FILTER_OPTIONS,
    getLaptopSpecMappingTree
  );
}

async function buildAllInventorySpecFilterOptions() {
  const [tree, specs] = await Promise.all([
    getLaptopMappingTreeCached(),
    listCascadeSpecMasters(),
  ]);
  const brands = (tree || [])
    .filter((b) => b.status === 'active')
    .map((b) => b.name);
  const models = new Set();
  const processors = new Set();
  const generations = new Set();
  for (const brand of tree || []) {
    if (brand.status !== 'active') continue;
    activeLaptopMappedNames(brand.models).forEach((n) => models.add(n));
    activeLaptopMappedNames(brand.processors).forEach((n) => processors.add(n));
    activeLaptopMappedNames(brand.generations).forEach((n) => generations.add(n));
  }
  return normalizeSpecFilterOptions({
    brands: mergeUniqueSorted(brands),
    models: mergeUniqueSorted([...models]),
    processors: mergeUniqueSorted([...processors]),
    generations: mergeUniqueSorted([...generations]),
    rams: specs.rams,
    storages: specs.storages,
    gpus: specs.gpus,
    screen_sizes: specs.screen_sizes,
  });
}

async function buildBrandScopedInventorySpecFilterOptions(brandName) {
  const brand = String(brandName || '').trim();
  const [tree, specs] = await Promise.all([
    getLaptopMappingTreeCached(),
    listCascadeSpecMasters(),
  ]);
  const brands = (tree || [])
    .filter((b) => b.status === 'active')
    .map((b) => b.name);
  const match = findLaptopBrandInTree(tree, brand);
  return normalizeSpecFilterOptions({
    brands: mergeUniqueSorted(brands),
    models: match ? activeLaptopMappedNames(match.models) : [],
    processors: match ? activeLaptopMappedNames(match.processors) : [],
    generations: match ? activeLaptopMappedNames(match.generations) : [],
    rams: specs.rams,
    storages: specs.storages,
    gpus: specs.gpus,
    screen_sizes: specs.screen_sizes,
  });
}

async function listInventorySpecFilterOptions(brandName) {
  const brand = String(brandName || '').trim();
  if (!brand) {
    return cacheWrap(
      'inventory:spec-filter-options:v3:all',
      CACHE_TTL.FILTER_OPTIONS,
      buildAllInventorySpecFilterOptions
    );
  }
  const cacheKey = `inventory:spec-filter-options:v3:${compareKey('brands', brand)}`;
  return cacheWrap(
    cacheKey,
    CACHE_TTL.FILTER_OPTIONS,
    () => buildBrandScopedInventorySpecFilterOptions(brand)
  );
}

async function listMappedNamesForBrand(brandId, junctionTable, joinTable, joinColumn, itemColumn = 'name') {
  const { rows } = await pool.query(
    `SELECT DISTINCT target.${itemColumn} AS name
       FROM ${junctionTable} j
       JOIN ${joinTable} target ON target.id = j.${joinColumn} AND target.deleted_at IS NULL AND target.status = 'active'
      WHERE j.brand_id = $1 AND j.deleted_at IS NULL AND j.status = 'active'
      ORDER BY target.${itemColumn} ASC`,
    [brandId]
  );
  return rows.map((r) => r.name);
}

async function listCascadeModelsForBrand(brandName) {
  const brand = await getActiveBrandByName(brandName);
  if (!brand) {
    return { brand: brandName, models: [], has_mapping: false };
  }
  const mapped = await listMappedNamesForBrand(
    brand.id,
    'asset_config_brand_models',
    'asset_config_models',
    'model_id'
  ).catch(() => []);
  if (mapped.length) {
    return { brand: brand.name, models: mapped, has_mapping: true };
  }
  const hasMapping = await brandHasFlatMappings(brand.id);
  if (hasMapping) {
    return { brand: brand.name, models: [], has_mapping: true };
  }
  const legacy = await pool.query(
    `SELECT name FROM asset_config_models
      WHERE brand_id = $1 AND deleted_at IS NULL AND status = 'active'
      ORDER BY name ASC`,
    [brand.id]
  ).catch(() => ({ rows: [] }));
  return {
    brand: brand.name,
    models: legacy.rows.map((r) => r.name),
    has_mapping: legacy.rows.length > 0,
  };
}

async function listCascadeProcessorsForBrand(brandName) {
  const brand = await getActiveBrandByName(brandName);
  if (!brand) {
    return { brand: brandName, processors: [], has_mapping: false };
  }
  const mapped = await listMappedNamesForBrand(
    brand.id,
    'asset_config_brand_processors',
    'asset_config_processors',
    'processor_id'
  );
  return {
    brand: brand.name,
    processors: mapped,
    has_mapping: mapped.length > 0 || (await brandHasFlatMappings(brand.id)),
  };
}

async function listCascadeGenerationsForBrand(brandName) {
  const brand = await getActiveBrandByName(brandName);
  if (!brand) {
    return { brand: brandName, generations: [], has_mapping: false };
  }
  const mapped = await listMappedNamesForBrand(
    brand.id,
    'asset_config_brand_generations',
    'asset_config_generations',
    'generation_id'
  ).catch(() => []);
  return {
    brand: brand.name,
    generations: mapped,
    has_mapping: mapped.length > 0 || (await brandHasFlatMappings(brand.id)),
  };
}

async function listCascadeGenerationsForBrandProcessor(brandName, processorName) {
  return listCascadeGenerationsForBrand(brandName);
}

async function listActiveSpareBrandsForDropdown() {
  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM asset_config_spare_brands
        WHERE deleted_at IS NULL AND status = 'active'
        ORDER BY name ASC`
    );
    return rows;
  } catch (e) {
    if (e.message && e.message.includes('asset_config_spare_brands')) return [];
    throw e;
  }
}

async function ensureAssetConfigurationSchema() {
  const fs = require('fs');
  const path = require('path');
  for (const file of [
    '123_asset_config_laptop_spec_mapping.sql',
    '126_asset_config_brand_flat_mapping.sql',
    '127_asset_config_spare_brands.sql',
  ]) {
    const migrationPath = path.join(__dirname, '../migrations', file);
    if (!fs.existsSync(migrationPath)) continue;
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(sql);
  }
}

module.exports = {
  ENTITIES,
  getEntity,
  listEntity,
  getEntityById,
  createEntity,
  updateEntity,
  softDeleteEntity,
  setEntityStatus,
  getAssetDropdownCatalog,
  getAssetCatalogForApi,
  listParentOptions,
  getMappingTree,
  bulkCreateChildren,
  reassignChildren,
  bulkDeleteChildren,
  bulkSetChildStatus,
  getLaptopSpecMappingTree,
  bulkAddProcessorsToBrand,
  bulkAddModelsToBrand,
  bulkAddGenerationsToBrand,
  bulkAddGenerationsToBrandProcessor,
  bulkDeleteBrandProcessors,
  bulkDeleteBrandModels,
  bulkDeleteBrandGenerations,
  bulkDeleteBrandProcessorGenerations,
  bulkSetBrandProcessorStatus,
  bulkSetBrandModelStatus,
  bulkSetBrandGenerationStatus,
  bulkSetBrandProcessorGenerationStatus,
  ensureAssetConfigurationSchema,
  listCascadeBrands,
  listCascadeSpecMasters,
  listInventorySpecFilterOptions,
  listCascadeModelsForBrand,
  listCascadeProcessorsForBrand,
  listCascadeGenerationsForBrand,
  listCascadeGenerationsForBrandProcessor,
  listActiveSpareBrandsForDropdown,
};
