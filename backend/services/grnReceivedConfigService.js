/**
 * PO/GRN config helpers.
 *
 * Procurement truth (immutable after acceptance):
 *   - vendor_product_details (ordered)
 *   - vendor_serial_numbers.grn_received_config (frozen at GRN receive)
 *
 * Operational truth (editable):
 *   - production_assets working columns (+ inventory display mirror)
 *
 * Never treat live vendor_serial_numbers.extra config keys as the receive-view source.
 */
const { parseExtra } = require('./qcManagementService');

const CONFIG_KEYS = [
  'brand',
  'model',
  'processor',
  'generation',
  'ram',
  'storage',
  'gpu',
  'screen_size',
  'os'
];

function pickConfigField(source, ...keys) {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    const v = source[key];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function configFromPlainObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const config = {
    brand: pickConfigField(obj, 'brand', 'Brand', 'brand_name', 'manufacturer'),
    model: pickConfigField(obj, 'model', 'Model', 'model_name', 'product_name'),
    processor: pickConfigField(obj, 'processor', 'Processor', 'cpu'),
    generation: pickConfigField(obj, 'generation', 'Generation'),
    ram: pickConfigField(obj, 'ram', 'RAM'),
    storage: pickConfigField(obj, 'storage', 'Storage', 'ssd'),
    gpu: pickConfigField(obj, 'gpu', 'GPU', 'graphics'),
    screen_size: pickConfigField(obj, 'screen_size', 'Screen size', 'screen_size_inches', 'screen'),
    os: pickConfigField(obj, 'os', 'OS', 'operating_system')
  };
  const hasAny = CONFIG_KEYS.some((k) => config[k]);
  return hasAny ? config : null;
}

function mergeConfigIntoExtra(extra, config) {
  if (!config) return extra || {};
  const base = extra && typeof extra === 'object' ? { ...extra } : {};
  for (const key of CONFIG_KEYS) {
    if (config[key]) base[key] = config[key];
  }
  return base;
}

/** Strip editable hardware config keys from VSN.extra (keep meta: line_index, remarks, …). */
function stripConfigKeysFromExtra(extraRaw) {
  const base = parseExtra(extraRaw) || {};
  const out = { ...base };
  for (const key of CONFIG_KEYS) delete out[key];
  delete out.ssd;
  return out;
}

function configFromVendorProductDetail(vpd) {
  return configFromPlainObject(vpd);
}

function configFromInventoryRow(inv) {
  return configFromPlainObject(inv);
}

function configFromExtra(extraRaw) {
  const ex = parseExtra(extraRaw);
  return configFromPlainObject(ex);
}

async function ensureLockColumns(db) {
  await db.query(`
    ALTER TABLE vendor_serial_numbers
      ADD COLUMN IF NOT EXISTS grn_received_config JSONB,
      ADD COLUMN IF NOT EXISTS config_locked_at TIMESTAMPTZ
  `);
  await db.query(`
    ALTER TABLE vendor_product_details
      ADD COLUMN IF NOT EXISTS config_locked_at TIMESTAMPTZ
  `);
  await db.query(`
    ALTER TABLE vendor_goods_received_notes
      ADD COLUMN IF NOT EXISTS config_locked_at TIMESTAMPTZ
  `);
}

/**
 * Freeze accepted receive config on the serial (+ lock VPD/GRN).
 * Call inside the receive transaction after INSERT.
 */
async function freezeAcceptedReceiveConfig(db, {
  serialId,
  grnId,
  productDetailId,
  config,
}) {
  await ensureLockColumns(db);
  const frozen = configFromPlainObject(config) || {};
  await db.query(
    `UPDATE vendor_serial_numbers
        SET grn_received_config = COALESCE(grn_received_config, $2::jsonb),
            config_locked_at = COALESCE(config_locked_at, NOW()),
            updated_at = NOW()
      WHERE serial_id = $1`,
    [serialId, JSON.stringify(frozen)]
  );

  if (grnId) {
    await db.query(
      `UPDATE vendor_goods_received_notes
          SET config_locked_at = COALESCE(config_locked_at, NOW()),
              updated_at = NOW()
        WHERE grn_id = $1`,
      [grnId]
    );
  }

  const pd = productDetailId != null ? Number(productDetailId) : NaN;
  if (Number.isFinite(pd) && pd > 0) {
    await db.query(
      `UPDATE vendor_product_details
          SET config_locked_at = COALESCE(config_locked_at, NOW()),
              updated_at = NOW()
        WHERE product_detail_id = $1 OR old_product_id = $1`,
      [pd]
    );
  }
}

/**
 * Reject VPD hardware-config updates after the line was accepted/locked.
 * @throws Error with status 403 when locked
 */
async function assertVpdConfigWritable(db, productDetailId) {
  if (productDetailId == null) return;
  const id = Number(productDetailId);
  if (!Number.isFinite(id) || id <= 0) return;
  await ensureLockColumns(db);
  const r = await db.query(
    `SELECT product_detail_id, config_locked_at
       FROM vendor_product_details
      WHERE product_detail_id = $1 OR old_product_id = $1
      LIMIT 1`,
    [id]
  );
  if (r.rows[0]?.config_locked_at) {
    const err = new Error(
      'PO/GRN ordered config is locked after goods receipt. Edit the Production/Inventory Asset instead.'
    );
    err.status = 403;
    err.code = 'PO_GRN_CONFIG_LOCKED';
    throw err;
  }
}

/**
 * Reject mutation of vendor_serial_numbers.grn_received_config after lock.
 */
async function assertSerialGrnConfigWritable(db, serialId) {
  if (!serialId) return;
  await ensureLockColumns(db);
  const r = await db.query(
    `SELECT config_locked_at FROM vendor_serial_numbers WHERE serial_id = $1`,
    [serialId]
  );
  if (r.rows[0]?.config_locked_at) {
    const err = new Error(
      'GRN received config is locked. Edit the Production/Inventory Asset instead.'
    );
    err.status = 403;
    err.code = 'PO_GRN_CONFIG_LOCKED';
    throw err;
  }
}

async function fetchVendorProductDetail(db, { productDetailId, legacyProductId, poId }) {
  await ensureLockColumns(db);
  const ids = [];
  if (productDetailId != null && String(productDetailId).trim() !== '') {
    const n = Number(productDetailId);
    if (Number.isFinite(n) && n > 0) ids.push(n);
  }
  if (legacyProductId != null && String(legacyProductId).trim() !== '') {
    const n = Number(legacyProductId);
    if (Number.isFinite(n) && n > 0) ids.push(n);
  }
  if (!ids.length) return null;

  const r = await db.query(
    `SELECT product_detail_id, po_id, brand, model, processor, generation, ram, storage, gpu, screen_size,
            config_locked_at
       FROM vendor_product_details
      WHERE product_detail_id = ANY($1::int[])
         OR old_product_id = ANY($1::int[])
      ORDER BY CASE WHEN po_id IS NOT DISTINCT FROM $2 THEN 0 ELSE 1 END,
               product_detail_id DESC
      LIMIT 1`,
    [ids, poId ?? null]
  );
  return r.rows[0] || null;
}

/**
 * Frozen GRN/VPD config for a serial — for audit / procurement.
 * Does NOT fall through to live inventory edits.
 */
async function fetchGrnConfigForSerial(db, row) {
  const frozen = configFromPlainObject(row.grn_received_config);
  if (frozen) return frozen;

  const ex = parseExtra(row.extra);
  const legacyId = ex.product_id ?? ex.pro_id ?? row.grn_product_id;
  const vpd = await fetchVendorProductDetail(db, {
    productDetailId: ex.product_detail_id ?? ex.pro_id,
    legacyProductId: legacyId,
    poId: row.po_id
  });
  if (vpd) return configFromVendorProductDetail(vpd);

  // Legacy unlock only: units that never got a freeze may still have original config in extra
  if (!row.config_locked_at) {
    const fromExtra = configFromExtra(ex);
    if (fromExtra) return fromExtra;
  }

  return null;
}

/** Prefer GRN capture actual_config, then VPD, then PO line. */
async function resolveReceiveConfig(db, { poId, line, captureToken, productDetailId }) {
  if (captureToken) {
    const tok = await db.query(
      `SELECT actual_config FROM grn_serial_capture_tokens
        WHERE token_id = $1 AND actual_config IS NOT NULL
        LIMIT 1`,
      [captureToken]
    );
    const fromToken = configFromPlainObject(tok.rows[0]?.actual_config);
    if (fromToken) return fromToken;
  }

  const pd = productDetailId ?? line?.product_detail_id ?? line?.product_id ?? line?.pro_id ?? line?.id;
  const vpd = await fetchVendorProductDetail(db, {
    productDetailId: pd,
    legacyProductId: pd,
    poId
  });
  if (vpd) return configFromVendorProductDetail(vpd);

  return configFromPlainObject(line);
}

/**
 * Receive-view line configs: frozen GRN snapshot + locked VPD — never live VSN.extra.
 */
async function loadGrnLineConfigsForPo(db, poId, legacyProductIds = []) {
  const map = new Map();
  await ensureLockColumns(db);

  // 1) Frozen GRN received snapshots (accepted units)
  const frozenR = await db.query(
    `SELECT DISTINCT ON (line_idx)
            line_idx,
            grn_received_config,
            config_locked_at
       FROM (
         SELECT COALESCE((extra->>'line_index')::int, -1) AS line_idx,
                grn_received_config,
                config_locked_at,
                serial_id
           FROM vendor_serial_numbers
          WHERE po_id = $1 AND deleted_at IS NULL
       ) s
      WHERE line_idx >= 0
      ORDER BY line_idx, serial_id DESC`,
    [poId]
  );
  for (const row of frozenR.rows) {
    const cfg = configFromPlainObject(row.grn_received_config);
    if (cfg) {
      map.set(row.line_idx, { ...cfg, config_locked: !!row.config_locked_at });
    }
  }

  // 2) Ordered VPD fills any index still missing (and tags lock flag)
  const vpdR = await db.query(
    `SELECT product_detail_id, old_product_id, brand, model, processor, generation, ram, storage, gpu, screen_size,
            config_locked_at
       FROM vendor_product_details
      WHERE po_id = $1
      ORDER BY product_detail_id`,
    [poId]
  );
  for (let i = 0; i < vpdR.rows.length; i += 1) {
    const vpd = vpdR.rows[i];
    const cfg = configFromVendorProductDetail(vpd);
    if (!cfg) continue;
    const withLock = { ...cfg, config_locked: !!vpd.config_locked_at };
    if (!map.has(i)) map.set(i, withLock);
    else if (vpd.config_locked_at) map.set(i, { ...map.get(i), config_locked: true });
    if (vpd.product_detail_id != null) map.set(String(vpd.product_detail_id), withLock);
    if (vpd.old_product_id != null) map.set(String(vpd.old_product_id), withLock);
  }

  if (Array.isArray(legacyProductIds)) {
    for (let i = 0; i < legacyProductIds.length; i += 1) {
      if (map.has(i)) continue;
      const legacyId = legacyProductIds[i];
      const vpd = await fetchVendorProductDetail(db, {
        legacyProductId: legacyId,
        poId
      });
      const cfg = vpd ? configFromVendorProductDetail(vpd) : null;
      if (cfg) {
        const withLock = { ...cfg, config_locked: !!vpd.config_locked_at };
        map.set(i, withLock);
        if (legacyId != null) map.set(String(legacyId), withLock);
      }
    }
  }

  return map;
}

function applyGrnConfigToLine(line, grnLineConfigs, lineIndex) {
  if (!grnLineConfigs || !grnLineConfigs.size) return line;
  const cfg =
    grnLineConfigs.get(lineIndex) ||
    grnLineConfigs.get(String(line?.product_detail_id ?? '')) ||
    grnLineConfigs.get(String(line?.product_id ?? '')) ||
    grnLineConfigs.get(String(line?.pro_id ?? ''));
  if (!cfg) return line;
  return {
    ...line,
    brand: cfg.brand || line.brand,
    brand_name: cfg.brand || line.brand_name,
    model: cfg.model || line.model,
    model_name: cfg.model || line.model_name,
    product_name: cfg.model || line.product_name,
    processor: cfg.processor || line.processor,
    generation: cfg.generation || line.generation,
    ram: cfg.ram || line.ram,
    storage: cfg.storage || line.storage,
    gpu: cfg.gpu || line.gpu,
    screen_size: cfg.screen_size || line.screen_size,
    os: cfg.os || line.os,
    config_locked: !!cfg.config_locked,
  };
}

module.exports = {
  CONFIG_KEYS,
  configFromPlainObject,
  configFromVendorProductDetail,
  configFromInventoryRow,
  configFromExtra,
  mergeConfigIntoExtra,
  stripConfigKeysFromExtra,
  ensureLockColumns,
  freezeAcceptedReceiveConfig,
  assertVpdConfigWritable,
  assertSerialGrnConfigWritable,
  fetchVendorProductDetail,
  fetchGrnConfigForSerial,
  resolveReceiveConfig,
  loadGrnLineConfigsForPo,
  applyGrnConfigToLine
};
