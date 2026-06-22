const pool = require('../config/db');

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
  models: {
    table: 'asset_config_models',
    label: 'Model',
    parentKey: 'brand_id',
    parentTable: 'asset_config_brands',
    joinSelect: ', b.name AS brand_name',
    joinClause: 'LEFT JOIN asset_config_brands b ON b.id = t.brand_id',
    listSelect: 't.*, b.name AS brand_name',
    orderBy: 'b.name ASC, t.name ASC',
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
    parentKey: 'processor_id',
    parentTable: 'asset_config_processors',
    joinSelect: ', p.name AS processor_name',
    joinClause: 'LEFT JOIN asset_config_processors p ON p.id = t.processor_id',
    listSelect: 't.*, p.name AS processor_name',
    orderBy: 'p.name ASC, t.name ASC',
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
  return String(name || '').trim();
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

async function assertUnique(cfg, { name, parentId, excludeId }) {
  const params = [normalizeName(name).toLowerCase()];
  let sql = `SELECT id FROM ${cfg.table} t WHERE deleted_at IS NULL AND LOWER(TRIM(t.name)) = $1`;
  if (cfg.parentKey && parentId) {
    params.push(parentId);
    sql += ` AND t.${cfg.parentKey} = $${params.length}`;
  }
  if (excludeId) {
    params.push(excludeId);
    sql += ` AND t.id <> $${params.length}`;
  }
  sql += ' LIMIT 1';
  const dup = await pool.query(sql, params);
  if (dup.rows.length) {
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
  const name = normalizeName(body.name);
  if (!name) {
    const err = new Error('Name is required');
    err.status = 400;
    throw err;
  }

  const parentId = cfg.parentKey ? parseInt(body[cfg.parentKey], 10) : null;
  if (cfg.parentKey && !parentId) {
    const err = new Error(`${cfg.parentKey.replace('_id', '')} is required`);
    err.status = 400;
    throw err;
  }
  if (parentId) await assertParentActive(cfg.parentTable, parentId);
  await assertUnique(cfg, { name, parentId });

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

  const name = body.name != null ? normalizeName(body.name) : existing.name;
  if (!name) {
    const err = new Error('Name is required');
    err.status = 400;
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
  if (parentId) await assertParentActive(cfg.parentTable, parentId);
  await assertUnique(cfg, { name, parentId, excludeId: id });

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

/** Active dropdown catalog for Asset Details forms. */
async function getAssetDropdownCatalog() {
  const [brands, models, processors, generations, rams, storages, gpus, screenSizes] = await Promise.all([
    pool.query(`SELECT id, name FROM asset_config_brands WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(
      `SELECT m.id, m.name, m.brand_id, b.name AS brand_name
         FROM asset_config_models m
         JOIN asset_config_brands b ON b.id = m.brand_id AND b.deleted_at IS NULL AND b.status = 'active'
        WHERE m.deleted_at IS NULL AND m.status = 'active'
        ORDER BY b.name, m.name`
    ),
    pool.query(`SELECT id, name FROM asset_config_processors WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(
      `SELECT g.id, g.name, g.processor_id, p.name AS processor_name
         FROM asset_config_generations g
         JOIN asset_config_processors p ON p.id = g.processor_id AND p.deleted_at IS NULL AND p.status = 'active'
        WHERE g.deleted_at IS NULL AND g.status = 'active'
        ORDER BY p.name, g.name`
    ),
    pool.query(`SELECT name FROM asset_config_ram WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(`SELECT name FROM asset_config_storage WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(`SELECT name FROM asset_config_gpu WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
    pool.query(`SELECT name FROM asset_config_screen_sizes WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`),
  ]);

  const modelsByBrand = {};
  for (const row of models.rows) {
    const brand = row.brand_name;
    if (!modelsByBrand[brand]) modelsByBrand[brand] = [];
    modelsByBrand[brand].push(row.name);
  }

  const generationsByProcessor = {};
  for (const row of generations.rows) {
    const proc = row.processor_name;
    if (!generationsByProcessor[proc]) generationsByProcessor[proc] = [];
    generationsByProcessor[proc].push(row.name);
  }

  const catalogRows = [];
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

  return {
    from_asset_config: true,
    brands: brands.rows.map((r) => r.name),
    models: modelsByBrand,
    models_by_brand: modelsByBrand,
    models_flat: [...new Set(Object.values(modelsByBrand).flat())],
    processors: processors.rows.map((r) => r.name),
    generations: generationsByProcessor,
    generations_by_processor: generationsByProcessor,
    generations_flat: [...new Set(Object.values(generationsByProcessor).flat())],
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
    brands: [],
    models: {},
    models_by_brand: {},
    models_flat: [],
    processors: [],
    generations: {},
    generations_by_processor: {},
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
};
