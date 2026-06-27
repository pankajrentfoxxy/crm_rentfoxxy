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
};
