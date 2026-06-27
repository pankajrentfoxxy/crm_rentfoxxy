/**
 * ERP product_details → CRM line_items / serial extra config.
 * ERP stores one product_details row per received laptop (serial_numbers.product_id).
 */
const { parseLaravelAssetsDetailsPayload } = require('./laravelAssets');

function parseLegacyProductIds(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildBrandMapFromRows(brandRows) {
  const map = new Map();
  for (const b of brandRows || []) {
    const name = b.name ?? b.brand_name ?? b.title;
    if (b.id != null && name) map.set(String(b.id), String(name));
  }
  return map;
}

function resolveBrandName(brandRaw, brandMap) {
  const b = brandRaw != null ? String(brandRaw).trim() : '';
  if (!b) return '';
  if (/^\d+$/.test(b) && brandMap?.has(b)) return brandMap.get(b);
  return b;
}

function productDetailsRowToLineItem(pd, brandMap) {
  if (!pd) return null;
  const brand = resolveBrandName(pd.brand, brandMap);
  const model = pd.model != null ? String(pd.model).trim() : '';
  return {
    product_detail_id: pd.id != null ? Number(pd.id) : undefined,
    product_id: pd.id != null ? Number(pd.id) : undefined,
    brand: brand || undefined,
    brand_name: brand || undefined,
    model: model || undefined,
    product_name: model || undefined,
    processor: pd.processor != null ? String(pd.processor).trim() : undefined,
    generation: pd.generation != null ? String(pd.generation).trim() : undefined,
    ram: pd.ram != null ? String(pd.ram).trim() : undefined,
    storage: pd.storage != null ? String(pd.storage).trim() : undefined,
    gpu: pd.gpu != null ? String(pd.gpu).trim() : undefined,
    screen_size: pd.screen_size != null ? String(pd.screen_size).trim() : undefined,
    quantity: Number(pd.quantity) || 1,
    rate: Number(pd.rate) || 0,
    vendor_locking_period: pd.vendor_locking_period ?? undefined,
    warranty: pd.warranty ?? undefined,
    remarks: pd.remarks ?? undefined,
  };
}

function configFieldsFromLineItem(line) {
  if (!line) return {};
  return Object.fromEntries(
    Object.entries({
      brand: line.brand || line.brand_name,
      model: line.model || line.product_name,
      model_name: line.model || line.product_name,
      processor: line.processor,
      generation: line.generation,
      ram: line.ram,
      storage: line.storage,
      gpu: line.gpu,
      screen_size: line.screen_size,
    }).filter(([, v]) => v != null && String(v).trim() !== '')
  );
}

function buildLineItemsFromProductDetails(legacyIds, productDetailsById, brandMap) {
  const lines = [];
  for (const rawId of legacyIds) {
    const pd = productDetailsById.get(String(rawId));
    const line = productDetailsRowToLineItem(pd, brandMap);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Prefer per-unit product_details when ERP lists more legacy ids than assets_details lines.
 */
function resolvePoLineItems({ assetsRaw, legacyIdsRaw, productDetailsById, brandMap }) {
  const legacyIds = parseLegacyProductIds(legacyIdsRaw);
  const assetsLines = parseLaravelAssetsDetailsPayload(assetsRaw);

  if (legacyIds.length && productDetailsById?.size) {
    const fromDetails = buildLineItemsFromProductDetails(legacyIds, productDetailsById, brandMap);
    if (fromDetails.length >= legacyIds.length) return fromDetails;
    if (legacyIds.length > assetsLines.length && fromDetails.length > 0) return fromDetails;
  }

  return assetsLines;
}

function lineIndexForProductId(productId, legacyIds) {
  if (productId == null || !legacyIds?.length) return null;
  const idx = legacyIds.findIndex((id) => String(id) === String(productId));
  return idx >= 0 ? idx : null;
}

function buildSerialConfigExtra({ serialRow, legacyIds, productDetailsById, brandMap, baseExtra = {} }) {
  const productId = serialRow.product_id;
  const idx = lineIndexForProductId(productId, legacyIds);
  const pd = productId != null ? productDetailsById.get(String(productId)) : null;
  const line = productDetailsRowToLineItem(pd, brandMap);
  const config = configFieldsFromLineItem(line);

  const extra = { ...baseExtra };
  if (productId != null) {
    extra.product_id = String(productId);
    extra.product_detail_id = String(productId);
  }
  if (idx != null) extra.line_index = idx;
  Object.assign(extra, config);
  return extra;
}

function indexProductDetailsRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (row.id != null) map.set(String(row.id), row);
  }
  return map;
}

function parseSerialExtra(extraRaw) {
  if (extraRaw && typeof extraRaw === 'object' && !Array.isArray(extraRaw)) return extraRaw;
  if (typeof extraRaw === 'string') {
    try {
      const p = JSON.parse(extraRaw);
      return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Hardware config on vendor_serial_numbers.extra (GRN source of truth in CRM). */
function configFieldsFromSerialExtra(extraRaw) {
  const ex = parseSerialExtra(extraRaw);
  return Object.fromEntries(
    Object.entries({
      brand: ex.brand || ex.brand_name,
      model: ex.model || ex.model_name,
      model_name: ex.model || ex.model_name,
      processor: ex.processor,
      generation: ex.generation,
      ram: ex.ram,
      storage: ex.storage,
      gpu: ex.gpu,
      screen_size: ex.screen_size,
      os: ex.os,
    }).filter(([, v]) => v != null && String(v).trim() !== '')
  );
}

function hasHardwareConfig(config) {
  return Object.keys(configFieldsFromSerialExtra(config)).length > 0;
}

/** Only fields explicitly present in GRN extra (partial updates safe). */
function configPatchFromSerialExtra(extraRaw) {
  return configFieldsFromSerialExtra(extraRaw);
}

function mergeInventoryWithConfigPatch(current, patch) {
  const cur = current || {};
  const p = patch || {};
  return {
    brand: p.brand != null && String(p.brand).trim() ? String(p.brand).trim() : cur.brand || 'Unknown',
    model:
      (p.model != null && String(p.model).trim() ? String(p.model).trim() : null) ||
      (p.model_name != null && String(p.model_name).trim() ? String(p.model_name).trim() : null) ||
      cur.model ||
      'Unknown',
    processor: p.processor != null ? String(p.processor).trim() : cur.processor ?? null,
    generation: p.generation != null ? String(p.generation).trim() : cur.generation ?? null,
    ram: p.ram != null ? String(p.ram).trim() : cur.ram ?? null,
    storage: p.storage != null ? String(p.storage).trim() : cur.storage ?? null,
    gpu: p.gpu != null ? String(p.gpu).trim() : cur.gpu ?? null,
    screen_size: p.screen_size != null ? String(p.screen_size).trim() : cur.screen_size ?? null,
  };
}

function mergeTicketWithConfigPatch(current, patch) {
  const merged = mergeInventoryWithConfigPatch(current, patch);
  return {
    brand: merged.brand === 'Unknown' ? current?.brand ?? null : merged.brand,
    model: merged.model === 'Unknown' ? current?.model ?? null : merged.model,
    processor: merged.processor,
    ram: merged.ram,
    storage: merged.storage,
  };
}

function inventoryUpdateFromConfig(config) {
  const c = configFieldsFromSerialExtra(config);
  return {
    brand: String(c.brand || 'Unknown').trim() || 'Unknown',
    model: String(c.model || c.model_name || 'Unknown').trim() || 'Unknown',
    processor: c.processor != null ? String(c.processor).trim() : null,
    generation: c.generation != null ? String(c.generation).trim() : null,
    ram: c.ram != null ? String(c.ram).trim() : null,
    storage: c.storage != null ? String(c.storage).trim() : null,
    gpu: c.gpu != null ? String(c.gpu).trim() : null,
    screen_size: c.screen_size != null ? String(c.screen_size).trim() : null,
  };
}

function ticketUpdateFromConfig(config) {
  const inv = inventoryUpdateFromConfig(config);
  return {
    brand: inv.brand === 'Unknown' ? null : inv.brand,
    model: inv.model === 'Unknown' ? null : inv.model,
    processor: inv.processor,
    ram: inv.ram,
    storage: inv.storage,
  };
}

function mergeGrnConfigIntoExtra(existingExtra, config) {
  const base = parseSerialExtra(existingExtra);
  const hw = typeof config === 'object' && config !== null && !Array.isArray(config)
    ? configFieldsFromSerialExtra(config)
    : configFieldsFromSerialExtra(base);
  return { ...base, ...hw };
}

function normalizeRamStorage(value) {
  if (value == null || String(value).trim() === '') return null;
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/\bGB\b/g, '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function normalizeFieldMap(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || String(v).trim() === '') out[k] = null;
    else if (k === 'ram' || k === 'storage') out[k] = normalizeRamStorage(v);
    else out[k] = String(v).trim();
  }
  return out;
}

function fieldMapsEqual(a, b, keys) {
  const left = normalizeFieldMap(a);
  const right = normalizeFieldMap(b);
  return keys.every((k) => (left[k] ?? null) === (right[k] ?? null));
}

module.exports = {
  parseLegacyProductIds,
  buildBrandMapFromRows,
  resolveBrandName,
  productDetailsRowToLineItem,
  configFieldsFromLineItem,
  buildLineItemsFromProductDetails,
  resolvePoLineItems,
  lineIndexForProductId,
  buildSerialConfigExtra,
  indexProductDetailsRows,
  parseSerialExtra,
  configFieldsFromSerialExtra,
  hasHardwareConfig,
  configPatchFromSerialExtra,
  mergeInventoryWithConfigPatch,
  mergeTicketWithConfigPatch,
  inventoryUpdateFromConfig,
  ticketUpdateFromConfig,
  mergeGrnConfigIntoExtra,
  normalizeFieldMap,
  fieldMapsEqual,
};
