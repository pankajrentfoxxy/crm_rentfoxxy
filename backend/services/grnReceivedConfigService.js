/**
 * GRN-received hardware config — source of truth for inventory display.
 * PO line_items can be wrong on legacy ERP imports; serial product_id / inventory / VPD hold GRN truth.
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

async function fetchVendorProductDetail(db, { productDetailId, legacyProductId, poId }) {
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
    `SELECT product_detail_id, po_id, brand, model, processor, generation, ram, storage, gpu, screen_size
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

async function fetchGrnConfigForSerial(db, row) {
  const ex = parseExtra(row.extra);
  const legacyId = ex.product_id ?? ex.pro_id ?? row.grn_product_id;
  const vpd = await fetchVendorProductDetail(db, {
    productDetailId: ex.product_detail_id ?? ex.pro_id,
    legacyProductId: legacyId,
    poId: row.po_id
  });
  if (vpd) return configFromVendorProductDetail(vpd);

  const invId = ex.inventory_id != null ? Number(ex.inventory_id) : NaN;
  if (Number.isFinite(invId) && invId > 0) {
    const invR = await db.query(
      `SELECT brand, model, processor, generation, ram, storage, gpu, screen_size
         FROM inventory WHERE inventory_id = $1`,
      [invId]
    );
    if (invR.rows[0]) return configFromInventoryRow(invR.rows[0]);
  }

  const asset = row.inventory_asset_code ? String(row.inventory_asset_code) : '';
  const serial = row.serial_number ? String(row.serial_number) : '';
  if (asset || serial) {
    const invR = await db.query(
      `SELECT brand, model, processor, generation, ram, storage, gpu, screen_size
         FROM inventory
        WHERE ($1 <> '' AND machine_number = $1)
           OR ($2 <> '' AND LOWER(serial_number) = LOWER($2))
        LIMIT 1`,
      [asset, serial]
    );
    if (invR.rows[0]) return configFromInventoryRow(invR.rows[0]);
  }

  const fromExtra = configFromExtra(ex);
  if (fromExtra) return fromExtra;

  return null;
}

/** Prefer GRN capture actual_config, then VPD, then PO line. */
async function resolveReceiveConfig(db, { poId, line, captureToken, productDetailId }) {
  if (captureToken) {
    const tok = await db.query(
      `SELECT actual_config FROM grn_serial_capture_tokens
        WHERE token = $1 AND actual_config IS NOT NULL
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

async function loadGrnLineConfigsForPo(db, poId, legacyProductIds = []) {
  const map = new Map();

  const serialR = await db.query(
    `SELECT DISTINCT ON (line_idx)
            line_idx,
            extra
       FROM (
         SELECT COALESCE((extra->>'line_index')::int, -1) AS line_idx,
                extra,
                serial_id
           FROM vendor_serial_numbers
          WHERE po_id = $1 AND deleted_at IS NULL
       ) s
      WHERE line_idx >= 0
      ORDER BY line_idx, serial_id DESC`,
    [poId]
  );
  for (const row of serialR.rows) {
    const cfg = configFromExtra(row.extra);
    if (cfg) map.set(row.line_idx, cfg);
  }

  const vpdR = await db.query(
    `SELECT product_detail_id, old_product_id, brand, model, processor, generation, ram, storage, gpu, screen_size
       FROM vendor_product_details
      WHERE po_id = $1
      ORDER BY product_detail_id`,
    [poId]
  );
  for (let i = 0; i < vpdR.rows.length; i += 1) {
    const vpd = vpdR.rows[i];
    const cfg = configFromVendorProductDetail(vpd);
    if (!cfg) continue;
    if (!map.has(i)) map.set(i, cfg);
    if (vpd.product_detail_id != null) map.set(String(vpd.product_detail_id), cfg);
    if (vpd.old_product_id != null) map.set(String(vpd.old_product_id), cfg);
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
        map.set(i, cfg);
        if (legacyId != null) map.set(String(legacyId), cfg);
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
    os: cfg.os || line.os
  };
}

module.exports = {
  CONFIG_KEYS,
  configFromPlainObject,
  configFromVendorProductDetail,
  configFromInventoryRow,
  configFromExtra,
  mergeConfigIntoExtra,
  fetchVendorProductDetail,
  fetchGrnConfigForSerial,
  resolveReceiveConfig,
  loadGrnLineConfigsForPo,
  applyGrnConfigToLine
};
